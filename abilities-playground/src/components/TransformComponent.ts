import type { FixedPoint } from 'phalanx-math';
import type { IComponent } from 'phalanx-ecs';
import { ComponentType } from './Component';

export class TransformComponent implements IComponent {
  public readonly type = ComponentType.Transform;

  public constructor(
    public x: FixedPoint,
    public z: FixedPoint
  ) {}
}
