import { GameSystem } from '@phalanx-engine/ecs';
import type { SoAComponentStore, SystemContext } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import { TransformSoASchema } from '@phalanx-engine/physics';
import type { FixedPoint } from '@phalanx-engine/math';
import {
  ComponentType,
  TargetStateComponent,
  TeamComponent,
  StatsComponent,
  UnitTypeComponent,
} from '../components';

export class TargetingSystem extends GameSystem {
  private transformStore!: SoAComponentStore<
    typeof TransformSoASchema.definition
  >;

  constructor() {
    super();
  }

  public override init(context: SystemContext): void {
    super.init(context);
    this.transformStore =
      this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  public override processTick(): void {
    const units = this.entityManager.queryEntities(
      ComponentType.Team,
      ComponentType.TargetState,
      ComponentType.UnitStats,
      ComponentType.UnitType,
      ComponentType.Transform,
    );

    for (const unit of units) {
      const stats = unit.getComponent<StatsComponent>(ComponentType.UnitStats);
      const targetState = unit.getComponent<TargetStateComponent>(
        ComponentType.TargetState,
      );
      const team = unit.getComponent<TeamComponent>(ComponentType.Team);
      const unitType = unit.getComponent<UnitTypeComponent>(ComponentType.UnitType);
      if (!stats?.alive || !targetState || !team || !unitType) continue;

      const unitIndex = this.transformStore.indexOf(unit.id);
      if (unitIndex === -1) continue;

      const unitX = FP.FromRaw(this.transformStore.arrays.fpPositionX[unitIndex]);
      const unitZ = FP.FromRaw(this.transformStore.arrays.fpPositionZ[unitIndex]);
      const detectionRadius = unitType.detectionRadius;
      const detectionRadiusSq = FP.Mul(detectionRadius, detectionRadius);

      let bestTargetId: number | null = null;
      let bestDistanceSq: FixedPoint | null = null;

      for (const candidate of units) {
        const candidateId = candidate.id;
        if (candidateId === unit.id) continue;
        if (!candidate) continue;

        const candidateStats = candidate.getComponent<StatsComponent>(
          ComponentType.UnitStats,
        );
        const candidateTeam = candidate.getComponent<TeamComponent>(
          ComponentType.Team,
        );
        if (!candidateStats?.alive || candidateTeam?.teamId === team.teamId) {
          continue;
        }

        const candidateIndex = this.transformStore.indexOf(candidateId);
        if (candidateIndex === -1) continue;

        const dx = FP.Sub(
          FP.FromRaw(this.transformStore.arrays.fpPositionX[candidateIndex]),
          unitX,
        );
        const dz = FP.Sub(
          FP.FromRaw(this.transformStore.arrays.fpPositionZ[candidateIndex]),
          unitZ,
        );
        const distanceSq = FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz));
        if (FP.Gt(distanceSq, detectionRadiusSq)) continue;

        if (
          bestDistanceSq === null ||
          FP.Lt(distanceSq, bestDistanceSq) ||
          (FP.Eq(distanceSq, bestDistanceSq) &&
            (bestTargetId === null || candidateId < bestTargetId))
        ) {
          bestTargetId = candidateId;
          bestDistanceSq = distanceSq;
        }
      }

      targetState.targetEntityId = bestTargetId;
    }
  }
}
