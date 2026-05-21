import type { IComponent } from 'phalanx-ecs';
import { ComponentType } from './Component';

export class CombatComponent implements IComponent {
  public readonly type = ComponentType.Combat;

  public constructor(
    public targetId: number | null = null,
    public nextAttackTick = 0
  ) {}
}
