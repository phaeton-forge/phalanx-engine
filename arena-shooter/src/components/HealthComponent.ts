import type { IComponent } from '@phalanx-engine/ecs';
import { ComponentType } from './ComponentType.ts';

export class HealthComponent implements IComponent {
  public readonly type = ComponentType.Health;

  public hp: number;
  public maxHp: number;
  public pendingDamage: number = 0;
  public pendingHeal: number = 0;

  constructor(hp: number, maxHp: number) {
    this.hp = hp;
    this.maxHp = maxHp;
  }
}
