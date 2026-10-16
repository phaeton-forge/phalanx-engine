import type { IComponent } from './Component.js';
import { invokeComponentHooks } from './lifecycle.js';

let entityIdCounter = 0;

/**
 * Reset the entity ID counter - used when starting a new game
 * to ensure deterministic IDs across all clients
 */
export function resetEntityIdCounter(): void {
  entityIdCounter = 0;
}

/**
 * Current high-water mark of the module-global entity id counter.
 *
 * `0` means no id has been allocated. The next {@link Entity} or
 * {@link nextEntityId} call returns `current + 1`.
 */
export function getEntityIdCounter(): number {
  return entityIdCounter;
}

/**
 * Restore the module-global entity id counter.
 *
 * The value is the last allocated id (the high-water mark), not the next
 * id. The following allocation returns `value + 1`. Any integer `>= 0`
 * is accepted, including a value below the current mark, so a snapshot
 * can restore an earlier counter.
 *
 * The caller must pass a value greater than or equal to every live entity
 * id. A lower integer is stored, and the next allocation can then collide
 * with an id that is still in use. That bound is the caller's responsibility.
 *
 * @throws If `value` is not a safe integer `>= 0`.
 */
export function setEntityIdCounter(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `setEntityIdCounter: value must be an integer >= 0, got ${String(value)}`
    );
  }
  entityIdCounter = value;
}

/**
 * Allocate and return the next sequential entity ID from the global counter.
 * Primarily used by Entity construction and specialized callers that need a
 * deterministic ID allocation without constructing an Entity directly.
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
export class Entity {
  private _id: number;
  protected components: Map<symbol, IComponent> = new Map();
  private _isDestroyed: boolean = false;

  /** @internal Set by PoolManager on registration; identifies the entity's pool. */
  public _poolTypeKey?: string;

  /** @internal True while the entity sits despawned inside a pool. Managed by PoolManager. */
  public _inPool: boolean = false;

  /**
   * @internal Set by the owning entity pool so {@link dispose} can drop
   * that pool's reference. Cleared before the callback runs.
   */
  public _onDispose?: () => void;

  constructor() {
    this._id = ++entityIdCounter;
  }

  /**
   * Unique entity ID.
   */
  public get id(): number {
    return this._id;
  }

  /**
   * @internal Reassigns the entity ID. Avoid for pooled entities because SoA
   * components and stores are keyed by stable entity IDs.
   */
  public _setId(id: number): void {
    this._id = id;
  }

  /**
   * @internal Used by EntityPool to clear destroyed flag on acquire.
   */
  public _revive(): void {
    this._isDestroyed = false;
  }

  /**
   * Add a component to this entity
   */
  public addComponent<T extends IComponent>(component: T): T {
    this.components.set(component.type, component);
    invokeComponentHooks([component], 'onCreate');
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
   * Get all component type symbols attached to this entity.
   * Useful for debugging and introspection.
   */
  public getComponentTypes(): symbol[] {
    return Array.from(this.components.keys());
  }

  /**
   * Get a read-only view of all components attached to this entity.
   * Useful for debugging and introspection.
   */
  public getComponents(): ReadonlyMap<symbol, IComponent> {
    return this.components;
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
    const components = [...this.components.values()];
    invokeComponentHooks(components, 'onDestroy');
    this._isDestroyed = true;
    this.components.clear();
    const notify = this._onDispose;
    this._onDispose = undefined;
    notify?.();
  }
}
