import { GameSystem } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import {
  ComponentType,
  LifecycleComponent,
  UnitComponent,
  VisualComponent,
} from '../components';
import type { AbilityContext, GameRuntimeState } from '../core/types';

export class DeathSystem extends GameSystem {
  public constructor(
    private readonly state: GameRuntimeState,
    private readonly abilities: AbilityContext,
    private readonly onGameOver: (winner: 1 | 2) => void
  ) {
    super();
  }

  public override processTick(tick: number): void {
    const units = this.entityManager.queryEntities(ComponentType.Unit);

    for (const entity of units) {
      const unit = entity.getComponent<UnitComponent>(ComponentType.Unit);
      const life = entity.getComponent<LifecycleComponent>(
        ComponentType.Lifecycle
      );
      if (!unit || !life) continue;

      if (life.alive) {
        const health = this.abilities.facade.getAttribute(
          entity.id,
          'Health'
        ).current;
        if (FP.Lte(health, FP._0)) {
          life.alive = false;
          life.dyingSinceTick = tick;
          if (unit.auraEntityId !== null) {
            this.abilities.facade.removeEffectsByTag(
              unit.auraEntityId,
              this.abilities.tags.cubeAura
            );
          }
        }
      } else if (
        life.dyingSinceTick !== null &&
        tick - life.dyingSinceTick >= 20
      ) {
        life.removable = true;
      }
    }

    for (const entity of units) {
      const life = entity.getComponent<LifecycleComponent>(
        ComponentType.Lifecycle
      );
      if (!life?.removable) continue;

      const visual = entity.getComponent<VisualComponent>(ComponentType.Visual);
      visual?.mesh.dispose();
      visual?.hpBar.dispose();
      visual?.auraRing?.dispose();
      for (const beam of visual?.beamLines ?? []) {
        beam?.dispose();
      }

      this.entityManager.removeEntity(entity);
    }

    if (!this.state.simulationStarted || this.state.gameOver) return;

    let team1Alive = 0;
    let team2Alive = 0;
    const aliveUnits = this.entityManager.queryEntities(ComponentType.Unit);
    for (const entity of aliveUnits) {
      const unit = entity.getComponent<UnitComponent>(ComponentType.Unit);
      const life = entity.getComponent<LifecycleComponent>(
        ComponentType.Lifecycle
      );
      if (!unit || !life || !life.alive) continue;
      if (unit.teamId === 1) team1Alive += 1;
      if (unit.teamId === 2) team2Alive += 1;
    }

    if (team1Alive === 0 || team2Alive === 0) {
      this.state.gameOver = true;
      this.state.winnerTeam = team1Alive > 0 ? 1 : 2;
      this.onGameOver(this.state.winnerTeam);
    }
  }
}
