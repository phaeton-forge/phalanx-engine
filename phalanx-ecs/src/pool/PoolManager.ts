import type { Entity } from '../Entity';
import { EntityPool } from './EntityPool';
import type { EntityTypeConfig, PoolStats } from './types';

/**
 * Central manager for entity pools.
 * One PoolManager per GameWorld.
 */
export class PoolManager {
  private readonly pools: Map<string, EntityPool<Entity>> = new Map();
  private readonly initialSizes: Map<string, number> = new Map();

  /**
   * Register an entity type for pooling.
   */
  registerEntityType<T extends Entity>(
    typeKey: string,
    config: EntityTypeConfig<T>
  ): void {
    if (this.pools.has(typeKey)) {
      throw new Error(`Pool '${typeKey}' is already registered`);
    }

    const pool = new EntityPool<T>(config.factory, {
      ...config.pool,
      componentTemplates: config.components,
    });

    this.pools.set(typeKey, pool);
    this.initialSizes.set(typeKey, config.pool?.initialSize ?? 0);
  }

  /**
   * Acquire an entity from the named pool.
   * Sets _poolTypeKey on the entity for later release.
   */
  acquire<T extends Entity>(typeKey: string): T {
    const pool = this.pools.get(typeKey);
    if (!pool) {
      throw new Error(`Pool '${typeKey}' is not registered`);
    }

    const entity = pool.acquire() as T;
    entity._poolTypeKey = typeKey;
    return entity;
  }

  /** Release an entity back to its pool. */
  release(typeKey: string, entity: Entity): void {
    const pool = this.pools.get(typeKey);
    if (!pool) {
      throw new Error(`Pool '${typeKey}' is not registered`);
    }

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
}
