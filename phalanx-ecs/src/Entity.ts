import type { IComponent } from './Component';
import type { IPoolable } from './pool/IPoolable';

let entityIdCounter = 0;

/**
 * Reset the entity ID counter - used when starting a new game
 * to ensure deterministic IDs across all clients
 */
export function resetEntityIdCounter(): void {
  entityIdCounter = 0;
}

/**
 * Allocate the next entity ID from the global counter.
 * Exported for use by EntityPool.
 */
export function nextEntityId(): number {
  return ++entityIdCounter;
}

/**
 * Base Entity class - Container for components
 * Uses composition over inheritance
 *
 * This is a renderer-agnostic entity. It only has an ID and a bag of components.
 * Game-specific subclasses (e.g. Unit) can add mesh, position, and other
 * rendering-related properties.
 */
export class Entity implements IPoolable {
  private _id: number;
  protected components: Map<symbol, IComponent> = new Map();
  private _isDestroyed: boolean = false;

  constructor() {
    this._id = ++entityIdCounter;
  }

  /** Entity ID (unique per lifecycle, reassigned on pool acquire) */
  public get id(): number {
    return this._id;
  }

  /** @internal Assign a new ID — used by the pool on acquire. */
  public _setId(id: number): void {
    this._id = id;
  }

  /** @internal Clear the destroyed flag so a pooled entity can be reused. */
  public _revive(): void {
    this._isDestroyed = false;
  }

  /**
   * IPoolable: reset the entity to a clean state.
   * Map.clear() reuses internal storage — no new allocations.
   */
  public reset(): void {
    this._isDestroyed = false;
    this.components.clear();
  }

  /**
   * Add a component to this entity
   */
  public addComponent<T extends IComponent>(component: T): T {
    this.components.set(component.type, component);
    return component;
  }

  /**
   * Get a component by type with type assertion
   * Use: entity.getComponent<AttackComponent>(ComponentType.Attack)
   */
  public getComponent<T extends IComponent>(type: symbol): T | undefined {
    return this.components.get(type) as T | undefined;
  }

  /**
   * Check if entity has a component
   */
  public hasComponent(type: symbol): boolean {
    return this.components.has(type);
  }

  /**
   * Check if entity has all specified components
   */
  public hasComponents(...types: symbol[]): boolean {
    return types.every((type) => this.components.has(type));
  }

  /**
   * Remove a component from this entity
   */
  public removeComponent(type: symbol): boolean {
    return this.components.delete(type);
  }

  /**
   * Check if entity is destroyed
   */
  public get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  /**
   * Mark entity as destroyed (actual cleanup done by EntityManager)
   */
  public destroy(): void {
    this._isDestroyed = true;
  }

  /**
   * Cleanup resources - called by EntityManager
   */
  public dispose(): void {
    this._isDestroyed = true;
    this.components.clear();
  }

  /**
   * Get all component type symbols currently attached to this entity.
   * Used by EntityPool to track which component indices need updating.
   */
  public getComponentTypes(): symbol[] {
    return [...this.components.keys()];
  }
}
