import { GameSystem } from 'phalanx-ecs';
import type { SoAComponentStore, SystemContext } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import type { FixedPoint } from 'phalanx-math';
import {
  ComponentType,
  TargetStateComponent,
  TeamComponent,
  TransformSoASchema,
  StatsComponent,
} from '../components';

export class TargetingSystem extends GameSystem {
  private transformStore!: SoAComponentStore<
    typeof TransformSoASchema.definition
  >;

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
      ComponentType.Transform,
    );

    for (const unit of units) {
      const stats = unit.getComponent<StatsComponent>(
        ComponentType.UnitStats,
      );
      const targetState = unit.getComponent<TargetStateComponent>(
        ComponentType.TargetState,
      );
      const team = unit.getComponent<TeamComponent>(ComponentType.Team);
      if (!stats?.alive || !targetState || !team) continue;

      let bestTargetId: number | null = null;
      let bestDistanceSq: FixedPoint | null = null;
      const unitIndex = this.transformStore.indexOf(unit.id);
      if (unitIndex === -1) continue;

      const unitX = FP.FromRaw(this.transformStore.arrays.fpPositionX[unitIndex]);
      const unitZ = FP.FromRaw(this.transformStore.arrays.fpPositionZ[unitIndex]);

      for (const candidate of units) {
        if (candidate.id === unit.id) continue;

        const candidateStats = candidate.getComponent<StatsComponent>(
          ComponentType.UnitStats,
        );
        const candidateTeam = candidate.getComponent<TeamComponent>(
          ComponentType.Team,
        );
        if (!candidateStats?.alive || candidateTeam?.teamId === team.teamId) {
          continue;
        }

        const candidateIndex = this.transformStore.indexOf(candidate.id);
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
        if (
          bestDistanceSq === null ||
          FP.Lt(distanceSq, bestDistanceSq) ||
          (FP.Eq(distanceSq, bestDistanceSq) &&
            (bestTargetId === null || candidate.id < bestTargetId))
        ) {
          bestTargetId = candidate.id;
          bestDistanceSq = distanceSq;
        }
      }

      targetState.targetEntityId = bestTargetId;
    }
  }
}
