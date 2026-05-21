import type { Entity } from 'phalanx-ecs';
import { GameSystem } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import {
  ComponentType,
  LifecycleComponent,
  TargetingComponent,
  TransformComponent,
  UnitComponent,
} from '../components';
import { distanceSquared } from '../core/helpers';
import type { GameRuntimeState } from '../core/types';

export class TargetingSystem extends GameSystem {
  public constructor(private readonly state: GameRuntimeState) {
    super();
  }

  public override processTick(): void {
    if (!this.state.simulationStarted || this.state.gameOver) return;

    const units = this.entityManager.queryEntities(ComponentType.Unit);

    for (const entity of units) {
      const unit = entity.getComponent<UnitComponent>(ComponentType.Unit);
      const transform = entity.getComponent<TransformComponent>(
        ComponentType.Transform
      );
      const lifecycle = entity.getComponent<LifecycleComponent>(
        ComponentType.Lifecycle
      );
      const targeting = entity.getComponent<TargetingComponent>(
        ComponentType.Targeting
      );
      if (!unit || !transform || !lifecycle || !targeting || !lifecycle.alive)
        continue;

      const enemies = units.filter((candidate) => {
        const candidateUnit = candidate.getComponent<UnitComponent>(
          ComponentType.Unit
        );
        const candidateLife = candidate.getComponent<LifecycleComponent>(
          ComponentType.Lifecycle
        );
        return (
          !!candidateUnit &&
          !!candidateLife &&
          candidateUnit.teamId !== unit.teamId &&
          candidateLife.alive
        );
      });

      if (unit.unitType === 'sphere') {
        targeting.attackTargetId = this.pickNearestEntityId(transform, enemies);
      } else if (unit.unitType === 'cone') {
        const nearest = this.pickNearestEntityIds(transform, enemies, 2);
        targeting.illuminatedTargetIds = [
          nearest[0] ?? null,
          nearest[1] ?? null,
        ];
        targeting.jammedTargetId = nearest[0] ?? null;
      }
    }
  }

  private pickNearestEntityId(
    transform: TransformComponent,
    entities: Entity[]
  ): number | null {
    const nearest = this.pickNearestEntityIds(transform, entities, 1);
    return nearest[0] ?? null;
  }

  private pickNearestEntityIds(
    transform: TransformComponent,
    entities: Entity[],
    count: number
  ): number[] {
    const sourceX = FP.ToFloat(transform.x);
    const sourceZ = FP.ToFloat(transform.z);
    const scored: Array<{ id: number; score: number }> = [];

    for (const entity of entities) {
      const targetTransform = entity.getComponent<TransformComponent>(
        ComponentType.Transform
      );
      if (!targetTransform) continue;
      scored.push({
        id: entity.id,
        score: distanceSquared(
          sourceX,
          sourceZ,
          FP.ToFloat(targetTransform.x),
          FP.ToFloat(targetTransform.z)
        ),
      });
    }

    scored.sort((a, b) => a.score - b.score || a.id - b.id);
    return scored.slice(0, count).map((entry) => entry.id);
  }
}
