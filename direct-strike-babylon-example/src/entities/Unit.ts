import { Scene, Vector3, Mesh } from '@babylonjs/core';
import { Entity } from 'phalanx-ecs';
import { FPVector3, type FPVector3 as FPVector3Type } from 'phalanx-math';

/**
 * Unit - Game-specific entity base class with Babylon.js rendering support
 *
 * Extends the renderer-agnostic Entity from phalanx-ecs and adds:
 * - Babylon.js Scene reference
 * - Mesh reference for visual representation
 * - Fixed-point position (fpPosition) for deterministic simulation
 * - Cached Vector3 simulation position for Babylon.js compatibility
 * - Visual position control for interpolation
 * - Physics ignore flag
 *
 * All entity classes in Direct Strike (MutantUnit, PrismaUnit, LanceUnit,
 * Tower, Base) should extend this class.
 */
export class Unit extends Entity {
  protected scene: Scene;
  protected mesh: Mesh | null = null;

  // Fixed-point simulation position (authoritative, deterministic across all platforms)
  private _fpPosition: FPVector3Type = FPVector3.Zero;

  // Cached Vector3 simulation position (derived from _fpPosition for Babylon.js compatibility)
  private _simulationPosition: Vector3 = new Vector3();

  // Physics ignore flag - when true, physics system will skip this entity
  // Used for dying units, phasing units, etc.
  private _ignorePhysics: boolean = false;

  constructor(scene: Scene) {
    super();
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
   */
  public get position(): Vector3 {
    return this._simulationPosition;
  }

  /**
   * Set the entity's simulation position from a Vector3
   * Converts to FPVector3 internally for deterministic storage.
   * By default, also updates the visual (mesh) position.
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
   * Cleanup resources - called by EntityManager
   */
  public override dispose(): void {
    if (this.mesh) {
      this.mesh.dispose();
      this.mesh = null;
    }
    super.dispose();
  }
}

