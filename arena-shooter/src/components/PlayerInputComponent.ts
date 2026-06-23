import type { IComponent } from '@phalanx-engine/ecs';
import { ComponentType } from './ComponentType.ts';
import { FP, type FixedPoint } from '@phalanx-engine/math';

export class PlayerInputComponent implements IComponent {
  public readonly type = ComponentType.PlayerInput;

  public moveX: FixedPoint = FP._0;
  public moveZ: FixedPoint = FP._0;
  public aimX: FixedPoint = FP._0;
  public aimZ: FixedPoint = FP._0;
  public isFiring: boolean = false;
  public isReloading: boolean = false;
}
