import type { IComponent } from './Component';

let entityIdCounter = 0;

/**
 * Reset the entity ID counter - used when starting a new game
 * to ensure deterministic IDs across all clients
 */
export function resetEntityIdCounter(): void {
  entityIdCounter = 0;
}

/**
 * Base Entity class - Container for components
 * Uses composition over inheritance
 *
 * This is a renderer-agnostic entity. It only has an ID and a bag of components.
 * Game-specific subclasses (e.g. Unit) can add mesh, position, and other
 * rendering-related properties.
 */
export class Entity {
  public readonly id: number;
  protected components: Map<symbol, IComponent> = new Map();
  private _isDestroyed: boolean = false;

  constructor() {
    this.id = ++entityIdCounter;
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
}
