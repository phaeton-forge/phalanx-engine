import type { IComponent } from './Component.ts';
import { ComponentType } from './Component.ts';
import { FP, type FPVector2 as FPVector2Type } from 'phalanx-math';
import { PROJECTILE_LIFETIME_SECONDS } from '../config/constants';

export const PROJECTILE_DEFAULT_LIFETIME = FP.FromFloat(PROJECTILE_LIFETIME_SECONDS);

export class ProjectileComponent implements IComponent {
  public readonly type = ComponentType.Projectile;
  public fpDirection2: FPVector2Type = { x: FP._0, y: FP._0 };
  public lifeTime = PROJECTILE_DEFAULT_LIFETIME;
}
