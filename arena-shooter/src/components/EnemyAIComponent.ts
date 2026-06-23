import type { IComponent } from '@phalanx-engine/ecs';
import { ComponentType } from './ComponentType.ts';
import { type FixedPoint, FP } from '@phalanx-engine/math';

export class EnemyAIComponent implements IComponent {
  public readonly type = ComponentType.EnemyAI;

  public targetEntityId: number;
  public speed: FixedPoint;

  constructor(targetEntityId: number, speed: FixedPoint = FP._0) {
    this.targetEntityId = targetEntityId;
    this.speed = speed;
  }
}
