import { Scene, Vector3, Mesh } from '@babylonjs/core';
import { Entity } from '@phalanx-engine/ecs';
import type { IMeshEntity } from '../interfaces/IMeshEntity';

/**
 * Unit - Game-specific entity base class with Babylon.js rendering support
 *
 * Extends the renderer-agnostic Entity from phalanx-ecs and adds:
 * - Babylon.js Scene reference
 * - Mesh reference for visual representation
 *
 * Position data is stored in TransformComponent (SoA-backed).
 * Physics properties are stored in PhysicsBodyComponent.
 *
 * All entity classes in Direct Strike (MutantUnit, PrismaUnit, LanceUnit,
 * Tower, Base) should extend this class.
 */
export class Unit extends Entity implements IMeshEntity {
  protected scene: Scene;
  protected mesh: Mesh | null = null;

  constructor(scene: Scene) {
    super();
    this.scene = scene;
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
  public getVisualPosition(): Vector3 | null {
    return this.mesh?.position ?? null;
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

