import type { Entity } from '../Entity.js';
import type { EntityManager } from '../EntityManager.js';
import type { IPoolableEntity, SpawnArgsOf } from './IPoolableEntity.js';
import { isPoolableComponent } from './IPoolableComponent.js';
import { EntityPool } from './EntityPool.js';
import type { EntityTypeConfig, PoolStats } from './types.js';

/**
 * Central manager for entity pools. One PoolManager per GameWorld.
 *
 * Orchestrates the full spawn/despawn lifecycle:
 *   spawn:   acquire → component onSpawn() → entity.onSpawn(args) → entityManager.addEntity()
 *   despawn: entityManager.removeEntity() → entity.onDespawn() → component onDespawn()
 *            → return-to-pool hooks → release
 */
export class PoolManager {
  private readonly pools: Map<string, EntityPool<Entity>> = new Map();
  private readonly initialSizes: Map<string, number> = new Map();
  /** Raw factories, without the dormant-hook wrapper passed to each pool. */
  private readonly rawFactories: Map<string, () => Entity> = new Map();
  /**
   * Runs after entity and component despawn hooks, in registration order.
   * `createAbilitySystem` installs the GAS reset here. Hooks must be
   * idempotent: the factory, `despawn`, and snapshot restore all call them.
   */
  private readonly returnToPoolHooks: Array<(entity: Entity) => void> = [];

  constructor(private readonly entityManager: EntityManager) {}

  /**
   * Register an entity type for pooling. The factory is wrapped so every
   * freshly created entity starts in a dormant state (despawn hooks fired,
   * _inPool = true) before its first spawn.
   */
  registerEntityType<T extends Entity & IPoolableEntity<any>>(
    typeKey: string,
    config: EntityTypeConfig<T>
  ): void {
    if (this.pools.has(typeKey)) {
      throw new Error(`Pool '${typeKey}' is already registered`);
    }

    this.rawFactories.set(typeKey, () => config.factory());

    const factory = (): T => {
      const entity = config.factory();
      entity._poolTypeKey = typeKey;
      entity._inPool = true;
      this.runDespawnHooks(entity);
      return entity;
    };

    this.pools.set(typeKey, new EntityPool<T>(factory, config.pool));
    this.initialSizes.set(typeKey, config.pool?.initialSize ?? 0);
  }

  /** Acquire → component onSpawn() hooks → entity.onSpawn(args) → entityManager.addEntity(). */
  spawn<T extends Entity & IPoolableEntity<any>>(
    typeKey: string,
    ...args: SpawnArgsOf<T>
  ): T {
    const pool = this.pools.get(typeKey);
    if (!pool) {
      throw new Error(`Pool '${typeKey}' is not registered`);
    }

    const entity = pool.acquire() as T;
    entity._inPool = false;

    // 1. Mechanical restore: SoA rows re-added with constructor defaults, etc.
    for (const component of entity.getComponents().values()) {
      if (isPoolableComponent(component)) component.onSpawn();
    }
    // 2. Domain init: per-spawn values via typed setters.
    entity.onSpawn(args[0] as any);
    // 3. Register with the world.
    this.entityManager.addEntity(entity);
    return entity;
  }

  /**
   * Register a hook that runs when an entity returns to the pool.
   *
   * Called after `onDespawn` hooks and before `release`, including the
   * factory's initial dormant transition. A later registration is appended.
   * The hook must be idempotent and must not allocate.
   */
  public addReturnToPoolHook(hook: (entity: Entity) => void): void {
    this.returnToPoolHooks.push(hook);
  }

  /**
   * Entity and component despawn hooks, then return-to-pool hooks.
   *
   * Does not change pool membership. Restore uses this to park a free-list
   * entity that was just constructed.
   */
  public runDormantHooks(entity: Entity): void {
    this.runDespawnHooks(entity);
  }

  /** entityManager.removeEntity() → onDespawn hooks → return-to-pool hooks → release. */
  despawn(entity: Entity): void {
    const typeKey = entity._poolTypeKey;
    if (!typeKey) {
      throw new Error(
        'despawn() called on an entity that was not created by PoolManager'
      );
    }
    if (entity._inPool) {
      return; // double-despawn guard
    }

    const pool = this.pools.get(typeKey)!;
    this.entityManager.removeEntity(entity);
    this.runDespawnHooks(entity);
    entity._inPool = true;
    pool.release(entity);
  }

  /** Prewarm all registered pools using their configured initialSize. */
  prewarmAll(): void {
    for (const [typeKey, initialSize] of this.initialSizes) {
      if (initialSize > 0) {
        const pool = this.pools.get(typeKey);
        if (pool) {
          pool.prewarm(initialSize);
        }
      }
    }
  }

  /** Prewarm a specific pool to the given count. */
  prewarm(typeKey: string, count: number): void {
    const pool = this.pools.get(typeKey);
    if (!pool) {
      throw new Error(`Pool '${typeKey}' is not registered`);
    }
    pool.prewarm(count);
  }

