import {
  Scene,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Mesh,
} from '@babylonjs/core';
import { Entity } from 'phalanx-ecs';
import { TeamTag } from '../enums/TeamTag';
import type { IMeshEntity } from '../interfaces/IMeshEntity';

/**
 * ProjectileEntity - ECS entity with laser beam mesh
 *
 * Supports object pooling: no-arg constructor for pool factory,
 * lazy mesh creation via initVisual(), reset() hides mesh but keeps it alive.
 */
export class ProjectileEntity extends Entity implements IMeshEntity {
  private scene: Scene | null = null;
  private mesh: Mesh | null = null;

  constructor() {
    super();
  }

  /**
   * Initialize or reposition the visual mesh.
   * Creates mesh lazily on first call; repositions on subsequent calls.
   */
  public initVisual(scene: Scene, origin: Vector3, direction: Vector3, team: TeamTag): void {
    this.scene = scene;

    if (!this.mesh) {
      this.mesh = this.createMesh(team);
    }

    this.mesh.position.copyFrom(origin);
    this.orientToDirection(direction);
    this.mesh.setEnabled(true);
  }

  private createMesh(team: TeamTag): Mesh {
    const scene = this.scene!;
    const mesh = MeshBuilder.CreateCylinder(
      'projectile',
      {
        height: 1.5,
        diameter: 0.15,
        tessellation: 8,
      },
      scene
    );

    const material = new StandardMaterial('projectileMat', scene);
    if (team === TeamTag.Team1) {
      material.diffuseColor = new Color3(0, 0.8, 1);
      material.emissiveColor = new Color3(0, 0.4, 0.5);
    } else {
      material.diffuseColor = new Color3(1, 0.2, 0);
      material.emissiveColor = new Color3(0.5, 0.1, 0);
    }
    mesh.material = material;

    return mesh;
  }

  private orientToDirection(direction: Vector3): void {
    const normalized = direction.normalize();
    const up = new Vector3(0, 1, 0);
    const axis = Vector3.Cross(up, normalized);

    if (axis.length() > 0.001) {
      this.mesh!.rotationQuaternion = null;
      this.mesh!.rotation = Vector3.Zero();

      const targetPos = this.mesh!.position.add(normalized);
      this.mesh!.lookAt(targetPos);
      this.mesh!.rotation.x += Math.PI / 2;
    }
  }

  public setVisualPosition(position: Vector3): void {
    if (this.mesh) {
      this.mesh.position.copyFrom(position);
    }
  }

  public getMesh(): Mesh | null {
    return this.mesh;
  }

  /**
   * Pool reset: hide mesh but don't dispose it.
   */
  public override reset(): void {
    super.reset();
    if (this.mesh) {
      this.mesh.setEnabled(false);
    }
  }

  /**
   * Full disposal: dispose mesh and GPU resources.
   */
  public override dispose(): void {
    if (this.mesh) {
      this.mesh.dispose();
      this.mesh = null;
    }
    super.dispose();
  }
}
