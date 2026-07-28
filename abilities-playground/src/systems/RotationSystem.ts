import { GameSystem } from '@phalanx-engine/ecs';
import type { SoAComponentStore, SystemContext } from '@phalanx-engine/ecs';
import { FP, FPQuaternion } from '@phalanx-engine/math';
import type { FixedPoint } from '@phalanx-engine/math';
import { TransformSoASchema } from '@phalanx-engine/physics';
import {
  TURRET_TURN_SPEED_RADIANS_PER_TICK,
  UNIT_TURN_SPEED_RADIANS_PER_TICK,
} from '../config/constants';
import {
  ComponentType,
  StatsComponent,
  TargetStateComponent,
  TeamComponent,
  TurretComponent,
} from '../components';

const MAX_TURN_PER_TICK = FP.FromFloat(UNIT_TURN_SPEED_RADIANS_PER_TICK);
const MAX_TURRET_TURN_PER_TICK = FP.FromFloat(
  TURRET_TURN_SPEED_RADIANS_PER_TICK,
);
const TWO = FP.FromInt(2);
const TEAM0_DEFAULT_YAW = FP._0;
const TEAM1_DEFAULT_YAW = FP.Pi;

/** Wrap an angle (radians) into [-π, π] using fixed-point only. */
function normalizeAngle(radians: FixedPoint): FixedPoint {
  let angle = radians;
  while (FP.Gt(angle, FP.Pi)) {
    angle = FP.Sub(angle, FP.Pi2);
  }
  while (FP.Lt(angle, FP.Neg(FP.Pi))) {
    angle = FP.Add(angle, FP.Pi2);
  }
  return angle;
}

/** Shortest-path rotation toward a target angle, clamped by max delta (radians). */
function rotateTowardY(
  current: FixedPoint,
  target: FixedPoint,
  maxDelta: FixedPoint,
): FixedPoint {
  const normalizedTarget = normalizeAngle(target);
  const delta = normalizeAngle(FP.Sub(normalizedTarget, current));

  if (FP.Lte(FP.Abs(delta), maxDelta)) {
    return normalizedTarget;
  }

  const step = FP.Lt(delta, FP._0) ? FP.Neg(maxDelta) : maxDelta;
  return normalizeAngle(FP.Add(current, step));
}

export class RotationSystem extends GameSystem {
  private transformStore!: SoAComponentStore<typeof TransformSoASchema.definition>;

  /** Scratch: set by {@link updateFacing}; valid only when {@link hasFacing} is true. */
  private hasFacing = false;
  private facingAngle: FixedPoint = FP._0;
  private facingInAttackRange = false;

  public override init(context: SystemContext): void {
    super.init(context);
    this.transformStore = this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  private readRotationY(unitIndex: number): FixedPoint {
    const ax = this.transformStore.arrays;
    const x = FP.FromRaw(ax.fpRotationX[unitIndex]);
    const y = FP.FromRaw(ax.fpRotationY[unitIndex]);
    const z = FP.FromRaw(ax.fpRotationZ[unitIndex]);
    const w = FP.FromRaw(ax.fpRotationW[unitIndex]);
    const sinY = FP.Mul(TWO, FP.Add(FP.Mul(w, y), FP.Mul(x, z)));
    const cosY = FP.Sub(FP._1, FP.Mul(TWO, FP.Add(FP.Mul(y, y), FP.Mul(z, z))));
    return FP.Atan2(sinY, cosY);
  }

  private writeRotationY(unitIndex: number, yaw: FixedPoint): void {
    const q = FPQuaternion.FromYaw(yaw);
    const ax = this.transformStore.arrays;
    ax.fpRotationX[unitIndex] = FP.ToRaw(q.x);
    ax.fpRotationY[unitIndex] = FP.ToRaw(q.y);
    ax.fpRotationZ[unitIndex] = FP.ToRaw(q.z);
    ax.fpRotationW[unitIndex] = FP.ToRaw(q.w);
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

      const currentY = this.readRotationY(unitIndex);
      this.updateFacing(targetState, stats, unitIndex);
      const turret = unit.getComponent<TurretComponent>(ComponentType.Turret);

      // Turreted units split the job: the hull turns only while it still has to
      // drive toward the target, the turret does all the aiming once in range.
      if (turret && this.hasFacing && this.facingInAttackRange) {
        const relativeYaw = normalizeAngle(FP.Sub(this.facingAngle, currentY));
        turret.yaw = rotateTowardY(
          turret.yaw,
          relativeYaw,
          MAX_TURRET_TURN_PER_TICK,
        );
        continue;
      }

      const desiredY = this.hasFacing
        ? this.facingAngle
        : team.teamId === 0
          ? TEAM0_DEFAULT_YAW
          : TEAM1_DEFAULT_YAW;
      this.writeRotationY(
        unitIndex,
        rotateTowardY(currentY, desiredY, MAX_TURN_PER_TICK),
      );

      // Out of range (or no target): recenter the turret so the barrel lines up
      // with the hull again while the tank advances.
      if (turret) {
        turret.yaw = rotateTowardY(turret.yaw, FP._0, MAX_TURRET_TURN_PER_TICK);
      }
    }
  }

  /**
   * Writes world-space yaw toward the current target and whether it is inside
   * `stopRange` into instance scratch fields. Sets {@link hasFacing} false when
   * there is no usable target (avoids allocating a result object each tick).
   */
  private updateFacing(
    targetState: TargetStateComponent,
    stats: StatsComponent,
    ownIndex: number,
  ): void {
    this.hasFacing = false;

    if (targetState.targetEntityId === null) return;

    const targetIndex = this.transformStore.indexOf(targetState.targetEntityId);
    if (targetIndex === -1) return;

    const ownX = FP.FromRaw(this.transformStore.arrays.fpPositionX[ownIndex]);
    const ownZ = FP.FromRaw(this.transformStore.arrays.fpPositionZ[ownIndex]);
    const dx = FP.Sub(
      FP.FromRaw(this.transformStore.arrays.fpPositionX[targetIndex]),
      ownX,
    );
    const dz = FP.Sub(
      FP.FromRaw(this.transformStore.arrays.fpPositionZ[targetIndex]),
      ownZ,
    );

    const distanceSq = FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz));
    if (FP.Eq(distanceSq, FP._0)) return;

    // Same predicate MovementSystem uses to stop advancing, so "hull turns"
    // and "hull drives" switch off on exactly the same tick.
    // Yaw convention matches prior Math.atan2(dx, dz): FP.Atan2(y=dx, x=dz).
    const stopRangeSq = FP.Mul(stats.stopRange, stats.stopRange);
    this.facingAngle = FP.Atan2(dx, dz);
    this.facingInAttackRange = FP.Lte(distanceSq, stopRangeSq);
    this.hasFacing = true;
  }
}
