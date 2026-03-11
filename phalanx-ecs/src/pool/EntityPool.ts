import type { Entity } from '../Entity';
import { nextEntityId } from '../Entity';
import type { EntityPoolConfig, PoolStats, ComponentTemplate } from './types';

/**
 * Entity-specific pool with component template support.
 * Manages entity lifecycle: ID assignment, revive, and component templates.
 */
export class EntityPool<T extends Entity = Entity> {
  private readonly available: T[] = [];
  private readonly entityFactory: () => T;
  private readonly componentTemplates: ComponentTemplate[];
  private readonly maxSize: number;

  private _totalCreated: number = 0;
  private _acquireCount: number = 0;
  private _releaseCount: number = 0;
  private _missCount: number = 0;

  constructor(entityFactory: () => T, config?: EntityPoolConfig) {
    this.entityFactory = entityFactory;
    this.componentTemplates = config?.componentTemplates ?? [];
    this.maxSize = config?.maxSize ?? 0;
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
      entity = this.createEntity();
    }

    // Assign new ID and revive
    entity._setId(nextEntityId());
    entity._revive();

    return entity;
  }

  /** Return an entity to the pool. Calls reset(). */
  release(entity: T): void {
    this._releaseCount++;
    entity.reset();

    if (this.maxSize === 0 || this.available.length < this.maxSize) {
      this.available.push(entity);
    }
  }

  /** Pre-allocate entities with template components. */
  prewarm(count: number): void {
    const toCreate = count - this.available.length;
    for (let i = 0; i < toCreate; i++) {
      const entity = this.createEntity();
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