  /** Drain all pools. */
  drainAll(): void {
    for (const pool of this.pools.values()) {
      pool.drain();
    }
  }

  /** Get stats for all pools. */
  getStats(): Map<string, PoolStats> {
    const result = new Map<string, PoolStats>();
    for (const [key, pool] of this.pools) {
      result.set(key, pool.stats);
    }
    return result;
  }

  /** Get stats for a specific pool. */
  getPoolStats(typeKey: string): PoolStats | undefined {
    return this.pools.get(typeKey)?.stats;
  }

  /**
   * Registered pool type keys in registration order.
   * That order is the order `entityTypes` was registered and is part of
   * the snapshot; callers must not sort it.
   */
  public typeKeys(): readonly string[] {
    return [...this.pools.keys()];
  }

  /**
   * Owned entity ids for `typeKey`, in creation order.
   * See {@link EntityPool.ownedIds}.
   */
  public ownedIds(typeKey: string): readonly number[] {
    return this.requirePool(typeKey).ownedIds();
  }

  /**
   * Free-list ids for `typeKey`, oldest release first.
   * The next {@link spawn} pops the last id. See {@link EntityPool.freeListIds}.
   */
  public freeListIds(typeKey: string): readonly number[] {
    return this.requirePool(typeKey).freeListIds();
  }

  /**
   * Construct one entity with the raw factory.
   *
   * Does not run `onSpawn` / `onDespawn`, does not set `_poolTypeKey`, and
   * does not register the entity. The id is whatever the factory's
   * constructor allocates from the current counter. {@link restore} adopts
   * the instance afterwards.
   *
   * @throws If `typeKey` is not registered.
   */
  public createForRestore(typeKey: string): Entity {
    const factory = this.rawFactories.get(typeKey);
    if (!factory) {
      throw new Error(`Pool '${typeKey}' is not registered`);
    }
    return factory();
  }

  /**
   * Dispose prewarmed free entities so a snapshot can reuse their ids.
   *
   * `start()` prewarms by default. Those entities sit on the free list,
   * were never registered, and already consumed ids. They are removed from
   * the SoA stores and `dispose`d without `addEntity`. A checked-out entity,
   * or a free entity that is already registered, is left in place and this
   * throws.
   *
   * @throws If `typeKey` is not registered, or the pool is not entirely
   * dormant and unregistered.
   */
  public discardPrewarmed(typeKey: string): void {
    const pool = this.requirePool(typeKey);
    const ownedIds = pool.ownedIds();
    if (ownedIds.length === 0) return;
    const free = new Set(pool.freeListIds());
    for (const id of ownedIds) {
      if (!free.has(id) || this.entityManager.getEntity(id) !== undefined) {
        throw new Error(`Pool '${typeKey}' is not empty`);
      }
    }
    for (const entity of pool.takeDormant()) {
      this.entityManager.removeEntity(entity);
      entity.dispose();
    }
  }

  /**
   * Replace the owned set and free list of `typeKey`.
   *
   * Discards a prewarmed free list first ({@link discardPrewarmed}).
   * `entitiesInCreationOrder` is the entities the pool should reference,
   * in creation order. `freeListIds` lists the free ones from oldest
   * release to newest; the next {@link spawn} pops the last id. Entities
   * whose ids are absent from `freeListIds` stay checked out.
   *
   * Does not create entities or change ids. The caller supplies the
   * instances the snapshot described. Build them with
   * {@link createForRestore} when the snapshot must allocate those ids.
   *
   * @throws If `typeKey` is not registered, the pool has checked-out
   * entities, or the id lists are inconsistent.
   */
  public restore(
    typeKey: string,
    entitiesInCreationOrder: readonly Entity[],
    freeListIds: readonly number[]
  ): void {
    this.discardPrewarmed(typeKey);
    const pool = this.requirePool(typeKey);
    pool.adopt(entitiesInCreationOrder, freeListIds);
    for (const entity of entitiesInCreationOrder) {
      entity._poolTypeKey = typeKey;
    }
  }

  private requirePool(typeKey: string): EntityPool<Entity> {
    const pool = this.pools.get(typeKey);
    if (!pool) {
      throw new Error(`Pool '${typeKey}' is not registered`);
    }
    return pool;
  }

  /** Entity game-teardown first, mechanical component cleanup, then pool hooks. */
  private runDespawnHooks(entity: Entity): void {
    (entity as Entity & IPoolableEntity<unknown>).onDespawn();
    for (const component of entity.getComponents().values()) {
      if (isPoolableComponent(component)) component.onDespawn();
    }
    for (let index = 0; index < this.returnToPoolHooks.length; index += 1) {
      const hook = this.returnToPoolHooks[index];
      if (hook !== undefined) hook(entity);
    }
  }
}
