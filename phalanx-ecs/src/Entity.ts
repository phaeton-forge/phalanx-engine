import { isStoreBound, type IComponent } from './Component.js';
import type { EntityManager } from './EntityManager.js';
import { invokeComponentHooks } from './lifecycle.js';

/**
 * Base Entity class - Container for components
 * Uses composition over inheritance
 *
 * This is a renderer-agnostic entity. It only has an ID and a bag of components.
 * Game-specific subclasses (e.g. Unit) can add mesh, position, and other
 * rendering-related properties.
 *
 * The id is assigned by the owning world (`createEntity`,
 * `createEntityWithId`, or a pool factory). Do not mint ids here.
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
   * @internal Set while this entity is registered. Transient reads during
   * a tick go through it. Cleared on remove.
   */
  public _manager: EntityManager | null = null;

  /**
   * @internal The world whose stores hold this entity's SoA rows. Set once
   * by `createEntity`, a pool factory or the first `addEntity`, and kept
   * while the entity sits in a pool.
   */
  public _owner: EntityManager | null = null;

  /**
   * @internal Set by the owning entity pool so {@link dispose} can drop
   * that pool's reference. Cleared before the callback runs.
   */
  public _onDispose?: () => void;

  /**
   * @param id Id assigned by the world. An integer `>= 1`.
   */
  constructor(id: number) {
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new Error(`Entity: id must be an integer >= 1, got ${String(id)}`);
    }
    this._id = id;
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
    if (this._owner !== null && isStoreBound(component)) {
      component._bind(this._owner);
    }
    invokeComponentHooks([component], 'onCreate');
    return component;
  }

  /**
   * Get a component by type with type assertion
   * Use: entity.getComponent<AttackComponent>(ComponentType.Attack)
   */
  public getComponent<T extends IComponent>(type: symbol): T | undefined {
    this._manager?.assertComponentReadable(type);
    return this._peekComponent<T>(type);
  }

  /**
   * @internal Component lookup that does not apply the transient tick guard.
   * Save and `world.add` use this so a tick can write a transient value.
   */
  public _peekComponent<T extends IComponent>(type: symbol): T | undefined {
    return this.components.get(type) as T | undefined;
  }

  /**
   * Check if entity has a component.
   * Reading a transient component during a tick throws.
   */
  public hasComponent(type: symbol): boolean {
    this._manager?.assertComponentReadable(type);
    return this._componentAttached(type);
  }

  /** @internal Presence check without the transient tick guard. */
  public _componentAttached(type: symbol): boolean {
    return this.components.has(type);
  }

  /**
   * Check if entity has all specified components.
   * Reading a transient component during a tick throws.
   */
  public hasComponents(...types: symbol[]): boolean {
    return types.every((type) => this.hasComponent(type));
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
