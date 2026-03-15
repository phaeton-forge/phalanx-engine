import { SystemRegistry } from './SystemRegistry';
import { TickFrameManager } from './TickFrameManager';
import { SoAComponent } from './SoAComponent';
import { PoolManager } from './pool/PoolManager';
import { DebugDataProvider } from './debug/DebugDataProvider';
import { DebugPanel } from './debug/DebugPanel';
import type { DebugDataProviderConfig, DebugPanelConfig } from './debug/types';
import type { PoolingConfig } from './pool/types';
import type { ITickFrameProvider, Unsubscribe } from './ITickFrameProvider';
import type { EventBus } from './EventBus';
import type { EntityManager } from './EntityManager';
import type { SystemContext } from './SystemContext';
import type { GameSystem } from './GameSystem';

/**
 * Well-known event names emitted on the GameWorld's EventBus when the
 * world is paused or resumed through the provider pipeline.
 */
export const GameWorldEvents = {
  /** Emitted when the world has been paused (provider confirmed) */
  PAUSED: 'gameWorld:paused',
  /** Emitted when the world has been resumed (provider confirmed) */
  RESUMED: 'gameWorld:resumed',
} as const;

/**
 * Configuration for GameWorld
 */
export interface GameWorldConfig {
  /** Optional component type symbols for EntityManager indexing */
  componentTypes?: symbol[];
  /** Target ticks per second (default: 60, only used when no tickFrameProvider) */
  tickRate?: number;
  /** Maximum time per frame in seconds (default: 0.25, only used when no tickFrameProvider) */
  maxFrameTime?: number;
  /** External tick/frame provider (e.g. PhalanxClient for multiplayer). If omitted, an internal TickFrameManager is created. */
  tickFrameProvider?: ITickFrameProvider;
  /** Object pooling configuration. If omitted, pooling is disabled. */
  pooling?: PoolingConfig;
  /** Enable debug data collection. When true, a DebugDataProvider is created. Default: false */
  debug?: boolean;
  /** Configuration for the debug data provider (update interval, etc.). Only used when debug is true. */
  debugConfig?: DebugDataProviderConfig;
  /**
   * Configuration for the built-in DebugPanel DOM overlay.
   * Only used when `debug` is true.
   *
   * When provided (even as `{}`), a DebugPanel is auto-created in `start()`
   * if a DOM environment is detected. Omit to use DebugDataProvider without
   * the built-in panel (e.g. for custom tooling or headless environments).
   */
  debugPanelConfig?: DebugPanelConfig;
}

/**
 * Lifecycle hooks for the start() loop.
 *
 * The tick pipeline is:   beforeTick → processAllTicks → afterTick
 * The frame pipeline is:  beforeFrame → updateAll → afterFrame
 *
 * All hooks are optional. If omitted the corresponding step is simply skipped.
 * Rendering (e.g. scene.render()) should be called by the consumer in afterFrame.
 */
export interface GameWorldHooks {
  /** Called before tick systems are processed (e.g. snapshot positions, execute commands) */
  beforeTick?: (tick: number, commands: import('./ITickFrameProvider').CommandsBatch) => void;
  /** Called after tick systems have been processed (e.g. capture positions, cleanup) */
  afterTick?: (tick: number) => void;
  /** Called before frame systems are updated (e.g. camera input) */
  beforeFrame?: (alpha: number, dt: number) => void;
  /** Called after frame systems are updated (e.g. interpolation, scene.render()) */
  afterFrame?: (alpha: number, dt: number) => void;
}

/**
 * GameWorld - High-level facade for the ECS engine
 *
 * Replaces the manual wiring of SystemRegistry + TickFrameManager + NetworkCoordinator
 * with a single entry point. Completely renderer-agnostic.
 *
 * Single-player usage:
 * ```ts
 * const world = new GameWorld({ componentTypes });
 * world.registerSystems(tickSystems, frameSystems);
 * world.start({
 *   afterFrame(alpha, dt) { scene.render(); },
 * });
 * ```
 *
 * Multiplayer usage (with PhalanxClient as tickFrameProvider):
 * ```ts
 * const world = new GameWorld({ componentTypes, tickFrameProvider: client });
 * world.registerSystems(tickSystems, frameSystems);
 * world.start({
 *   beforeTick(tick, commands) { lockstepManager.processTick(tick, commands); },
 *   afterTick(tick) { interpolationSystem.captureCurrentPositions(); },
 *   beforeFrame(alpha, dt) { cameraController.update(dt); },
 *   afterFrame(alpha, dt) { interpolationSystem.interpolate(alpha); scene.render(); },
 * });
 * ```
 */
export class GameWorld {
  private readonly systemRegistry: SystemRegistry;
  private readonly provider: ITickFrameProvider;
  private readonly ownsProvider: boolean;
  private readonly _pools: PoolManager | null;
  private readonly _poolingConfig: PoolingConfig | undefined;
  private readonly _debugProvider: DebugDataProvider | null;
  private readonly _debugPanelConfig: DebugPanelConfig | undefined;
  private _debugPanel: DebugPanel | null = null;

