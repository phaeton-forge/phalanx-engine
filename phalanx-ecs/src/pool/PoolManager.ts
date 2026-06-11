import type { Entity } from '../Entity';
import type { EntityManager } from '../EntityManager';
import type { IPoolableEntity, SpawnArgsOf } from './IPoolableEntity';
import { isPoolableComponent } from './IPoolableComponent';
import { EntityPool } from './EntityPool';
import type { EntityTypeConfig, PoolStats } from './types';

/**
 * Central manager for entity pools. One PoolManager per GameWorld.
 *
 * Orchestrates the full spawn/despawn lifecycle:
 *   spawn:   acquire → component onSpawn() → entity.onSpawn(args) → entityManager.addEntity()
 *   despawn: entityManager.removeEntity() → entity.onDespawn() → component onDespawn() → release
 */
export class PoolManager {
  private readonly pools: Map<string, EntityPool<Entity>> = new Map();
  private readonly initialSizes: Map<string, number> = new Map();

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

  /** entityManager.removeEntity() → entity.onDespawn() → component onDespawn() hooks → release. */
  despawn(entity: Entity): void {
    const typeKey = entity._poolTypeKey;
    if (!typeKey) {
      throw new Error('despawn() called on an entity that was not created by PoolManager');
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

  /** Entity game-teardown first, mechanical component cleanup last (inverse of spawn). */
  private runDespawnHooks(entity: Entity): void {
    (entity as Entity & IPoolableEntity<unknown>).onDespawn();
    for (const component of entity.getComponents().values()) {
      if (isPoolableComponent(component)) component.onDespawn();
    }
  }
}
