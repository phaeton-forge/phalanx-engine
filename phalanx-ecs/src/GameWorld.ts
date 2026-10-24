import { SystemRegistry } from './SystemRegistry.js';
import { Entity } from './Entity.js';
import { PoolManager } from './pool/PoolManager.js';
import type { PoolingConfig } from './pool/types.js';
import type { ITickFrameProvider, Unsubscribe } from './ITickFrameProvider.js';
import type { EventBus } from './EventBus.js';
import type { EntityManager } from './EntityManager.js';
import type { SystemContext } from './SystemContext.js';
import type { GameSystem } from './GameSystem.js';
import type { IRandom } from './IRandom.js';
import type { IComponent } from './Component.js';
import type { ComponentRegistration } from './ComponentRegistration.js';
import {
  assertSoaPatch,
  componentKind,
  type ObjectComponentDef,
  type SoaComponentDef,
  type TransientComponentDef,
} from './defineComponent.js';
import type { SoAFieldsOf, SoASchemaDefinition } from './SoASchema.js';
import type { QueryAnyRow, QueryComponent, QueryRow } from './query.js';
import type { ServiceKey } from './services.js';
import type { StateReader, StateWriter } from './state/StateIO.js';
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
 * `beforeTick` and tick systems run inside the transient-read guard.
 * `afterTick` runs after that guard: presentation (interpolation) reads
 * transient components there.
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
  /**
   * Called after tick systems have been processed (e.g. capture positions).
   * Runs outside the transient-read guard, so it may read interpolation.
   */
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
 * const world = new GameWorld({ tickFrameProvider: provider });
 * world.registerSystems(tickSystems, frameSystems);
 * provider.start();
 * world.start({
 *   afterFrame(alpha, dt) { scene.render(); },
 * });
 * ```
 *
 * Multiplayer usage (with PhalanxClient as tickFrameProvider):
 * ```ts
 * const world = new GameWorld({ tickFrameProvider: client });
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

  /** Object components. Saved as module sections, not SoA stores. */
  private readonly _objectComponents: StoredObjectComponent[] = [];

  /** Transient components. Omitted from saves and from `configHash`. */
  private readonly _transientComponents: TransientComponentDef<object>[] = [];

  /**
   * Nested while a tick pipeline is running. Reading a transient component
   * here throws: tick code may write one and must not branch on it.
   * `afterTick` runs after this returns to zero.
   */
  private _tickDepth = 0;

  /**
   * Entity ids that had each transient component at the last
   * {@link discardTransientComponents}. Physics does not read this list:
   * `readBroadphase` seeds `Interpolation` from `Transform`.
   */
  private readonly _discardedTransient = new Map<symbol, number[]>();

  /** Module save sections, kept sorted by key. */
  private readonly _saveSections: SaveSection[] = [];

  constructor(config: GameWorldConfig) {
    // Create SystemRegistry with eagerly-initialized core deps
    this.systemRegistry = new SystemRegistry();

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
    // Free pooled entities are not in the save. Drop object and transient
    // components when they return so a respawn matches a restored client.
    this._pools?.addReturnToPoolHook((entity) => {
      this.removeEphemeralComponents(entity);
    });

    this.provider = config.tickFrameProvider;

    if (config.random) {
      this.systemRegistry.getContext().random = config.random;
    }
  }

  /**
   * Allocate the next id from this world and pass it to `create`.
   *
   * Does not register the entity. The caller adds it, or a pool does on
   * spawn. `create` must return the entity for that id. SoA rows attached
   * in the constructor are written to this world's stores when `create`
   * returns; until then they cannot be read.
   */
  public createEntity<E extends Entity>(create: (id: number) => E): E {
    const id = this.entityManager.allocateEntityId();
    const entity = create(id);
    if (entity.id !== id) {
      throw new Error(
        `createEntity: factory must return the entity with id ${String(id)}`
      );
    }
    this.entityManager.adopt(entity);
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
   * Register a component.
   *
   * SoA (including a runtime `defineComponent` result): registration order
   * is the snapshot schema order. The store is created now, and that order
   * plus each field's name and type is folded into `configHash`.
   *
   * Object: `save` and `load` are required here. The component is written
   * as a module save section under its name. It is not a SoA schema.
   *
   * Transient: not saved and not included in `configHash`.
   */
  public registerComponent<S extends SoASchemaDefinition>(
    component: ComponentRegistration<S>
  ): void;
  public registerComponent<T extends object>(
    component: ObjectComponentDef<T>
  ): void;
  public registerComponent<T extends object>(
    component: TransientComponentDef<T>
  ): void;
  public registerComponent(
    component:
      | ComponentRegistration
      | ObjectComponentDef<object>
      | TransientComponentDef<object>
  ): void {
    const kind = componentKind(component);
    if (kind === 'object') {
      this.registerObject(component as ObjectComponentDef<object>);
      return;
    }
    if (kind === 'transient') {
      this.registerTransient(component as TransientComponentDef<object>);
      return;
    }
    this.registerSoa(component as ComponentRegistration);
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

  /** SoA component names in registration order. Object and transient are omitted. */
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
   * Reading a transient component from a tick system throws.
   */
  public processAllTicks(tick: number): void {
    this.enterTick();
    try {
      this.systemRegistry.processAllTicks(tick);
    } finally {
      this.leaveTick();
    }
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
   * `afterTick` runs outside the transient-read guard.
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
      this.enterTick();
      try {
        for (const s of this.beforeTickSystems) s.beforeTick(tick, commands);
        hooks?.beforeTick?.(tick, commands);
        this.processAllTicks(tick);
      } finally {
        this.leaveTick();
      }
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
  }

  /**
   * Attach `component` to `entity`. A later call with `values` writes those
   * fields and leaves the rest. The same call without `values` throws when
   * the component is already present.
   */
  public addComponent<S extends SoASchemaDefinition>(
    entity: Entity,
    component: SoaComponentDef<S>,
    values?: Partial<SoAFieldsOf<S>>
  ): void;
  public addComponent<T extends object>(
    entity: Entity,
    component: ObjectComponentDef<T> | TransientComponentDef<T>,
    values?: Partial<T>
  ): void;
  public addComponent(
    entity: Entity,
    component:
      | SoaComponentDef
      | ObjectComponentDef<object>
      | TransientComponentDef<object>,
    values?: object
  ): void {
    this.assertEntity(entity, 'world.addComponent');
    this.assertRegistered(component, 'world.addComponent');
    if (componentKind(component) === 'soa') {
      this.addSoa(entity, component as SoaComponentDef, values);
      return;
    }
    this.addValue(
      entity,
      component as ObjectComponentDef<object> | TransientComponentDef<object>,
      values
    );
  }

  /**
   * Current value of `component` on `entity`, or `undefined` when absent.
   * A SoA result is a copy. An object or transient result is the stored
   * instance. Reading a transient component during a tick throws.
   */
  public getComponent<S extends SoASchemaDefinition>(
    entity: Entity,
    component: SoaComponentDef<S>
  ): SoAFieldsOf<S> | undefined;
  public getComponent<T extends object>(
    entity: Entity,
    component: ObjectComponentDef<T> | TransientComponentDef<T>
  ): T | undefined;
  public getComponent(
    entity: Entity,
    component:
      | SoaComponentDef
      | ObjectComponentDef<object>
      | TransientComponentDef<object>
  ): object | undefined {
    this.assertEntity(entity, 'world.getComponent');
    if (componentKind(component) === 'transient' && this._tickDepth > 0) {
      throw new Error(
        `tick system must not branch on transient component '${component.name}'`
      );
    }
    this.assertRegistered(component, 'world.getComponent');
    if (componentKind(component) === 'soa') {
      return this.readSoa(entity, component as SoaComponentDef);
    }
    return this.readValue(entity, component.type);
  }

  /** Detach `component` from `entity`. Returns whether it was present. */
  public removeComponent(
    entity: Entity,
    component: { readonly name: string; readonly type: symbol }
  ): boolean {
    this.assertEntity(entity, 'world.removeComponent');
    this.assertRegistered(component, 'world.removeComponent');
    const soa = this.soaRegistration(component.type);
    if (soa !== undefined) {
      const store = this.entityManager.getSoAStore(soa.schema);
      const hadRow = store?.remove(entity.id) ?? false;
      return this.detach(entity, component.type) || hadRow;
    }
    return this.detach(entity, component.type);
  }

  /**
   * Provide `impl` under `key` for this world. Systems read it with
   * `context.getService(key)`. Throws when `key` is already provided, or
   * when another key with the same name is (two copies of one package).
   */
  public provide<T>(key: ServiceKey<T>, impl: T): void {
    this.context.provide(key, impl);
  }

  /**
   * Entities that have every component, ascending by id, as
   * `[entity, ...slots]`. A SoA slot is the row index in that component's
   * store; an object or transient slot is the stored value.
   *
   * The id list is taken when the loop starts. An entity removed, or one
   * that lost a component, before its turn is skipped. Entities created
   * during the loop are not visited in this pass. The row array is reused
   * between steps; do not keep it. A row index is valid until the next add
   * or remove in that store (removal swaps the last row into the hole), so
   * read it inside the step. Reading a transient component during a tick
   * throws.
   */
  public query<const Cs extends readonly QueryComponent[]>(
    ...components: Cs
  ): Iterable<QueryRow<Cs>> {
    return this.queryRows(components, true) as Iterable<QueryRow<Cs>>;
  }

  /**
   * Entities that have at least one of the components, ascending by id.
   * An absent component is `undefined`. Same iteration rules as
   * {@link query}.
   */
  public queryAny<const Cs extends readonly QueryComponent[]>(
    ...components: Cs
  ): Iterable<QueryAnyRow<Cs>> {
    return this.queryRows(components, false) as Iterable<QueryAnyRow<Cs>>;
  }

  private *queryRows(
    components: readonly QueryComponent[],
    requireAll: boolean
  ): Generator<unknown[]> {
    const label = requireAll ? 'world.query' : 'world.queryAny';
    for (const component of components) {
      this.assertRegistered(component, label);
      if (componentKind(component) === 'transient' && this._tickDepth > 0) {
        throw new Error(
          `tick system must not branch on transient component '${component.name}'`
        );
      }
    }
    const types = components.map((component) => component.type);
    const manager = this.entityManager;
    const ids = (
      requireAll
        ? manager.queryEntities(...types)
        : manager.queryEntitiesAny(...types)
    ).map((entity) => entity.id);
    const row: unknown[] = new Array<unknown>(components.length + 1);
    for (const id of ids) {
      const entity = manager.getEntity(id);
      if (entity === undefined || entity.isDestroyed) continue;
      let present = 0;
      for (let i = 0; i < components.length; i++) {
        const slot = this.querySlot(entity, components[i]);
        if (slot !== undefined) present++;
        row[i + 1] = slot;
      }
      if (present === 0 || (requireAll && present < components.length)) {
        continue;
      }
      row[0] = entity;
      yield row;
    }
  }

  private querySlot(entity: Entity, component: QueryComponent): unknown {
    if (!entity._componentAttached(component.type)) return undefined;
    if (componentKind(component) === 'soa') {
      const store = this.entityManager.getSoAStore(
        (component as SoaComponentDef).schema
      );
      const index = store?.indexOf(entity.id) ?? -1;
      return index === -1 ? undefined : index;
    }
    return this.readValue(entity, component.type);
  }

  /**
   * Drop every transient component. `restoreWorld` calls this before module
   * save sections run. Physics ignores the recorded ids and seeds
   * `Interpolation` from `Transform` for every body.
   */
  public discardTransientComponents(): void {
    this._discardedTransient.clear();
    for (const component of this._transientComponents) {
      const entities = this.entityManager.queryEntities(component.type);
      const ids: number[] = [];
      for (const entity of entities) {
        ids.push(entity.id);
        this.detach(entity, component.type);
      }
      this._discardedTransient.set(component.type, ids);
    }
  }

  /**
   * Entity ids that held `type` when {@link discardTransientComponents}
   * last ran. Empty when that type was not registered or nobody had it.
   * Physics does not read this. `readBroadphase` attaches `Interpolation`
   * to every `Transform` + `PhysicsBody` and copies the transform into
   * both samples.
   */
  public discardedTransientIds(type: symbol): readonly number[] {
    return this._discardedTransient.get(type) ?? [];
  }

  private registerSoa(component: ComponentRegistration): void {
    this.assertNameFree(component.name);
    // SoASchema is invariant in its field map. The registry only needs the
    // name, the store key, and create().
    this._components.push(component);
    this.entityManager.getOrCreateSoAStore(component.schema);
  }

  private registerObject(component: ObjectComponentDef<object>): void {
    if (
      typeof component.save !== 'function' ||
      typeof component.load !== 'function'
    ) {
      throw new Error(
        `registerComponent: object component '${component.name}' requires save and load`
      );
    }
    this.assertNameFree(component.name);
    const stored: StoredObjectComponent = {
      name: component.name,
      type: component.type,
      create: () =>
        requireComponentObject(component.name, 'create', component.create()),
      save: (value, writer) => {
        component.save?.(value, writer);
      },
      load: (reader) =>
        requireComponentObject(
          component.name,
          'load',
          component.load?.(reader)
        ),
    };
    this._objectComponents.push(stored);
    this.registerSaveSection({
      key: component.name,
      version: 1,
      write: (writer, world) => {
        writeObjectComponent(world, stored, writer);
      },
      read: (reader, world) => {
        readObjectComponent(world, stored, reader);
      },
    });
  }

  private registerTransient(component: TransientComponentDef<object>): void {
    if (typeof component.create !== 'function') {
      throw new Error(
        `defineComponent: transient component '${component.name}' requires create`
      );
    }
    this.assertNameFree(component.name);
    this._transientComponents.push(component);
    this.entityManager.registerTransientComponent(
      component.type,
      component.name
    );
  }

  private assertNameFree(name: string): void {
    if (this.componentNameTaken(name)) {
      throw new Error(`registerComponent: '${name}' is already registered`);
    }
  }

  private componentNameTaken(name: string): boolean {
    if (this._components.some((existing) => existing.name === name)) {
      return true;
    }
    if (this._objectComponents.some((existing) => existing.name === name)) {
      return true;
    }
    if (this._transientComponents.some((existing) => existing.name === name)) {
      return true;
    }
    return this._saveSections.some((existing) => existing.key === name);
  }

  private assertEntity(entity: Entity, label: string): void {
    if (this.entityManager.getEntity(entity.id) !== entity) {
      throw new Error(
        `${label}: entity ${String(entity.id)} is not in this world`
      );
    }
  }

  private assertRegistered(
    component: { readonly name: string; readonly type: symbol },
    label: string
  ): void {
    if (!this.ownsComponent(component.type)) {
      throw new Error(
        `${label}: component '${component.name}' is not registered`
      );
    }
  }

  private soaRegistration(type: symbol): ComponentRegistration | undefined {
    for (const existing of this._components) {
      if (existing.type === type) return existing;
    }
    return undefined;
  }

  private ownsComponent(type: symbol): boolean {
    if (this._components.some((existing) => existing.type === type)) {
      return true;
    }
    if (this._objectComponents.some((existing) => existing.type === type)) {
      return true;
    }
    return this._transientComponents.some((existing) => existing.type === type);
  }

  private addSoa(
    entity: Entity,
    component: SoaComponentDef,
    values: object | undefined
  ): void {
    const store = this.entityManager.getOrCreateSoAStore(component.schema);
    const hasRow = store.indexOf(entity.id) !== -1;
    const hasComponent = entity._componentAttached(component.type);
    if (hasRow !== hasComponent) {
      throw new Error(
        `world.addComponent: entity ${String(entity.id)} component '${component.name}' is out of sync with its store`
      );
    }
    const patch = values as
      Partial<SoAFieldsOf<SoASchemaDefinition>> | undefined;
    if (hasRow) {
      if (patch === undefined) {
        throw new Error(
          `world.addComponent: entity ${String(entity.id)} already has '${component.name}'`
        );
      }
      assertSoaPatch(component, patch);
      store.set(entity.id, omitUndefinedSoaFields(patch));
      return;
    }
    entity.addComponent(component.create(entity.id, patch, this.entityManager));
    this.entityManager.onComponentAdded(entity, component.type);
  }

  private addValue(
    entity: Entity,
    component: ObjectComponentDef<object> | TransientComponentDef<object>,
    values: object | undefined
  ): void {
    const existing = this.readValue(entity, component.type);
    if (existing !== undefined) {
      if (values === undefined) {
        throw new Error(
          `world.addComponent: entity ${String(entity.id)} already has '${component.name}'`
        );
      }
      assignComponentValues(component.name, existing, values);
      return;
    }
    const created = requireComponentObject(
      component.name,
      'create',
      component.create()
    );
    if (values !== undefined) {
      assignComponentValues(component.name, created, values);
    }
    entity.addComponent(new ValueComponent(component.type, created));
    this.entityManager.onComponentAdded(entity, component.type);
  }

  private readSoa(
    entity: Entity,
    component: SoaComponentDef
  ): object | undefined {
    const store = this.entityManager.getSoAStore(component.schema);
    const hasRow = store !== undefined && store.indexOf(entity.id) !== -1;
    const hasComponent = entity._componentAttached(component.type);
    if (hasRow !== hasComponent) {
      throw new Error(
        `world.getComponent: entity ${String(entity.id)} component '${component.name}' is out of sync with its store`
      );
    }
    return store?.get(entity.id);
  }

  private readValue(entity: Entity, type: symbol): object | undefined {
    return entity._peekComponent<ValueComponent>(type)?.value;
  }

  /** Object and transient components do not survive a return to the pool. */
  private removeEphemeralComponents(entity: Entity): void {
    for (const component of this._objectComponents) {
      this.removeEphemeral(entity, component.type);
    }
    for (const component of this._transientComponents) {
      this.removeEphemeral(entity, component.type);
    }
  }

  private removeEphemeral(entity: Entity, type: symbol): void {
    if (!entity._componentAttached(type)) return;
    entity.removeComponent(type);
    if (this.entityManager.getEntity(entity.id) === entity) {
      this.entityManager.onComponentRemoved(entity, type);
    }
  }

  private detach(entity: Entity, type: symbol): boolean {
    const had = entity.removeComponent(type);
    if (had) this.entityManager.onComponentRemoved(entity, type);
    return had;
  }

  private enterTick(): void {
    this._tickDepth += 1;
    this.entityManager.enterComponentReads();
  }

  private leaveTick(): void {
    this._tickDepth -= 1;
    this.entityManager.leaveComponentReads();
  }
}

/**
 * Holder for an object or transient `defineComponent` value.
 * `world.addComponent` and direct attaches (such as interpolation) use this one
 * class, so a later `world.getComponent` reads the same object.
 */
export class ValueComponent<T extends object = object> implements IComponent {
  public constructor(
    public readonly type: symbol,
    public value: T
  ) {}
}

interface StoredObjectComponent {
  readonly name: string;
  readonly type: symbol;
  create(): object;
  save(value: object, writer: StateWriter): void;
  load(reader: StateReader): object;
}

function requireComponentObject(
  name: string,
  verb: 'create' | 'load',
  value: unknown
): object {
  if (value === null || typeof value !== 'object') {
    throw new Error(
      `defineComponent '${name}': ${verb}() must return an object`
    );
  }
  return value;
}

function omitUndefinedSoaFields<S extends SoASchemaDefinition>(
  values: Partial<SoAFieldsOf<S>>
): Partial<SoAFieldsOf<S>> {
  for (const key of Object.keys(values)) {
    if (values[key as keyof S & string] !== undefined) continue;
    const defined = {} as Partial<SoAFieldsOf<S>>;
    for (const name of Object.keys(values)) {
      const field = values[name as keyof S & string];
      if (field !== undefined) {
        defined[name as keyof S & string] = field;
      }
    }
    return defined;
  }
  return values;
}

function assignComponentValues(
  name: string,
  target: object,
  values: object
): void {
  if (values === null || typeof values !== 'object') {
    throw new Error(`world.addComponent: '${name}' values must be an object`);
  }
  Object.assign(target, values);
}

function writeObjectComponent(
  world: GameWorld,
  component: StoredObjectComponent,
  writer: StateWriter
): void {
  const entities = world.entityManager.queryEntities(component.type);
  writer.list(entities, (entity, item) => {
    item.u32(entity.id);
    const held = entity._peekComponent<ValueComponent>(component.type);
    if (held === undefined) {
      throw new Error(
        `save: entity ${String(entity.id)} is missing '${component.name}'`
      );
    }
    component.save(held.value, item);
  });
}

function readObjectComponent(
  world: GameWorld,
  component: StoredObjectComponent,
  reader: StateReader
): void {
  const saved = new Set<number>();
  reader.list((item) => {
    const id = item.u32();
    const value = component.load(item);
    const entity = world.entityManager.getEntity(id);
    if (entity === undefined) {
      throw new Error(
        `restore: object component '${component.name}' entity ${String(id)} is missing`
      );
    }
    const existing = entity._peekComponent<ValueComponent>(component.type);
    if (existing !== undefined) {
      existing.value = value;
    } else {
      entity.addComponent(new ValueComponent(component.type, value));
      world.entityManager.onComponentAdded(entity, component.type);
    }
    saved.add(id);
    return id;
  });
  const live = world.entityManager.queryEntities(component.type);
  for (const entity of live) {
    if (!saved.has(entity.id)) {
      const had = entity.removeComponent(component.type);
      if (had) world.entityManager.onComponentRemoved(entity, component.type);
    }
  }
}
