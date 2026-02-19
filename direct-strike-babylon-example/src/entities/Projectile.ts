import {
  Scene,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Mesh,
} from '@babylonjs/core';
import type { IDamageable } from '../interfaces/IDamageable';
import { TeamTag } from '../enums/TeamTag';
import { FP, FPVector3, type FPVector3 as FPVector3Type, type FixedPoint } from 'phalanx-math';

export interface ProjectileConfig {
  damage: number;
  speed?: number;
  lifetime?: number;
  team: TeamTag;
  sourceId: number; // ID of the entity that fired the projectile
}

/**
 * Projectile entity - Represents a laser beam projectile
 * Follows Single Responsibility: Only handles projectile behavior
 *
 * DETERMINISTIC SIMULATION:
 * - Uses fpPosition and fpDirection for deterministic fixed-point calculations
 * - mesh.position is for visual rendering only
 */
export class Projectile {
  private scene: Scene;
  private mesh: Mesh;
  private _direction: Vector3;
  private _speed: number;
  private _damage: number;
  private _lifetime: number;
  private _currentLifetime: number;
  private _team: TeamTag;
  private _sourceId: number;
  private _isDestroyed: boolean = false;

  // Fixed-point fields for deterministic simulation
  private _fpPosition: FPVector3Type;
  private _fpDirection: FPVector3Type;
  private _fpSpeed: FixedPoint;
  private _fpCurrentLifetime: FixedPoint;

  constructor(
    scene: Scene,
    origin: Vector3,
    direction: Vector3,
    config: ProjectileConfig,
    _target: IDamageable | null = null // Reserved for future homing projectiles
  ) {
    this.scene = scene;
    this._direction = direction.normalize();
    this._speed = config.speed ?? 55;
    this._damage = config.damage;
    this._lifetime = config.lifetime ?? 3;
    this._currentLifetime = this._lifetime;
    this._team = config.team;
    this._sourceId = config.sourceId;

    // Initialize fixed-point fields for deterministic simulation
    this._fpPosition = FPVector3.FromFloat(origin.x, origin.y, origin.z);
    this._fpDirection = FPVector3.Normalize(
      FPVector3.FromFloat(direction.x, direction.y, direction.z)
    );
    this._fpSpeed = FP.FromFloat(this._speed);
    this._fpCurrentLifetime = FP.FromFloat(this._currentLifetime);

    this.mesh = this.createMesh();
    this.mesh.position = origin.clone();
    this.orientToDirection();
  }

  private createMesh(): Mesh {
    // Create a small cylinder to represent a laser beam
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
    // Color based on team
    if (this._team === TeamTag.Team1) {
      material.diffuseColor = new Color3(0, 0.8, 1); // Cyan for player
      material.emissiveColor = new Color3(0, 0.4, 0.5);
    } else {
      material.diffuseColor = new Color3(1, 0.2, 0); // Orange/red for enemy
      material.emissiveColor = new Color3(0.5, 0.1, 0);
    }
    mesh.material = material;

    return mesh;
  }

  private orientToDirection(): void {
    // Orient the cylinder along the direction vector
    // Cylinders are created along Y-axis, so we need to rotate to match direction
    const up = new Vector3(0, 1, 0);
    const axis = Vector3.Cross(up, this._direction);

    if (axis.length() > 0.001) {
      this.mesh.rotationQuaternion = null;
      this.mesh.rotation = Vector3.Zero();

      // Use lookAt for proper orientation
      const targetPos = this.mesh.position.add(this._direction);
      this.mesh.lookAt(targetPos);
      this.mesh.rotation.x += Math.PI / 2; // Adjust for cylinder orientation
    }
  }

  /**
   * Update projectile position and check for collisions
   * Uses fixed-point math for deterministic movement across all platforms.
   * @returns true if projectile should be destroyed
   */
  public update(deltaTime: number, targets: IDamageable[]): boolean {
    if (this._isDestroyed) return true;

    // Update lifetime using fixed-point for determinism
    const fpDeltaTime = FP.FromFloat(deltaTime);
    this._fpCurrentLifetime = FP.Sub(this._fpCurrentLifetime, fpDeltaTime);
    this._currentLifetime = FP.ToFloat(this._fpCurrentLifetime);

    if (FP.Lte(this._fpCurrentLifetime, FP._0)) {
      this._isDestroyed = true;
      return true;
    }

    // Move projectile using fixed-point for determinism
    // velocity = direction * speed * deltaTime
    const fpDistance = FP.Mul(this._fpSpeed, fpDeltaTime);
    const movement = FPVector3.Scale(this._fpDirection, fpDistance);
    this._fpPosition = FPVector3.Add(this._fpPosition, movement);

    // Sync visual position from deterministic fpPosition
    const floatPos = FPVector3.ToFloat(this._fpPosition);
    this.mesh.position.set(floatPos.x, floatPos.y, floatPos.z);

    // Check for collision with targets (legacy path - collision is now handled in ProjectileSystem)
    for (const target of targets) {
      if (target.isDestroyed()) continue;

      // Use fixed-point squared distance for deterministic collision
      const targetFpPos = FPVector3.FromFloat(
        target.position.x,
        target.position.y,
        target.position.z
      );
      const distSq = FPVector3.SqrDistance(this._fpPosition, targetFpPos);
      const hitRadiusSq = FP.FromFloat(1.5 * 1.5); // 1.5^2

      if (FP.Lt(distSq, hitRadiusSq)) {
        // Hit target
        target.takeDamage(this._damage);
        this._isDestroyed = true;
        return true;
      }
    }

    return false;
  }

  public get position(): Vector3 {
    return this.mesh.position;
  }

  /**
   * Get the fixed-point position (authoritative for deterministic simulation)
   */
  public get fpPosition(): FPVector3Type {
    return this._fpPosition;
  }

  public get team(): TeamTag {
    return this._team;
  }

  public get sourceId(): number {
    return this._sourceId;
  }

  public get damage(): number {
    return this._damage;
  }

  public get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  public getMesh(): Mesh {
    return this.mesh;
  }

  public destroy(): void {
    this._isDestroyed = true;
  }

  public dispose(): void {
    this.mesh.dispose();
  }
}
