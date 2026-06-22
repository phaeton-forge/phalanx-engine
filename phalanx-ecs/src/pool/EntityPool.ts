import type { Entity } from '../Entity';
import type { PoolConfig, PoolStats, ResolvedPoolConfig } from './types';
import { resolvePoolConfig } from './types';

/**
 * Pure storage, growth, and stats container for pooled entities.
 *
 * Pooled entities keep stable IDs across release/acquire cycles — SoA-backed
 * component rows remain keyed to the same entity ID for the entity's entire
 * lifetime. Spawn/despawn lifecycle hooks (IPoolableEntity / IPoolableComponent)
 * are orchestrated by PoolManager, not here.
 */
export class EntityPool<T extends Entity = Entity> {
  private readonly available: T[] = [];
  private readonly entityFactory: () => T;
  private readonly config: ResolvedPoolConfig;

  private _totalCreated: number = 0;
  private _acquireCount: number = 0;
  private _releaseCount: number = 0;
  private _missCount: number = 0;

  constructor(entityFactory: () => T, config?: PoolConfig) {
    this.entityFactory = entityFactory;
    this.config = resolvePoolConfig(config);
  }

  /**
   * Get an entity from the pool.
   * Reused entities keep their original IDs to preserve SoA row mappings.
   */
  acquire(): T {
    this._acquireCount++;

    let entity: T;
    let fromPool = false;

    if (this.available.length > 0) {
      entity = this.available.pop()!;
      fromPool = true;
    } else {
      this._missCount++;

      if (this.config.growthStrategy === 'grow') {
        this.growBatch();
      }

      if (this.available.length > 0) {
        entity = this.available.pop()!;
        fromPool = true;
      } else {
        entity = this.createEntity();
      }
    }

    if (fromPool) {
      entity._revive();
    }

    return entity;
  }

  /** Return an entity to the pool. */
  release(entity: T): void {
    this._releaseCount++;

    if (this.config.maxSize > 0 && this.available.length >= this.config.maxSize) {
      entity.dispose();
      return;
    }

    this.available.push(entity);
  }

  /** Pre-allocate entities up to `count`. */
  prewarm(count: number): void {
    const toCreate = count - this.available.length;
    for (let i = 0; i < toCreate; i++) {
      if (this.config.maxSize > 0 && this.available.length >= this.config.maxSize) {
        break;
      }
      this.available.push(this.createEntity());
    }
  }

  /** Remove all pooled entities without disposing them. */
  drain(): void {
    this.available.length = 0;
  }

  get availableCount(): number {
    return this.available.length;
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

  private createEntity(): T {
    const entity = this.entityFactory();
    this._totalCreated++;
    return entity;
  }

  private growBatch(): void {
    const batchSize = this.config.growthBatchSize;
    for (let i = 0; i < batchSize; i++) {
      if (this.config.maxSize > 0 && this.available.length >= this.config.maxSize) {
        break;
      }
      this.available.push(this.createEntity());
    }
  }
}
