import type { IPoolable } from './IPoolable';
import type { PoolConfig, PoolStats } from './types';

/**
 * Generic object pool for any IPoolable type.
 * Uses a LIFO stack for cache-friendly reuse.
 */
export class ObjectPool<T extends IPoolable> {
  private readonly available: T[] = [];
  private readonly factory: () => T;
  private readonly config: Required<PoolConfig>;

  private _totalCreated: number = 0;
  private _acquireCount: number = 0;
  private _releaseCount: number = 0;
  private _missCount: number = 0;

  constructor(factory: () => T, config?: PoolConfig) {
    this.factory = factory;
    this.config = {
      initialSize: config?.initialSize ?? 0,
      maxSize: config?.maxSize ?? 0,
      growthStrategy: config?.growthStrategy ?? 'create',
      growthBatchSize: config?.growthBatchSize ?? 8,
    };
  }

  /** Take an object from the pool, or create a new one. */
  acquire(): T {
    this._acquireCount++;

    if (this.available.length > 0) {
      return this.available.pop()!;
    }

    // Pool miss
    this._missCount++;

    if (this.config.growthStrategy === 'grow') {
      // Batch create, push all but one to available
      const batch = this.config.growthBatchSize;
      for (let i = 1; i < batch; i++) {
        this.available.push(this.factory());
        this._totalCreated++;
      }
    }

    this._totalCreated++;
    return this.factory();
  }

  /** Return an object to the pool. Calls reset(). */
  release(obj: T): void {
    this._releaseCount++;
    obj.reset();

    // Respect maxSize (0 = unlimited)
    if (this.config.maxSize === 0 || this.available.length < this.config.maxSize) {
      this.available.push(obj);
    }
  }

  /** Pre-allocate objects into the pool. */
  prewarm(count: number): void {
    const toCreate = count - this.available.length;
    for (let i = 0; i < toCreate; i++) {
      this.available.push(this.factory());
      this._totalCreated++;
    }
  }

  /** Clear all pooled objects. */
  drain(): void {
    this.available.length = 0;
  }

  get availableCount(): number {
    return this.available.length;
  }

  get totalCreated(): number {
    return this._totalCreated;
  }

  get stats(): PoolStats {
    return {
      available: this.available.length,
      totalCreated: this._totalCreated,
      acquireCount: this._acquireCount,
      releaseCount: this._releaseCount,
      missCount: this._missCount,
    };
  }
}
