import type { IPoolable } from './IPoolable';
import type { PoolStats, ResolvedPoolConfig, PoolConfig } from './types';
import { resolvePoolConfig } from './types';

/**
 * Generic object pool that reuses IPoolable instances to avoid GC pressure.
 *
 * Uses a stack (LIFO) for deterministic acquire order.
 * Objects are reset() on release and again on acquire for safety.
 */
export class ObjectPool<T extends IPoolable> {
  private readonly available: T[] = [];
  private readonly factory: () => T;
  private readonly config: ResolvedPoolConfig;
  private _totalCreated: number = 0;
  private _acquireCount: number = 0;
  private _releaseCount: number = 0;
  private _missCount: number = 0;

  constructor(factory: () => T, config?: PoolConfig) {
    this.factory = factory;
    this.config = resolvePoolConfig(config);

    if (this.config.initialSize > 0) {
      this.prewarm(this.config.initialSize);
    }
  }

  /**
   * Acquire an object from the pool.
   * If the pool is empty, creates new object(s) according to the growth strategy.
   * The returned object has been reset() to a clean state.
   */
  acquire(): T {
    this._acquireCount++;

    if (this.available.length === 0) {
      this._missCount++;

      if (this.config.growthStrategy === 'grow') {
        this.growBatch();
      }

      // If still empty after batch grow (shouldn't happen) or strategy is 'create'
      if (this.available.length === 0) {
        this._totalCreated++;
        const obj = this.factory();
        obj.reset();
        return obj;
      }
    }

    const obj = this.available.pop()!;
    obj.reset();
    return obj;
  }

  /**
   * Return an object to the pool. Calls reset() on the object.
   * If the pool is at maxSize, the object is discarded.
   */
  release(obj: T): void {
    this._releaseCount++;
    obj.reset();

    if (this.config.maxSize > 0 && this.available.length >= this.config.maxSize) {
      return; // Discard — pool is full
    }

    this.available.push(obj);
  }

  /**
   * Pre-allocate a given number of objects into the pool.
   */
  prewarm(count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.config.maxSize > 0 && this.available.length >= this.config.maxSize) {
        break;
      }
      const obj = this.factory();
      obj.reset();
      this._totalCreated++;
      this.available.push(obj);
    }
  }

  /**
   * Clear the pool, discarding all available objects.
   */
  drain(): void {
    this.available.length = 0;
  }

  /** Number of objects currently available for acquire. */
  get availableCount(): number {
    return this.available.length;
  }

  /** Total number of objects ever created by this pool. */
  get totalCreated(): number {
    return this._totalCreated;
  }

  /** Runtime statistics snapshot. */
  get stats(): PoolStats {
    return {
      available: this.available.length,
      totalCreated: this._totalCreated,
      acquireCount: this._acquireCount,
      releaseCount: this._releaseCount,
      missCount: this._missCount,
    };
  }

  /**
   * Batch-create objects according to growthBatchSize.
   */
  private growBatch(): void {
    const batchSize = this.config.growthBatchSize;
    for (let i = 0; i < batchSize; i++) {
      if (this.config.maxSize > 0 && this.available.length >= this.config.maxSize) {
        break;
      }
      const obj = this.factory();
      obj.reset();
      this._totalCreated++;
      this.available.push(obj);
    }
  }
}
