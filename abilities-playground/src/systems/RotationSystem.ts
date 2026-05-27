import { GameSystem } from 'phalanx-ecs';
import type {
  CommandsBatch,
  IAfterFrame,
  IBeforeTick,
  SoAComponentStore,
  SystemContext,
} from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import {
  ComponentType,
  MeshComponent,
  StatsComponent,
  TargetStateComponent,
  TeamComponent,
  TransformSoASchema,
} from '../components';

/** Shortest-path angle interpolation on the Y axis (radians). */
export function lerpAngleY(from: number, to: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  let delta = to - from;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  return from + delta * clamped;
}

export class RotationSystem extends GameSystem implements IBeforeTick, IAfterFrame {
  private transformStore!: SoAComponentStore<typeof TransformSoASchema.definition>;

  public override init(context: SystemContext): void {
    super.init(context);
    this.transformStore = this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  public beforeTick(_tick: number, _commands: CommandsBatch): void {
    const visualRotationY = this.transformStore.arrays.visualRotationY;
    const previousVisualRotationY = this.transformStore.arrays.previousVisualRotationY;
    const units = this.entityManager.queryEntities(
      ComponentType.Team,
      ComponentType.TargetState,
      ComponentType.UnitStats,
      ComponentType.Transform,
    );

    for (const unit of units) {
      const stats = unit.getComponent<StatsComponent>(ComponentType.UnitStats);
      if (!stats?.alive) continue;

      const unitIndex = this.transformStore.indexOf(unit.id);
      if (unitIndex === -1) continue;

      previousVisualRotationY[unitIndex] = visualRotationY[unitIndex];
    }
  }

  public override processTick(): void {
    const visualRotationY = this.transformStore.arrays.visualRotationY;
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

      visualRotationY[unitIndex] = this.computeFacingAngle(
        targetState,
        team,
        unitIndex,
      );
    }
  }

  public afterFrame(alpha: number, _dt: number): void {
    const clampedAlpha = Math.max(0, Math.min(1, alpha));
    const visualRotationY = this.transformStore.arrays.visualRotationY;
    const previousVisualRotationY = this.transformStore.arrays.previousVisualRotationY;
    const units = this.entityManager.queryEntities(
      ComponentType.Mesh,
      ComponentType.Transform,
      ComponentType.UnitStats,
    );

    for (const unit of units) {
      const stats = unit.getComponent<StatsComponent>(ComponentType.UnitStats);
      const mesh = unit.getComponent<MeshComponent>(ComponentType.Mesh);
      if (!stats?.alive || !mesh) continue;

      const unitIndex = this.transformStore.indexOf(unit.id);
      if (unitIndex === -1) continue;

      mesh.root.rotation.y = lerpAngleY(
        previousVisualRotationY[unitIndex],
        visualRotationY[unitIndex],
        clampedAlpha,
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
