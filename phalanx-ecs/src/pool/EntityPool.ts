import type { Entity } from '../Entity';
import { nextEntityId } from '../Entity';
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

    if (this.available.length > 0) {
      entity = this.available.pop()!;
    } else {
      this._missCount++;

      if (this.config.growthStrategy === 'grow') {
        this.growBatch();
      }

      if (this.available.length > 0) {
        entity = this.available.pop()!;
      } else {
        entity = this.createEntity();
      }
    }

    // Assign new ID and revive
    entity._setId(nextEntityId());
    entity._revive();

    // For pool hits: template components survived from release, reset them.
    // For misses: template components were just created in createEntity(), also reset them.
    for (const template of this.componentTemplates) {
      let comp = entity.getComponent(template.type);
      if (!comp) {
        // Component was removed somehow - recreate from template
        comp = template.factory();
        entity.addComponent(comp);
        this._totalCreated++;
      }
      if ('reset' in comp && typeof comp.reset === 'function') {
        (comp as any).reset();
      }
    }

    return entity;
  }

  /** Return an entity to the pool. Calls reset(). */
  release(entity: T): void {
    this._releaseCount++;

    if (this.config.maxSize > 0 && this.available.length >= this.config.maxSize) {
      return; // Pool is full — discard
    }

    // Save template components before reset clears the map
    const saved: any[] = [];
    for (const template of this.componentTemplates) {
      const comp = entity.getComponent(template.type);
      if (comp) saved.push(comp);
    }

    entity.reset(); // clears component map

    // Re-attach template components (reset them too)
    for (const comp of saved) {
      if ('reset' in comp && typeof comp.reset === 'function') {
        comp.reset();
      }
      entity.addComponent(comp);
    }

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
      entity.reset();
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
      entity.reset();
      this.available.push(entity);
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
