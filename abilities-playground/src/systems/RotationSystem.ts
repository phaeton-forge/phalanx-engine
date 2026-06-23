import { GameSystem } from '@phalanx-engine/ecs';
import type { SoAComponentStore, SystemContext } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import type { FixedPoint } from '@phalanx-engine/math';
import { TransformSoASchema } from '@phalanx-engine/physics';
import { UNIT_TURN_SPEED_RADIANS_PER_TICK } from '../config/constants';
import {
  ComponentType,
  StatsComponent,
  TargetStateComponent,
  TeamComponent,
} from '../components';

const MAX_TURN_PER_TICK = FP.FromFloat(UNIT_TURN_SPEED_RADIANS_PER_TICK);

/** Shortest-path rotation toward a target angle, clamped by max delta (radians). */
function rotateTowardY(
  current: FixedPoint,
  targetRadians: number,
  maxDelta: FixedPoint,
): FixedPoint {
  const currentRad = FP.ToFloat(current);
  let delta = targetRadians - currentRad;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;

  const maxDeltaRad = FP.ToFloat(maxDelta);
  if (Math.abs(delta) <= maxDeltaRad) {
    return FP.FromFloat(targetRadians);
  }
  return FP.FromFloat(currentRad + Math.sign(delta) * maxDeltaRad);
}

export class RotationSystem extends GameSystem {
  private transformStore!: SoAComponentStore<typeof TransformSoASchema.definition>;

  public override init(context: SystemContext): void {
    super.init(context);
    this.transformStore = this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  public override processTick(): void {
    const units = this.entityManager.queryEntities(
      ComponentType.Team,
      ComponentType.TargetState,
      ComponentType.UnitStats,
      ComponentType.Transform,
    );

    for (const unit of units) {
      const stats = unit.getComponent<StatsComponent>(ComponentType.UnitStats);
      const targetState = unit.getComponent<TargetStateComponent>(ComponentType.TargetState);
      const team = unit.getComponent<TeamComponent>(ComponentType.Team);
      if (!stats?.alive || !targetState || !team) continue;

      const unitIndex = this.transformStore.indexOf(unit.id);
      if (unitIndex === -1) continue;

      const currentY = FP.FromRaw(this.transformStore.arrays.fpRotationY[unitIndex]);
      const desiredY = this.computeFacingAngle(targetState, team, unitIndex);
      this.transformStore.arrays.fpRotationY[unitIndex] = FP.ToRaw(
        rotateTowardY(currentY, desiredY, MAX_TURN_PER_TICK),
      );
    }
  }

  private computeFacingAngle(
    targetState: TargetStateComponent,
    team: TeamComponent,
    ownIndex: number,
  ): number {
    const ownX = FP.FromRaw(this.transformStore.arrays.fpPositionX[ownIndex]);
    const ownZ = FP.FromRaw(this.transformStore.arrays.fpPositionZ[ownIndex]);

    if (targetState.targetEntityId !== null) {
      const targetIndex = this.transformStore.indexOf(targetState.targetEntityId);
      if (targetIndex !== -1) {
        const dx = FP.Sub(
          FP.FromRaw(this.transformStore.arrays.fpPositionX[targetIndex]),
          ownX,
        );
        const dz = FP.Sub(
          FP.FromRaw(this.transformStore.arrays.fpPositionZ[targetIndex]),
          ownZ,
        );
        const distanceSq = FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz));
        if (!FP.Eq(distanceSq, FP._0)) {
          return Math.atan2(FP.ToFloat(dx), FP.ToFloat(dz));
        }
      }
    }

    return team.teamId === 0 ? 0 : Math.PI;
  }
}
