import type { IComponent } from '../Component';
import type { Entity } from '../Entity';
import { nextEntityId } from '../Entity';
import type { IPoolable } from './IPoolable';
import type { EntityPoolConfig, PoolStats, ComponentTemplate, ResolvedPoolConfig } from './types';
import { resolvePoolConfig } from './types';

/**
 * Entity-specific pool with component template support.
 * Manages entity lifecycle: ID assignment, revive, and component templates.
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
   * Assigns a new ID, revives, and returns a ready-to-use entity.
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
      // Reused entity — assign fresh ID and revive
      entity._setId(nextEntityId());
      entity._revive();
    }
    // For fresh entities: constructor already assigned ID, _isDestroyed is false

    // Reset template components
    for (const template of this.componentTemplates) {
      const comp = entity.getComponent(template.type);
      if (comp) {
        if ('reset' in comp && typeof (comp as IPoolable).reset === 'function') {
          (comp as IPoolable).reset();
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
      if ('reset' in comp && typeof (comp as IPoolable).reset === 'function') {
        (comp as IPoolable).reset();
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

    // Attach template components
    for (const template of this.componentTemplates) {
      entity.addComponent(template.factory());
    }

    return entity;
  }
}
