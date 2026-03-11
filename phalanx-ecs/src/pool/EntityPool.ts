import { Entity, nextEntityId } from '../Entity';
import type { IResettableComponent } from './IResettableComponent';
import type { PoolConfig, PoolStats, ResolvedPoolConfig } from './types';
import { resolvePoolConfig } from './types';

/**
 * Template for pre-creating components alongside pooled entities.
 */
export interface ComponentTemplate {
  /** Component type symbol. */
  type: symbol;
  /** Factory that creates a fresh instance (called once per prewarm slot). */
  factory: () => IResettableComponent;
}

/**
 * Configuration for EntityPool.
 */
export interface EntityPoolConfig extends PoolConfig {
  /**
   * Component templates — components created together with the entity during prewarm.
   * On acquire these components are already attached; use reinitialize() instead of new.
   */
  componentTemplates?: ComponentTemplate[];
}

/**
 * Specialized pool for Entity objects (and optionally their template components).
 *
 * Key guarantees for determinism:
 * - Every acquire() assigns a fresh, monotonically-increasing entity ID.
 * - LIFO stack order is deterministic and GC-independent.
 * - Full reset() is called on release — no residual state.
 */
export class EntityPool<T extends Entity = Entity> {
  private readonly available: T[] = [];
  private readonly factory: () => T;
  private readonly config: ResolvedPoolConfig;
  private readonly componentTemplates: ComponentTemplate[];

  private _totalCreated: number = 0;
  private _acquireCount: number = 0;
  private _releaseCount: number = 0;
  private _missCount: number = 0;

  constructor(entityFactory: () => T, config?: EntityPoolConfig) {
    this.factory = entityFactory;
    this.config = resolvePoolConfig(config);
    this.componentTemplates = config?.componentTemplates ?? [];

    if (this.config.initialSize > 0) {
      this.prewarm(this.config.initialSize);
    }
  }

  /**
   * Acquire an entity from the pool.
   * Assigns a new unique ID, revives it, and attaches template components (reset).
   */
  acquire(): T {
    this._acquireCount++;

    let entity: T;

    if (this.available.length === 0) {
      this._missCount++;

      if (this.config.growthStrategy === 'grow') {
        this.growBatch();
      }

      if (this.available.length === 0) {
        entity = this.createEntity();
      } else {
        entity = this.available.pop()!;
      }
    } else {
      entity = this.available.pop()!;
    }

    // Assign fresh ID and revive
    entity._setId(nextEntityId());
    entity._revive();

    // Reset template components (they stay attached from prewarm or previous release)
    for (const template of this.componentTemplates) {
      let comp = entity.getComponent<IResettableComponent>(template.type);
      if (!comp) {
        // First use or component was removed — add from template
        comp = template.factory();
        entity.addComponent(comp);
        this._totalCreated++; // count component creation too
      }
      comp.reset();
    }

    return entity;
  }

  /**
   * Return an entity to the pool for reuse.
   * Calls reset() on the entity (clears components, resets destroyed flag).
   * Then re-attaches template components so they're ready for next acquire.
   */
  release(entity: T): void {
    this._releaseCount++;

    if (this.config.maxSize > 0 && this.available.length >= this.config.maxSize) {
      return; // Pool is full — discard
    }

    // Collect template component instances before reset clears the map
    const templateComponents: IResettableComponent[] = [];
    for (const template of this.componentTemplates) {
      const comp = entity.getComponent<IResettableComponent>(template.type);
      if (comp) {
        templateComponents.push(comp);
      }
    }

    // Reset entity (clears component map, resets flags)
    entity.reset();

    // Re-attach template components so they survive in the pool
    for (const comp of templateComponents) {
      comp.reset();
      entity.addComponent(comp);
    }

    this.available.push(entity);
  }

  /**
   * Pre-allocate N entities with template components.
   */
  prewarm(count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.config.maxSize > 0 && this.available.length >= this.config.maxSize) {
        break;
      }
      const entity = this.createEntity();
      entity.reset();
      this.available.push(entity);
    }
  }

  /**
   * Clear the pool, discarding all available entities.
   */
  drain(): void {
    this.available.length = 0;
  }

  /** Number of entities currently available. */
  get availableCount(): number {
    return this.available.length;
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
   * Create a new entity with template components attached.
   */
  private createEntity(): T {
    const entity = this.factory();
    this._totalCreated++;

    // Attach template components
    for (const template of this.componentTemplates) {
      const comp = template.factory();
      entity.addComponent(comp);
    }

    return entity;
  }

  /**
   * Batch-create entities according to growthBatchSize.
   */
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
}
