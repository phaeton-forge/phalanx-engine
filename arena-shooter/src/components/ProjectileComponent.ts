import type { IComponent } from '@phalanx-engine/ecs';
import { ComponentType } from './ComponentType.ts';
import { type FixedPoint, FP } from '@phalanx-engine/math';

export class ProjectileComponent implements IComponent {
  public readonly type = ComponentType.Projectile;

  public lifetime: number;
  public ownerId: number;
  public dirX: FixedPoint;
  public dirZ: FixedPoint;
  public speed: FixedPoint;

  constructor(
    lifetime: number = 0,
    ownerId: number = -1,
    dirX: FixedPoint = FP._0,
    dirZ: FixedPoint = FP._0,
    speed: FixedPoint = FP._0,
  ) {
    this.lifetime = lifetime;
    this.ownerId = ownerId;
    this.dirX = dirX;
    this.dirZ = dirZ;
    this.speed = speed;
  }
}
