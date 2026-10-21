import { SystemRegistry } from './SystemRegistry.js';
import { SoAComponent } from './SoAComponent.js';
import { Entity } from './Entity.js';
import { PoolManager } from './pool/PoolManager.js';
import type { PoolingConfig } from './pool/types.js';
import type { ITickFrameProvider, Unsubscribe } from './ITickFrameProvider.js';
import type { EventBus } from './EventBus.js';
import type { EntityManager } from './EntityManager.js';
import type { SystemContext } from './SystemContext.js';
import type { GameSystem } from './GameSystem.js';
import type { IRandom } from './IRandom.js';
import type { ComponentRegistration } from './ComponentRegistration.js';
import type { SoASchemaDefinition } from './SoASchema.js';
import { compareSaveSectionKeys, type SaveSection } from './state/sections.js';
import {
  isBeforeTick,
  isAfterTick,
  isBeforeFrame,
  isAfterFrame,
  type IBeforeTick,
  type IAfterTick,
  type IBeforeFrame,
  type IAfterFrame,
} from './ISystemLifecycleHooks.js';

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
  /**
   * Tick/frame provider. Required. `GameWorld` subscribes to it and does not
   * start or stop it. Single-player hosts pass the provider from
   * `@phalanx-engine/runtime/advanced`.
   */
  tickFrameProvider: ITickFrameProvider;
  /** Object pooling configuration. If omitted, pooling is disabled. */
  pooling?: PoolingConfig;
  /**
   * Match-scoped deterministic RNG. This is the only source. When omitted,
   * {@link GameWorld.random} throws.
   *
   * Multiplayer: call `await client.waitForGameStart()` **before**
   * constructing the world, then pass `random` built from
   * `client.randomSeed`. Create one world per match — RNG is snapshotted
   * here and is not refreshed if the client re-seeds on a later game start.
   */
  random?: IRandom;
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
  beforeTick?: (
    tick: number,
    commands: import('./ITickFrameProvider.js').CommandsBatch
  ) => void;
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
 * Replaces the manual wiring of SystemRegistry and a tick provider with a
 * single entry point. Completely renderer-agnostic. The caller owns the
 * provider and starts it. The single-player provider lives in
 * `@phalanx-engine/runtime`.
 *
 * Single-player usage (provider from `@phalanx-engine/runtime/advanced`):
 * ```ts
 * const world = new GameWorld({ componentTypes, tickFrameProvider: provider });
 * world.registerSystems(tickSystems, frameSystems);
 * provider.start();
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
  private readonly _pools: PoolManager | null;
  private readonly _poolingConfig: PoolingConfig | undefined;

  // Cached systems that implement the optional lifecycle hook interfaces.
  // Built lazily on first registerSystems() call; rebuilt on subsequent calls.
  private beforeTickSystems: IBeforeTick[] = [];
  private afterTickSystems: IAfterTick[] = [];
  private beforeFrameSystems: IBeforeFrame[] = [];
  private afterFrameSystems: IAfterFrame[] = [];

  // Unsubscribe handles for tick/frame
  private unsubscribeTick: Unsubscribe | null = null;
  private unsubscribeFrame: Unsubscribe | null = null;

  // Unsubscribe handles for provider pause/resume signals
  private unsubscribePause: Unsubscribe | null = null;
  private unsubscribeResume: Unsubscribe | null = null;

  // Pause state – when true, both tick and frame pipelines are skipped
  private _paused: boolean = false;

  /** `registerComponent` order. Snapshot schema order and `configHash`. */
  private readonly _components: ComponentRegistration[] = [];

  /** Module save sections, kept sorted by key. */
  private readonly _saveSections: SaveSection[] = [];

  constructor(config: GameWorldConfig) {
    // Create SystemRegistry with eagerly-initialized core deps
    this.systemRegistry = new SystemRegistry(config.componentTypes);

    // Set SoAComponent context so SoA-backed components can resolve stores
    SoAComponent.useEntityManager(this.systemRegistry.entityManager);

    // Setup pooling if configured
    if (config.pooling) {
      this._poolingConfig = config.pooling;
      this._pools = new PoolManager(this.systemRegistry.entityManager);
      for (const [typeKey, typeConfig] of Object.entries(
        config.pooling.entityTypes
      )) {
        this._pools.registerEntityType(typeKey, typeConfig);
      }
    } else {
      this._poolingConfig = undefined;
      this._pools = null;
    }
    this.systemRegistry.getContext().pools = this._pools;
    this.systemRegistry.getContext().world = this;

    this.provider = config.tickFrameProvider;

    if (config.random) {
      this.systemRegistry.getContext().random = config.random;
    }
  }

  /**
   * Allocate the next id from this world and pass it to `create`.
   *
   * Does not register the entity. The caller adds it, or a pool does on
   * spawn. `create` must return the entity for that id.
   */
  public createEntity<E extends Entity>(create: (id: number) => E): E {
    const id = this.entityManager.allocateEntityId();
    const entity = create(id);
    if (entity.id !== id) {
      throw new Error(
        `createEntity: factory must return the entity with id ${String(id)}`
      );
    }
    return entity;
  }

  /**
   * Build an entity with exactly `id` and register it.
   *
   * Used when restoring. Does not rewind the counter around `create`.
   * The high-water mark becomes `max(current, id)`, so a hole does not
   * change the next id. `read` of the `entityIds` section still installs
   * the saved mark afterwards.
   *
   * Pass `create` for a subclass. Without it, the result is a plain
   * {@link Entity}.
   *
   * @throws If `id` is not an integer >= 1, the id is already registered,
   * or `create` returns an entity with a different id.
   */
  public createEntityWithId(id: number): Entity;
  public createEntityWithId<E extends Entity>(
    id: number,
    create: (id: number) => E
  ): E;
  public createEntityWithId<E extends Entity>(
    id: number,
    create?: (id: number) => E
  ): Entity | E {
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new Error(
        `createEntityWithId: id must be an integer >= 1, got ${String(id)}`
      );
    }
    if (this.entityManager.getEntity(id) !== undefined) {
      throw new Error(
        `createEntityWithId: entity ${String(id)} already exists`
      );
    }

    const entity = create === undefined ? new Entity(id) : create(id);
    if (entity.id !== id) {
      throw new Error(
        `createEntityWithId: factory must return the entity with id ${String(id)}`
      );
    }
    if (this.entityManager.getEntity(id) !== undefined) {
      throw new Error(
        `createEntityWithId: factory already registered entity ${String(id)}`
      );
    }

    this.entityManager.claimEntityId(id);
    this.entityManager.addEntity(entity);
    return entity;
  }

  // ── Pause / Resume ───────────────────────────────────────────────────

  /** Whether the world is currently paused */
  public get paused(): boolean {
    return this._paused;
  }

  /**
   * Pause the game world.
   *
   * If the provider implements requestPause (the runtime single-player
   * provider and PhalanxClient do), the request is
   * forwarded to the provider. The world
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

  /** Match-scoped deterministic RNG. Throws if not configured. */
  public get random(): IRandom {
    return this.systemRegistry.getContext().random;
  }

  /** Pool manager. null if pooling is not configured. */
  public get pools(): PoolManager | null {
    return this._pools;
  }

  /** System context (for advanced use) */
  public get context(): SystemContext {
    return this.systemRegistry.getContext();
  }

  /**
   * Register a `defineComponent` result. Order is registration order:
   * the SoA store is created now, the component type is registered for
   * `queryEntities`, and that order plus each field's name and type is
   * folded into `configHash` by the runtime.
   */
  public registerComponent<S extends SoASchemaDefinition>(
    component: ComponentRegistration<S>
  ): void {
    if (this._components.some((existing) => existing.name === component.name)) {
      throw new Error(
        `registerComponent: '${component.name}' is already registered`
      );
    }
    // SoASchema is invariant in its field map. The registry only needs the
    // name, the store key, and create().
    this._components.push(component as unknown as ComponentRegistration);
    this.entityManager.registerComponentTypes([component.type]);
    this.entityManager.getOrCreateSoAStore(component.schema);
  }

  /**
   * Register a module save section. Keys are sorted by UTF-16 code units.
   *
   * @throws If `key` is empty or already registered.
   */
  public registerSaveSection(section: SaveSection): void {
    if (section.key.length === 0) {
      throw new Error('registerSaveSection: key is empty');
    }
    if (this._saveSections.some((existing) => existing.key === section.key)) {
      throw new Error(`registerSaveSection: duplicate key '${section.key}'`);
    }
    this._saveSections.push(section);
    this._saveSections.sort((left, right) =>
      compareSaveSectionKeys(left.key, right.key)
    );
  }

  /** Registered save sections, sorted by key. A copy: mutating it does nothing. */
  public get saveSections(): readonly SaveSection[] {
    return this._saveSections.slice();
  }

  /** Registered component names in registration order. */
  public componentNames(): readonly string[] {
    return this._components.map((component) => component.name);
  }

  /** Registered components in registration order. */
  public registeredComponents(): readonly ComponentRegistration[] {
    return this._components;
  }

  /** Look up a registered system by class */
  public getSystem<T extends GameSystem>(
    systemClass: abstract new (...args: never[]) => T
  ): T | undefined {
    return this.systemRegistry.getContext().getSystem(systemClass);
  }

  // ── System registration ──────────────────────────────────────────────

  /**
   * Register tick and frame systems, then call init() on each.
   * Also collects systems that implement optional lifecycle hook interfaces
   * (IBeforeTick, IAfterTick, IBeforeFrame, IAfterFrame) so GameWorld can
   * invoke them automatically at the right pipeline phase.
   */
  public registerSystems(
    tickSystems: GameSystem[],
    frameSystems: GameSystem[]
  ): void {
    this.systemRegistry.registerSystems(tickSystems, frameSystems);
    this.buildLifecycleCaches();
  }

  private buildLifecycleCaches(): void {
    this.beforeTickSystems = [];
    this.afterTickSystems = [];
    this.beforeFrameSystems = [];
    this.afterFrameSystems = [];

    for (const system of this.systemRegistry.getAllSystems()) {
      if (isBeforeTick(system)) this.beforeTickSystems.push(system);
      if (isAfterTick(system)) this.afterTickSystems.push(system);
      if (isBeforeFrame(system)) this.beforeFrameSystems.push(system);
      if (isAfterFrame(system)) this.afterFrameSystems.push(system);
    }
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
        this.systemRegistry.eventBus.emit(GameWorldEvents.PAUSED, {});
      });
    }
    if (this.provider.onResume) {
      this.unsubscribeResume = this.provider.onResume(() => {
        this._paused = false;
        this.systemRegistry.eventBus.emit(GameWorldEvents.RESUMED, {});
      });
    }

    // Subscribe to tick events
    this.unsubscribeTick = this.provider.onTick((tick, commands) => {
      if (this._paused) return;
      for (const s of this.beforeTickSystems) s.beforeTick(tick, commands);
      hooks?.beforeTick?.(tick, commands);
      this.processAllTicks(tick);
      for (const s of this.afterTickSystems) s.afterTick(tick);
      hooks?.afterTick?.(tick);
    });

    // Subscribe to frame events
    this.unsubscribeFrame = this.provider.onFrame((alpha, dt) => {
      if (this._paused) return;
      for (const s of this.beforeFrameSystems) s.beforeFrame(alpha, dt);
      hooks?.beforeFrame?.(alpha, dt);
      this.updateAll(dt);
      for (const s of this.afterFrameSystems) s.afterFrame(alpha, dt);
      hooks?.afterFrame?.(alpha, dt);
    });
  }

  /**
   * Stop the tick/frame loop (unsubscribe callbacks). Does not stop the provider.
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
  }

  /**
   * Full cleanup: stop loops, drain pools, then dispose all systems.
   */
  public dispose(): void {
    this.stop();
    if (this._pools) {
      this._pools.drainAll();
    }
    this.systemRegistry.dispose();
    SoAComponent.resetContext();
  }
}
