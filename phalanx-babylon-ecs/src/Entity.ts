import { Scene, Vector3, Mesh } from '@babylonjs/core';
import type { IComponent } from './Component';
import { FPVector3, type FPVector3 as FPVector3Type } from 'phalanx-math';

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
 * INTERPOLATION ARCHITECTURE:
 * - fpPosition: The authoritative fixed-point position (deterministic across all platforms)
 * - simulationPosition: Cached Vector3 derived from fpPosition for Babylon.js compatibility
 * - mesh.position: The visual position used for rendering (can be interpolated)
 * - By default, they are synchronized. An interpolation system can separate them for smooth visuals.
 *
 * Game developers should extend this class to create their own entity types.
 */
export abstract class Entity {
  public readonly id: number;
  protected scene: Scene;
  protected mesh: Mesh | null = null;
  protected components: Map<symbol, IComponent> = new Map();
  private _isDestroyed: boolean = false;

  // Fixed-point simulation position (authoritative, deterministic across all platforms)
  private _fpPosition: FPVector3Type = FPVector3.Zero;

  // Cached Vector3 simulation position (derived from _fpPosition for Babylon.js compatibility)
  private _simulationPosition: Vector3 = new Vector3();

  // Physics ignore flag - when true, physics system will skip this entity
  // Used for dying units, phasing units, etc.
  private _ignorePhysics: boolean = false;

  constructor(scene: Scene) {
    this.id = ++entityIdCounter;
    this.scene = scene;
  }

  /**
   * Check if physics system should ignore this entity
   */
  public get ignorePhysics(): boolean {
    return this._ignorePhysics;
  }

  /**
   * Set whether physics system should ignore this entity
   */
  public set ignorePhysics(value: boolean) {
    this._ignorePhysics = value;
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
   * Get the entity's fixed-point simulation position (authoritative, deterministic)
   * This is the true authoritative position used for all deterministic calculations.
   */
  public get fpPosition(): FPVector3Type {
    return this._fpPosition;
  }

  /**
   * Set the entity's fixed-point simulation position (authoritative, deterministic)
   * This updates both the FPVector3 and the cached Vector3 simulation position.
   * By default, also updates the visual (mesh) position.
   */
  public set fpPosition(value: FPVector3Type) {
    this._fpPosition = value;
    // Update cached Vector3 for Babylon.js compatibility
    const nums = FPVector3.ToFloat(value);
    this._simulationPosition.set(nums.x, nums.y, nums.z);
    // Also update mesh position (visual) by default
    if (this.mesh) {
      this.mesh.position.copyFrom(this._simulationPosition);
    }
  }

  /**
   * Get the entity's simulation position as Vector3 (for Babylon.js compatibility)
   * This is derived from the authoritative fpPosition.
   * @deprecated Use fpPosition for deterministic calculations. This getter is for
   * backward compatibility and rendering.
   */
  public get position(): Vector3 {
    return this._simulationPosition;
  }

  /**
   * Set the entity's simulation position from a Vector3
   * Converts to FPVector3 internally for deterministic storage.
   * By default, also updates the visual (mesh) position.
   * @deprecated Use fpPosition for deterministic calculations. This setter is for
   * backward compatibility.
   */
  public set position(value: Vector3) {
    this._fpPosition = FPVector3.FromFloat(value.x, value.y, value.z);
    this._simulationPosition.copyFrom(value);
    // Also update mesh position (visual) by default
    if (this.mesh) {
      this.mesh.position.copyFrom(value);
    }
  }

  /**
   * Set only the visual position (mesh) without affecting simulation position
   * Used by InterpolationSystem for smooth rendering between ticks
   */
  public setVisualPosition(value: Vector3): void {
    if (this.mesh) {
      this.mesh.position.copyFrom(value);
    }
  }

  /**
   * Get the visual position (mesh position)
   */
  public getVisualPosition(): Vector3 {
    return this.mesh?.position ?? this._simulationPosition.clone();
  }

  /**
   * Sync simulation position from mesh (call after mesh is created)
   * Used during entity initialization. Updates both Vector3 and FPVector3.
   */
  public syncSimulationPosition(): void {
    if (this.mesh) {
      this._simulationPosition.copyFrom(this.mesh.position);
      this._fpPosition = FPVector3.FromFloat(
        this.mesh.position.x,
        this.mesh.position.y,
        this.mesh.position.z
      );
    }
  }

  /**
   * Get the main mesh of this entity
   */
  public getMesh(): Mesh | null {
    return this.mesh;
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
    if (this.mesh) {
      this.mesh.dispose();
      this.mesh = null;
    }
  }
}
