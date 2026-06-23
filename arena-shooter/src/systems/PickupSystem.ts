import { GameSystem } from '@phalanx-engine/ecs';
import { ComponentType } from '../components/ComponentType.ts';
import type { PickupComponent } from '../components/PickupComponent.ts';

export class PickupSystem extends GameSystem {
  public override processTick(_tick: number): void {
    const entities = this.entityManager.queryEntities(ComponentType.Pickup);

    for (const entity of entities) {
      if (entity.isDestroyed) continue;
      const pickup = entity.getComponent<PickupComponent>(ComponentType.Pickup);
      if (!pickup) continue;

      pickup.lifetime--;
      if (pickup.lifetime <= 0) {
        entity.destroy();
      }
    }
  }
}
