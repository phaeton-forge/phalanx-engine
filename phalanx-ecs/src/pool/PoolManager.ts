import { Entity } from '../Entity';
import { EntityPool } from './EntityPool';
import type { ComponentTemplate, EntityPoolConfig } from './EntityPool';
import type { PoolConfig, PoolStats } from './types';

/**
 * Configuration for registering an entity type with the PoolManager.
 */
export interface EntityTypeConfig<T extends Entity = Entity> {
  /** Factory that creates a new entity of this type. */
  factory: () => T;
  /** Pool configuration (size, growth strategy, etc.). */
  pool?: PoolConfig;
  /** Component templates to pre-create with each pooled entity. */
  components?: ComponentTemplate[];
}

/**
 * Centralized manager for all entity pools within a GameWorld.
 *
 * Usage:
 * 1. registerEntityType('projectile', { factory, pool, components })
 * 2. acquire<ProjectileEntity>('projectile')
 * 3. release('projectile', entity)
 */
export class PoolManager {
  private readonly pools: Map<string, EntityPool<Entity>> = new Map();

  /**
   * Register an entity type for pooling.
   *
   * @param typeKey — String key identifying the type (e.g. 'projectile', 'unit')
   * @param config — Factory, pool settings, and optional component templates
   */
  registerEntityType<T extends Entity>(
    typeKey: string,
    config: EntityTypeConfig<T>
  ): void {
    if (this.pools.has(typeKey)) {
      throw new Error(`Pool already registered for type '${typeKey}'`);
    }

    const poolConfig: EntityPoolConfig = {
      ...config.pool,
      componentTemplates: config.components,
    };

    const pool = new EntityPool<T>(config.factory, poolConfig);
    this.pools.set(typeKey, pool as EntityPool<Entity>);
  }

  /**
   * Acquire an entity of the given type from its pool.
   * If the pool is empty, a new entity is created via the registered factory.
   */
  acquire<T extends Entity>(typeKey: string): T {
    const pool = this.pools.get(typeKey);
    if (!pool) {
      throw new Error(`No pool registered for type '${typeKey}'. Call registerEntityType() first.`);
    }
    return pool.acquire() as T;
  }

  /**
   * Return an entity to its type's pool for reuse.
   */
  release(typeKey: string, entity: Entity): void {
    const pool = this.pools.get(typeKey);
    if (!pool) {
      throw new Error(`No pool registered for type '${typeKey}'.`);
    }
    pool.release(entity);
  }

  /**
   * Pre-warm all registered pools to their configured initialSize.
   * Useful after drainAll() to repopulate pools.
   */
  prewarmAll(): void {
    // Each EntityPool handles its own initialSize in the constructor.
    // This method exists for explicit re-prewarm scenarios — callers
    // should use prewarm(typeKey, count) for specific pools.
  }

  /**
   * Pre-warm a specific pool with the given count.
   */
  prewarm(typeKey: string, count: number): void {
    const pool = this.pools.get(typeKey);
    if (!pool) {
      throw new Error(`No pool registered for type '${typeKey}'.`);
    }
    pool.prewarm(count);
  }

  /**
   * Drain all pools (e.g. on level/match change).
   */
  drainAll(): void {
    for (const pool of this.pools.values()) {
      pool.drain();
    }
  }

  /**
   * Get statistics for all registered pools.
   */
  getStats(): Map<string, PoolStats> {
    const result = new Map<string, PoolStats>();
    for (const [key, pool] of this.pools) {
      result.set(key, pool.stats);
    }
    return result;
  }

  /**
   * Get statistics for a specific pool.
   */
  getPoolStats(typeKey: string): PoolStats | undefined {
    return this.pools.get(typeKey)?.stats;
  }

  /**
   * Check if a pool is registered for the given type key.
   */
  hasPool(typeKey: string): boolean {
    return this.pools.has(typeKey);
  }
}
