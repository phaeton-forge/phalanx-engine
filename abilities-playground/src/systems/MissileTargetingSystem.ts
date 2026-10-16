import {
  GameSystem,
  type SoAComponentStore,
  type SystemContext,
} from '@phalanx-engine/ecs';
import { TransformSoASchema } from '@phalanx-engine/physics';
import {
  FP,
  FPVector3,
  FPQuaternion,
  type FixedPoint,
  type FPQuaternion as FPQuaternionType,
} from '@phalanx-engine/math';
import {
  MISSILE_TARGETING_TURN,
  MISSILE_CRUISE_TURN,
} from '../config/constants';
import { ComponentType } from '../components';
import type { MissileComponent } from '../components/MissileComponent';

const FP_MISSILE_TARGETING_TURN = FP.FromFloat(MISSILE_TARGETING_TURN);
const FP_MISSILE_CRUISE_TURN = FP.FromFloat(MISSILE_CRUISE_TURN);

type AimMode = 'level' | 'direct';

export class MissileTargetingSystem extends GameSystem {
  private transformStore!: SoAComponentStore<
    typeof TransformSoASchema.definition
  >;

  public override init(ctx: SystemContext): void {
    super.init(ctx);
    this.transformStore =
      this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  public override processTick(): void {
    const missiles = this.entityManager.queryEntities(
      ComponentType.Missile,
      ComponentType.Transform,
    );

    for (const missile of missiles) {
      const mc = missile.getComponent<MissileComponent>(ComponentType.Missile);
      if (!mc) continue;

      if (mc.phase === 'approach') {
        const turn =
          mc.approachTicksRemaining > 0
            ? FP_MISSILE_TARGETING_TURN
            : FP_MISSILE_CRUISE_TURN;
        this.slerpTowardTarget(missile.id, mc, turn, 'level');
        if (mc.approachTicksRemaining > 0) {
          mc.approachTicksRemaining -= 1;
        }
      } else if (mc.phase === 'attack') {
        this.slerpTowardTarget(
          missile.id,
          mc,
          FP_MISSILE_CRUISE_TURN,
          'direct',
        );
      }
    }
  }

  private readRotation(tIdx: number): FPQuaternionType {
    const ax = this.transformStore.arrays;
    return {
      x: FP.FromRaw(ax.fpRotationX[tIdx]),
      y: FP.FromRaw(ax.fpRotationY[tIdx]),
      z: FP.FromRaw(ax.fpRotationZ[tIdx]),
      w: FP.FromRaw(ax.fpRotationW[tIdx]),
    };
  }

  private writeRotation(tIdx: number, q: FPQuaternionType): void {
    const ax = this.transformStore.arrays;
    ax.fpRotationX[tIdx] = FP.ToRaw(q.x);
    ax.fpRotationY[tIdx] = FP.ToRaw(q.y);
    ax.fpRotationZ[tIdx] = FP.ToRaw(q.z);
    ax.fpRotationW[tIdx] = FP.ToRaw(q.w);
  }

  private slerpTowardTarget(
    missileId: number,
    mc: MissileComponent,
    turn: FixedPoint,
    aimMode: AimMode,
  ): void {
    const target = this.buildTargetQuaternion(missileId, mc, aimMode);
    if (!target) return;

    const tIdx = this.transformStore.indexOf(missileId);
    if (tIdx === -1) return;

    const next = FPQuaternion.Slerp(this.readRotation(tIdx), target, turn);
    this.writeRotation(tIdx, next);
  }

  private buildTargetQuaternion(
    missileId: number,
    mc: MissileComponent,
    aimMode: AimMode,
  ): FPQuaternionType | null {
    const tIdx = this.transformStore.indexOf(missileId);
    const ttIdx = this.entityManager.getEntity(mc.targetEntityId)
      ? this.transformStore.indexOf(mc.targetEntityId)
      : -1;
    if (tIdx === -1 || ttIdx === -1) return null;

    const ax = this.transformStore.arrays;
    const missilePos = {
      x: FP.FromRaw(ax.fpPositionX[tIdx]),
      y: FP.FromRaw(ax.fpPositionY[tIdx]),
      z: FP.FromRaw(ax.fpPositionZ[tIdx]),
    };
    const targetPos = {
      x: FP.FromRaw(ax.fpPositionX[ttIdx]),
      y: FP.FromRaw(ax.fpPositionY[ttIdx]),
      z: FP.FromRaw(ax.fpPositionZ[ttIdx]),
    };

    let dir = FPVector3.Sub(targetPos, missilePos);
    if (aimMode === 'level') {
      dir = { x: dir.x, y: FP._0, z: dir.z };
    }
    if (FP.Eq(FPVector3.SqrMagnitude(dir), FP._0)) return null;

    return FPQuaternion.LookRotation(dir);
  }
}
