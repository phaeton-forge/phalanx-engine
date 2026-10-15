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
  /**
   * Entities this pool created and still references: checked-out entities and
   * the free list. Insertion order is creation order. `drain()` drops the
   * free-list entries so those objects can be collected, matching the
   * previous behavior of clearing `available` without retaining them.
   */
  private readonly owned = new Set<T>();
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
   * `destroy()` is reversible and the next acquire revives that instance.
   * `dispose()` drops the pool's reference via the entity callback, so a
   * disposed object is not sitting on this free list.
   */
  acquire(): T {
    this._acquireCount++;

    if (this.available.length > 0) {
      const entity = this.available.pop()!;
      entity._revive();
      return entity;
    }

    this._missCount++;

    if (this.config.growthStrategy === 'grow') {
      this.growBatch();
    }

    if (this.available.length > 0) {
      const entity = this.available.pop()!;
      entity._revive();
      return entity;
    }

    return this.createEntity();
  }

  /** Return an entity to the pool. */
  release(entity: T): void {
    this._releaseCount++;

    if (
      this.config.maxSize > 0 &&
      this.available.length >= this.config.maxSize
    ) {
      this.owned.delete(entity);
      entity.dispose();
      return;
    }

    this.available.push(entity);
  }

  /** Pre-allocate entities up to `count`. */
  prewarm(count: number): void {
    const toCreate = count - this.available.length;
    for (let i = 0; i < toCreate; i++) {
      if (
        this.config.maxSize > 0 &&
        this.available.length >= this.config.maxSize
      ) {
        break;
      }
      this.available.push(this.createEntity());
    }
  }

  /** Remove all pooled entities without disposing them. */
  drain(): void {
    for (const entity of this.available) {
      this.owned.delete(entity);
    }
    this.available.length = 0;
  }

  /**
   * Ids of entities this pool still owns, in creation order.
   * Includes checked-out entities and the free list, including entities
   * marked with `destroy()` (that mark is cleared on the next acquire).
   * Excludes entities dropped by {@link drain}, disposed because
   * `maxSize` was exceeded, or disposed outside {@link release}.
   */
  public ownedIds(): readonly number[] {
    const ids: number[] = [];
    for (const entity of this.owned) {
      ids.push(entity.id);
    }
    return ids;
  }

  /**
   * Free-list ids from oldest release to newest.
   * {@link acquire} pops the last id. A `destroy()` mark does not remove
   * the id; {@link Entity.dispose} does, via the pool callback.
   */
  public freeListIds(): readonly number[] {
    const ids: number[] = [];
    for (const entity of this.available) {
      ids.push(entity.id);
    }
    return ids;
  }

  /**
   * Replace the owned set and the free list.
   *
   * `entitiesInCreationOrder` is every entity this pool should reference,
   * in creation order. `freeListIds` is the free subset, oldest release
   * first; the next {@link acquire} pops the last id. Ids absent from the
   * free list stay checked out. Does not construct entities or change ids.
   *
   * `destroy()` is allowed: acquire clears that mark. `dispose()` already
   * removed the entity from its previous pool.
   *
   * @throws If an id is duplicated, or a free-list id is not in
   * `entitiesInCreationOrder`.
   */
  public adopt(
    entitiesInCreationOrder: readonly T[],
    freeListIds: readonly number[]
  ): void {
    const byId = new Map<number, T>();
    for (const entity of entitiesInCreationOrder) {
      if (byId.has(entity.id)) {
        throw new Error(`EntityPool.adopt: duplicate entity id ${entity.id}`);
      }
      byId.set(entity.id, entity);
    }

    const free: T[] = [];
    const freeIds = new Set<number>();
    for (const id of freeListIds) {
      if (freeIds.has(id)) {
        throw new Error(`EntityPool.adopt: duplicate free-list id ${id}`);
      }
      const entity = byId.get(id);
      if (!entity) {
        throw new Error(
          `EntityPool.adopt: free-list id ${id} is not in the owned entities`
        );
      }
      freeIds.add(id);
      free.push(entity);
    }

    this.owned.clear();
    this.available.length = 0;
    for (const entity of entitiesInCreationOrder) {
      this.attach(entity);
      entity._inPool = freeIds.has(entity.id);
      this.owned.add(entity);
    }
    for (const entity of free) {
      this.available.push(entity);
    }
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
    this.attach(entity);
    this._totalCreated++;
    this.owned.add(entity);
    return entity;
  }

  private attach(entity: T): void {
    entity._onDispose = () => {
      this.forget(entity);
    };
  }

  private forget(entity: T): void {
    this.owned.delete(entity);
    const index = this.available.indexOf(entity);
    if (index !== -1) {
      this.available.splice(index, 1);
    }
  }

  private growBatch(): void {
    const batchSize = this.config.growthBatchSize;
    for (let i = 0; i < batchSize; i++) {
      if (
        this.config.maxSize > 0 &&
        this.available.length >= this.config.maxSize
      ) {
        break;
      }
      this.available.push(this.createEntity());
    }
  }
}
