import type { IComponent } from '../Component';
import type { Entity } from '../Entity';
import type { IPoolable } from './IPoolable';
import type { EntityPoolConfig, PoolStats, ComponentTemplate, ResolvedPoolConfig } from './types';
import { resolvePoolConfig } from './types';

/**
 * Entity-specific pool with component template support.
 *
 * Pooled entities keep stable IDs across release/acquire cycles. This makes
 * pooled entities reusable ECS slots and keeps SoA-backed component rows keyed
 * to the same entity ID for the lifetime of the entity instance.
 *
 * Game code owns gameplay-state cleanup by implementing Entity.reset() or by
 * resetting components before release. The pool only manages availability,
 * revive/dispose state, and optional template preservation on release.
 */
export class EntityPool<T extends Entity = Entity> {
  private readonly available: T[] = [];
  private readonly entityFactory: () => T;
  private readonly componentTemplates: ComponentTemplate[];
  private readonly config: ResolvedPoolConfig;

  private _totalCreated: number = 0;
  private _acquireCount: number = 0;
  private _releaseCount: number = 0;
  private _missCount: number = 0;

  constructor(entityFactory: () => T, config?: EntityPoolConfig) {
    this.entityFactory = entityFactory;
    this.componentTemplates = config?.componentTemplates ?? [];
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
      // Reused entity — keep stable ID and revive only.
      entity._revive();
    }
    // For fresh entities: constructor already assigned ID, _isDestroyed is false

    // Reset template components
    for (const template of this.componentTemplates) {
      const comp = entity.getComponent(template.type);
      if (comp) {
        if ('reset' in comp) {
          (comp as unknown as IPoolable).reset();
        }
      }
      // No need to recreate — templates are preserved via prepareForPool/createEntity
    }

    return entity;
  }

  /** Return an entity to the pool. Calls reset(). */
  release(entity: T): void {
    this._releaseCount++;

    if (this.config.maxSize > 0 && this.available.length >= this.config.maxSize) {
      entity.dispose(); // Clean up resources for entities that won't be pooled
      return;
    }

    this.prepareForPool(entity);
    this.available.push(entity);
  }

  /** Pre-allocate entities with template components. */
  prewarm(count: number): void {
    const toCreate = count - this.available.length;
    for (let i = 0; i < toCreate; i++) {
      if (this.config.maxSize > 0 && this.available.length >= this.config.maxSize) {
        break;
      }
      const entity = this.createEntity();
      this.prepareForPool(entity);
      this.available.push(entity);
    }
  }

  private growBatch(): void {
    const batchSize = this.config.growthBatchSize;
    for (let i = 0; i < batchSize; i++) {
      if (this.config.maxSize > 0 && this.available.length >= this.config.maxSize) {
        break;
      }
      const entity = this.createEntity();
      this.prepareForPool(entity);
      this.available.push(entity);
    }
  }

  /** Prepare an entity for storage in the pool — reset while preserving templates. */
  private prepareForPool(entity: T): void {
    const savedComps: IComponent[] = [];
    for (const template of this.componentTemplates) {
      const comp = entity.getComponent(template.type);
      if (comp) savedComps.push(comp);
    }

    entity.reset();

    for (const comp of savedComps) {
      if ('reset' in comp) {
        (comp as unknown as IPoolable).reset();
      }
      entity.addComponent(comp);
    }
  }

  /** Clear all pooled entities. */
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

    if (this.componentTemplates && this.componentTemplates.length > 0) {
      // Attach template components
      for (const template of this.componentTemplates) {
        entity.addComponent(template.factory());
      }
    }

    return entity;
  }
}