  // Unsubscribe handles for tick/frame
  private unsubscribeTick: Unsubscribe | null = null;
  private unsubscribeFrame: Unsubscribe | null = null;

  // Unsubscribe handles for provider pause/resume signals
  private unsubscribePause: Unsubscribe | null = null;
  private unsubscribeResume: Unsubscribe | null = null;

  // Pause state – when true, both tick and frame pipelines are skipped
  private _paused: boolean = false;

  constructor(config: GameWorldConfig) {
    // Create SystemRegistry with eagerly-initialized core deps
    this.systemRegistry = new SystemRegistry(
      config.componentTypes
    );

    // Set SoAComponent context so SoA-backed components can resolve stores
    SoAComponent.useEntityManager(this.systemRegistry.entityManager);

    // Setup pooling if configured
    if (config.pooling) {
      this._poolingConfig = config.pooling;
      this._pools = new PoolManager();
      for (const [typeKey, typeConfig] of Object.entries(config.pooling.entityTypes)) {
        this._pools.registerEntityType(typeKey, typeConfig);
      }
    } else {
      this._poolingConfig = undefined;
      this._pools = null;
    }

    // Use external provider or create internal TickFrameManager
    if (config.tickFrameProvider) {
      this.provider = config.tickFrameProvider;
      this.ownsProvider = false;
    } else {
      this.provider = new TickFrameManager({
        tickRate: config.tickRate,
        maxFrameTime: config.maxFrameTime,
      });
      this.ownsProvider = true;
    }

    // Setup debug data provider if configured
    if (config.debug) {
      this._debugProvider = new DebugDataProvider(
        this.systemRegistry.entityManager,
        this._pools,
        config.debugConfig,
      );
      this._debugPanelConfig = config.debugPanelConfig;
    } else {
      this._debugProvider = null;
      this._debugPanelConfig = undefined;
    }
  }

  // ── Pause / Resume ───────────────────────────────────────────────────

  /** Whether the world is currently paused */
  public get paused(): boolean {
    return this._paused;
  }

  /**
   * Pause the game world.
   *
   * If the provider implements requestPause (both TickFrameManager and
   * PhalanxClient do), the request is forwarded to the provider. The world
   * will actually freeze only when the provider fires the onPause callback —
   * this ensures multiplayer clients all freeze at the same deterministic
   * point after server confirmation, while single-player pauses immediately.
   *
   * If the provider does NOT implement requestPause, the world is paused
   * directly as a fallback.
   */
  public pause(): void {
    if (this._paused) return;

    if (this.provider.requestPause) {
      // Delegate to provider — _paused is set in the onPause callback
      this.provider.requestPause();
    } else {
      // Fallback for providers that don't support pause
      this._paused = true;
      if (this._debugProvider) this._debugProvider.paused = true;
      this.systemRegistry.eventBus.emit(GameWorldEvents.PAUSED, {});
    }
  }

  /**
   * Resume the game world after a pause.
   *
   * Same semantics as pause(): delegates to the provider when possible,
   * and the actual resume happens in the onResume callback.
   */
  public resume(): void {
    if (!this._paused) return;

    if (this.provider.requestResume) {
      // Delegate to provider — _paused is cleared in the onResume callback
      this.provider.requestResume();
    } else {
      // Fallback for providers that don't support resume
      this._paused = false;
      if (this._debugProvider) this._debugProvider.paused = false;
      this.systemRegistry.eventBus.emit(GameWorldEvents.RESUMED, {});
    }
  }

  // ── Convenience accessors ────────────────────────────────────────────

  /** Central event bus */
  public get eventBus(): EventBus {
    return this.systemRegistry.eventBus;
  }

  /** Entity manager */
  public get entityManager(): EntityManager {
    return this.systemRegistry.entityManager;
  }

  /** Pool manager. null if pooling is not configured. */
  public get pools(): PoolManager | null {
    return this._pools;
  }

  /**
   * Debug data provider. null if debug mode is not enabled.
   *
   * Use this to subscribe to periodic debug snapshots or pull
   * snapshots on demand for custom debug tooling.
   *
   * @example
   * ```ts
   * const world = new GameWorld({ debug: true });
   * const unsub = world.debugProvider!.subscribe((snap) => {
   *   console.log('Entities:', snap.world.entityCount);
   * });
   * ```
   */
  public get debugProvider(): DebugDataProvider | null {
    return this._debugProvider;
  }

  /** Debug panel DOM renderer. null if debug mode is not enabled or panel not yet created. */
  public get debugPanel(): DebugPanel | null {
    return this._debugPanel;
  }

  /** System context (for advanced use) */
  public get context(): SystemContext {
    return this.systemRegistry.getContext();
  }

