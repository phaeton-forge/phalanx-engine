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
 * Extends Entity directly (not Unit) for lighter weight.
 * Implements IMeshEntity so InterpolationSystem can update its visual position.
 *
 * All simulation state lives in components (ProjectileComponent, TransformComponent, etc.).
 * This class only handles the visual mesh representation.
 */
export class ProjectileEntity extends Entity implements IMeshEntity {
  private scene: Scene;
  private mesh: Mesh;

  constructor(scene: Scene, origin: Vector3, direction: Vector3, team: TeamTag) {
    super();
    this.scene = scene;
    this.mesh = this.createMesh(team);
    this.mesh.position.copyFrom(origin);
    this.orientToDirection(direction);
  }

  private createMesh(team: TeamTag): Mesh {
    const mesh = MeshBuilder.CreateCylinder(
      'projectile',
      {
        height: 1.5,
        diameter: 0.15,
        tessellation: 8,
      },
      this.scene
    );

    const material = new StandardMaterial('projectileMat', this.scene);
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
      this.mesh.rotationQuaternion = null;
      this.mesh.rotation = Vector3.Zero();

      const targetPos = this.mesh.position.add(normalized);
      this.mesh.lookAt(targetPos);
      this.mesh.rotation.x += Math.PI / 2;
    }
  }

  public setVisualPosition(position: Vector3): void {
    this.mesh.position.copyFrom(position);
  }

  public getMesh(): Mesh | null {
    return this.mesh;
  }

  public override dispose(): void {
    this.mesh.dispose();
    super.dispose();
  }
}
