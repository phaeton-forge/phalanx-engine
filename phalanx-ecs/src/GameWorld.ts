import { SystemRegistry } from './SystemRegistry';
import { TickFrameManager } from './TickFrameManager';
import type { ITickFrameProvider, Unsubscribe } from './ITickFrameProvider';
import type { EventBus } from './EventBus';
import type { EntityManager } from './EntityManager';
import type { SystemContext } from './SystemContext';
import type { GameSystem } from './GameSystem';

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

  // Unsubscribe handles for tick/frame
  private unsubscribeTick: Unsubscribe | null = null;
  private unsubscribeFrame: Unsubscribe | null = null;

  constructor(config: GameWorldConfig) {
    // Create SystemRegistry with eagerly-initialized core deps
    this.systemRegistry = new SystemRegistry(
      config.componentTypes
    );

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
    // Subscribe to tick events
    this.unsubscribeTick = this.provider.onTick((tick, commands) => {
      hooks?.beforeTick?.(tick, commands);
      this.processAllTicks(tick);
      hooks?.afterTick?.(tick);
    });

    // Subscribe to frame events
    this.unsubscribeFrame = this.provider.onFrame((alpha, dt) => {
      hooks?.beforeFrame?.(alpha, dt);
      this.updateAll(dt);
      hooks?.afterFrame?.(alpha, dt);
    });

    // Start internal TickFrameManager if we own it
    if (this.ownsProvider && this.provider instanceof TickFrameManager) {
      (this.provider as TickFrameManager).start();
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

    if (this.ownsProvider && this.provider instanceof TickFrameManager) {
      (this.provider as TickFrameManager).stop();
    }
  }

  /**
   * Full cleanup: stop loops then dispose all systems.
   */
  public dispose(): void {
    this.stop();
    this.systemRegistry.dispose();
  }
}