  /** Look up a registered system by class */
  public getSystem<T extends GameSystem>(
    systemClass: new (...args: any[]) => T
  ): T | undefined {
    return this.systemRegistry.getContext().getSystem(systemClass);
  }

  // ── System registration ──────────────────────────────────────────────

  /**
   * Register tick and frame systems, then call init() on each.
   */
  public registerSystems(
    tickSystems: GameSystem[],
    frameSystems: GameSystem[]
  ): void {
    this.systemRegistry.registerSystems(tickSystems, frameSystems);
  }

  /**
   * Add a late-initialized frame system (init() must already have been called).
   */
  public addFrameSystem(system: GameSystem): void {
    this.systemRegistry.addFrameSystem(system);
  }

  // ── Tick / Frame delegation ──────────────────────────────────────────

  /**
   * Run all tick-based systems for the given tick.
   */
  public processAllTicks(tick: number): void {
    this.systemRegistry.processAllTicks(tick);
  }

  /**
   * Run all frame-based systems with the given delta time.
   */
  public updateAll(dt: number): void {
    this.systemRegistry.updateAll(dt);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Start the tick/frame loop.
   *
   * The tick pipeline:  hooks.beforeTick → processAllTicks → hooks.afterTick
   * The frame pipeline: hooks.beforeFrame → updateAll → hooks.afterFrame
   *
   * Rendering is NOT called automatically. The consumer should call their
   * renderer (e.g. scene.render()) in the afterFrame hook.
   *
   * @param hooks - Optional lifecycle hooks to inject custom logic around the core steps.
   */
  public start(hooks?: GameWorldHooks): void {
    // Prewarm pools if configured
    if (this._pools && this._poolingConfig?.autoPrewarm !== false) {
      this._pools.prewarmAll();
    }

    // Subscribe to provider pause/resume signals
    if (this.provider.onPause) {
      this.unsubscribePause = this.provider.onPause(() => {
        this._paused = true;
        if (this._debugProvider) this._debugProvider.paused = true;
        this.systemRegistry.eventBus.emit(GameWorldEvents.PAUSED, {});
      });
    }
    if (this.provider.onResume) {
      this.unsubscribeResume = this.provider.onResume(() => {
        this._paused = false;
        if (this._debugProvider) this._debugProvider.paused = false;
        this.systemRegistry.eventBus.emit(GameWorldEvents.RESUMED, {});
      });
    }

    // Subscribe to tick events
    this.unsubscribeTick = this.provider.onTick((tick, commands) => {
      if (this._paused) return;
      hooks?.beforeTick?.(tick, commands);
      this.processAllTicks(tick);
      hooks?.afterTick?.(tick);
    });

    // Subscribe to frame events
    this.unsubscribeFrame = this.provider.onFrame((alpha, dt) => {
      if (this._paused) return;
      hooks?.beforeFrame?.(alpha, dt);
      this.updateAll(dt);
      hooks?.afterFrame?.(alpha, dt);
    });

    // Start internal TickFrameManager if we own it
    if (this.ownsProvider && this.provider instanceof TickFrameManager) {
      (this.provider as TickFrameManager).start();
    }

    // Start debug data provider if configured
    if (this._debugProvider) {
      this._debugProvider.start();

      // Auto-create panel only when debugPanelConfig was explicitly provided
      // and a DOM environment is available. This keeps the overlay opt-in so
      // consumers who only need DebugDataProvider aren't surprised by DOM
      // side effects.
      if (this._debugPanelConfig !== undefined && typeof document !== 'undefined') {
        this._debugPanel = new DebugPanel(this._debugProvider, this._debugPanelConfig);
      }
    }
  }

  /**
   * Stop the tick/frame loop (unsubscribe callbacks, stop internal provider).
   */
  public stop(): void {
    if (this.unsubscribeTick) {
      this.unsubscribeTick();
      this.unsubscribeTick = null;
    }
    if (this.unsubscribeFrame) {
      this.unsubscribeFrame();
      this.unsubscribeFrame = null;
    }
    if (this.unsubscribePause) {
      this.unsubscribePause();
      this.unsubscribePause = null;
    }
    if (this.unsubscribeResume) {
      this.unsubscribeResume();
      this.unsubscribeResume = null;
    }

    if (this.ownsProvider && this.provider instanceof TickFrameManager) {
      (this.provider as TickFrameManager).stop();
    }

    // Destroy debug panel
    if (this._debugPanel) {
      this._debugPanel.destroy();
      this._debugPanel = null;
    }

    // Stop debug data provider
    if (this._debugProvider) {
      this._debugProvider.stop();
    }
  }

  /**
   * Full cleanup: stop loops, drain pools, then dispose all systems.
   */
  public dispose(): void {
    this.stop();
    if (this._debugProvider) {
      this._debugProvider.dispose();
    }
    if (this._pools) {
      this._pools.drainAll();
    }
    this.systemRegistry.dispose();
    SoAComponent.resetContext();
  }
}
