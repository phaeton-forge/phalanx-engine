import type { IComponent } from '@phalanx-engine/ecs';
import { ComponentType } from './ComponentType.ts';

export class PickupComponent implements IComponent {
  public readonly type = ComponentType.Pickup;

  public healAmount: number;
  public lifetime: number;
  public pickupType: 'health';

  constructor(healAmount: number, lifetime: number) {
    this.healAmount = healAmount;
    this.lifetime = lifetime;
    this.pickupType = 'health';
  }
}
