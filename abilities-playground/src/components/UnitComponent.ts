import type { FixedPoint } from 'phalanx-math';
import type { IComponent } from 'phalanx-ecs';
import { ComponentType } from './Component';

export type UnitType = 'sphere' | 'cube' | 'cone';
export type TeamId = 1 | 2;

export class UnitComponent implements IComponent {
  public readonly type = ComponentType.Unit;

  public constructor(
    public unitType: UnitType,
    public teamId: TeamId,
    public maxHp: FixedPoint,
    public moveSpeed: FixedPoint,
    public attackRange: FixedPoint,
    public attackDamage: FixedPoint,
    public attackCooldownTicks: number,
    public auraEntityId: number | null = null
  ) {}
}
