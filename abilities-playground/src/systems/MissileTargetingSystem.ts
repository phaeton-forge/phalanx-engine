import {
  GameSystem,
  type SoAComponentStore,
  type SystemContext,
} from '@phalanx-engine/ecs';
import { TransformSoASchema } from '@phalanx-engine/physics';
import { FP } from '@phalanx-engine/math';
import * as THREE from 'three';
import {
  MISSILE_TARGETING_TURN,
  MISSILE_CRUISE_TURN,
} from '../config/constants';
import { ComponentType } from '../components';
import type { MissileComponent } from '../components/MissileComponent';

const FORWARD = new THREE.Vector3(0, 0, 1);
const _dir = new THREE.Vector3();
const _cur = new THREE.Quaternion();
const _target = new THREE.Quaternion();
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

      if (mc.phase === 'targeting') {
        this.slerpTowardTarget(missile.id, mc, MISSILE_TARGETING_TURN, 'level');
        mc.targetingTicksRemaining -= 1;
        if (mc.targetingTicksRemaining <= 0) {
          this.faceTarget(missile.id, mc, 'level');
          mc.phase = 'cruise';
        }
      } else if (mc.phase === 'cruise') {
        this.slerpTowardTarget(missile.id, mc, MISSILE_CRUISE_TURN, 'level');
      } else if (mc.phase === 'attack') {
        this.slerpTowardTarget(missile.id, mc, MISSILE_CRUISE_TURN, 'direct');
      }
    }
  }

  private slerpTowardTarget(
    missileId: number,
    mc: MissileComponent,
    turn: number,
    aimMode: AimMode
  ): void {
    if (!this.buildTargetQuaternion(missileId, mc, aimMode)) return;

    _cur.set(mc.qx, mc.qy, mc.qz, mc.qw);
    _cur.slerp(_target, turn);
    mc.qx = _cur.x;
    mc.qy = _cur.y;
    mc.qz = _cur.z;
    mc.qw = _cur.w;
  }

  private faceTarget(
    missileId: number,
    mc: MissileComponent,
    aimMode: AimMode
  ): void {
    if (!this.buildTargetQuaternion(missileId, mc, aimMode)) return;

    mc.qx = _target.x;
    mc.qy = _target.y;
    mc.qz = _target.z;
    mc.qw = _target.w;
  }

  private buildTargetQuaternion(
    missileId: number,
    mc: MissileComponent,
    aimMode: AimMode
  ): boolean {
    const tIdx = this.transformStore.indexOf(missileId);
    const ttIdx = this.entityManager.getEntity(mc.targetEntityId)
      ? this.transformStore.indexOf(mc.targetEntityId)
      : -1;
    if (tIdx === -1 || ttIdx === -1) return false;

    const ax = this.transformStore.arrays;
    _dir.set(
      FP.ToFloat(FP.FromRaw(ax.fpPositionX[ttIdx])) -
        FP.ToFloat(FP.FromRaw(ax.fpPositionX[tIdx])),
      aimMode === 'direct'
        ? FP.ToFloat(FP.FromRaw(ax.fpPositionY[ttIdx])) -
            FP.ToFloat(FP.FromRaw(ax.fpPositionY[tIdx]))
        : 0,
      FP.ToFloat(FP.FromRaw(ax.fpPositionZ[ttIdx])) -
        FP.ToFloat(FP.FromRaw(ax.fpPositionZ[tIdx]))
    );
    if (_dir.lengthSq() < 1e-8) return false;
    _dir.normalize();

    _target.setFromUnitVectors(FORWARD, _dir);
    return true;
  }
}
