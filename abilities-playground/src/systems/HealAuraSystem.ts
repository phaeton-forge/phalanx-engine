import { GameSystem } from 'phalanx-ecs';
import {
  ComponentType,
  LifecycleComponent,
  UnitComponent,
} from '../components';
import type { AbilityContext } from '../core/types';

export class HealAuraSystem extends GameSystem {
  public constructor(private readonly abilities: AbilityContext) {
    super();
  }

  public override processTick(): void {
    const entities = this.entityManager.queryEntities(ComponentType.Unit);

    for (const entity of entities) {
      const unit = entity.getComponent<UnitComponent>(ComponentType.Unit);
      const lifecycle = entity.getComponent<LifecycleComponent>(
        ComponentType.Lifecycle
      );
      if (!unit || !lifecycle || unit.unitType !== 'cube') continue;
      if (unit.auraEntityId === null) continue;

      if (!lifecycle.alive) {
        this.abilities.facade.removeEffectsByTag(
          unit.auraEntityId,
          this.abilities.tags.cubeAura
        );
      }
    }
  }
}
