import { GameSystem } from 'phalanx-ecs';
import {
  ComponentType,
  LifecycleComponent,
  TargetingComponent,
  UnitComponent,
} from '../components';
import type { AbilityContext, GameRuntimeState } from '../core/types';

export class BeamSystem extends GameSystem {
  public constructor(
    private readonly state: GameRuntimeState,
    private readonly abilities: AbilityContext
  ) {
    super();
  }

  public override processTick(): void {
    if (!this.state.simulationStarted || this.state.gameOver) return;

    const entities = this.entityManager.queryEntities(ComponentType.Unit);
    for (const entity of entities) {
      const unit = entity.getComponent<UnitComponent>(ComponentType.Unit);
      const lifecycle = entity.getComponent<LifecycleComponent>(
        ComponentType.Lifecycle
      );
      const targeting = entity.getComponent<TargetingComponent>(
        ComponentType.Targeting
      );
      if (
        !unit ||
        !lifecycle ||
        !targeting ||
        !lifecycle.alive ||
        unit.unitType !== 'cone'
      )
        continue;

      const targets = [
        targeting.illuminatedTargetIds[0],
        targeting.illuminatedTargetIds[1],
      ];
      for (const targetId of targets) {
        if (targetId === null) continue;
        const targetLife = this.entityManager
          .getEntity(targetId)
          ?.getComponent<LifecycleComponent>(ComponentType.Lifecycle);
        if (!targetLife || !targetLife.alive) continue;
        this.abilities.facade.applyEffect(
          targetId,
          this.abilities.effects.illuminated,
          entity.id
        );
      }

      if (targeting.jammedTargetId !== null) {
        const jammedLife = this.entityManager
          .getEntity(targeting.jammedTargetId)
          ?.getComponent<LifecycleComponent>(ComponentType.Lifecycle);
        if (jammedLife?.alive) {
          this.abilities.facade.applyEffect(
            targeting.jammedTargetId,
            this.abilities.effects.jammed,
            entity.id
          );
        }
      }
    }
  }
}
