import type { IResettableComponent } from './IResettableComponent';
import { ObjectPool } from './ObjectPool';
import type { PoolConfig, PoolStats } from './types';

/**
 * Registry of component-level pools.
 * Used when components need to be pooled independently of entity templates.
 */
export class ComponentPoolRegistry {
  private readonly pools: Map<symbol, ObjectPool<IResettableComponent>> = new Map();

  /**
   * Register a pool for a component type.
   */
  register<T extends IResettableComponent>(
    componentType: symbol,
    factory: () => T,
    config?: PoolConfig
  ): void {
    if (this.pools.has(componentType)) {
      throw new Error(`Component pool already registered for type '${String(componentType)}'`);
    }
    this.pools.set(
      componentType,
      new ObjectPool<IResettableComponent>(factory, config)
    );
  }

  /**
   * Acquire a component from its pool.
   */
  acquire<T extends IResettableComponent>(componentType: symbol): T {
    const pool = this.pools.get(componentType);
    if (!pool) {
      throw new Error(
        `No component pool registered for type '${String(componentType)}'. Call register() first.`
      );
    }
    return pool.acquire() as T;
  }

  /**
   * Return a component to its pool.
   */
  release(component: IResettableComponent): void {
    const pool = this.pools.get(component.type);
    if (pool) {
      pool.release(component);
    }
  }

  /**
   * Get statistics for a component pool.
   */
  getPoolStats(componentType: symbol): PoolStats | undefined {
    return this.pools.get(componentType)?.stats;
  }

  /**
   * Drain all component pools.
   */
  drainAll(): void {
    for (const pool of this.pools.values()) {
      pool.drain();
    }
  }
}
