import type { AbilitySystem, CueEvent } from '@phalanx-engine/abilities';
import {
  GameSystem,
  type SoAComponentStore,
  type SystemContext,
} from '@phalanx-engine/ecs';
import {
  PhysicsWorld,
  PhysicsSoASchema,
  TransformSoASchema,
} from '@phalanx-engine/physics';
import { FP, FPVector3, FPQuaternion, type FixedPoint } from '@phalanx-engine/math';
import {
  networkConfig,
  MISSILE_SPEED,
  MISSILE_LAUNCH_HEIGHT,
  MISSILE_ATTACK_RANGE,
  PROJECTILE_DESPAWN_DELAY_TICKS,
  MISSILE_RETARGET_RANGE,
} from '../config/constants';
import { ComponentType, StatsComponent, TeamComponent } from '../components';
import type { MissileComponent } from '../components/MissileComponent';
import { ProjectileComponent } from '../components/ProjectileComponent';
import type { MissileEntity } from '../entities/Missile';
import {
  GameEvents,
  type ProjectileDespawnRequestedEvent,
} from '../events/GameEvents';
import {
  despawnProjectile,
  softDeactivateProjectile,
} from './projectileDespawn';

const FP_TICK = FP.FromFloat(networkConfig.tickTimestep);
const FP_SPEED = FP.FromFloat(MISSILE_SPEED);
const FP_STEP = FP.Mul(FP_SPEED, FP_TICK);
const FP_ATTACK_RANGE = FP.FromFloat(MISSILE_ATTACK_RANGE);
const FP_ATTACK_RANGE_SQ = FP.Mul(FP_ATTACK_RANGE, FP_ATTACK_RANGE);
const FP_RETARGET_RANGE = FP.FromFloat(MISSILE_RETARGET_RANGE);

type FlatOffset = { dx: FixedPoint; dz: FixedPoint; distSq: FixedPoint };

export class MissileMovementSystem extends GameSystem {
  private physicsStore!: SoAComponentStore<typeof PhysicsSoASchema.definition>;
  private transformStore!: SoAComponentStore<
    typeof TransformSoASchema.definition
  >;

  public override init(ctx: SystemContext): void {
    super.init(ctx);
    this.physicsStore =
      this.entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    this.transformStore =
      this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  public override processTick(tick: number): void {
    const missiles = this.entityManager.queryEntities(
      ComponentType.Missile,
      ComponentType.Transform
    ) as MissileEntity[];

    for (const missile of missiles) {
      if (!missile.active) continue;
      const mc = missile.getComponent<MissileComponent>(ComponentType.Missile);
      if (!mc) continue;

      mc.lifeTime = FP.Sub(mc.lifeTime, FP_TICK);
      if (FP.Lte(mc.lifeTime, FP._0)) {
        despawnProjectile(this.pools, missile);
        continue;
      }

      const tIdx = this.transformStore.indexOf(missile.id);
      const pIdx = this.physicsStore.indexOf(missile.id);
      if (tIdx === -1 || pIdx === -1) continue;

      switch (mc.phase) {
        case 'launch':
          this.tickLaunch(missile, mc, tIdx, pIdx, tick);
          break;
        case 'approach':
          this.tickApproach(missile, mc, tIdx, pIdx, tick);
          break;
        case 'attack':
          this.tickAttack(missile, mc, tIdx, pIdx, tick);
          break;
      }
    }
  }

  private disablePhysics(pIdx: number): void {
    this.physicsStore.arrays.ignorePhysics[pIdx] = 1;
    this.physicsStore.arrays.velocityX[pIdx] = 0n;
    this.physicsStore.arrays.velocityY[pIdx] = 0n;
    this.physicsStore.arrays.velocityZ[pIdx] = 0n;
  }

  /**
   * Full cruise altitude above spawn. Reached once the launch arc completes;
   * a missile may dive early if it closes to within MISSILE_ATTACK_RANGE first.
   */
  private cruiseAltitude(mc: MissileComponent): FixedPoint {
    const height = FP.Mul(
      FP.FromFloat(MISSILE_LAUNCH_HEIGHT),
      mc.launchHeightScale
    );
    return FP.Add(mc.spawnY, height);
  }

  private flatOffsetToTarget(
    mc: MissileComponent,
    tIdx: number
  ): FlatOffset | null {
    const ttIdx = this.transformStore.indexOf(mc.targetEntityId);
    if (ttIdx === -1) return null;

    const mx = FP.FromRaw(this.transformStore.arrays.fpPositionX[tIdx]);
    const mz = FP.FromRaw(this.transformStore.arrays.fpPositionZ[tIdx]);
    const tx = FP.FromRaw(this.transformStore.arrays.fpPositionX[ttIdx]);
    const tz = FP.FromRaw(this.transformStore.arrays.fpPositionZ[ttIdx]);
    const dx = FP.Sub(tx, mx);
    const dz = FP.Sub(tz, mz);
    return { dx, dz, distSq: FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz)) };
  }

  private stepFlatTowardTarget(offset: FlatOffset, tIdx: number): void {
    if (FP.Lte(offset.distSq, FP._0)) return;

    const dist = FP.Sqrt(offset.distSq);
    const mx = FP.FromRaw(this.transformStore.arrays.fpPositionX[tIdx]);
    const mz = FP.FromRaw(this.transformStore.arrays.fpPositionZ[tIdx]);
    this.transformStore.arrays.fpPositionX[tIdx] = FP.ToRaw(
      FP.Add(mx, FP.Mul(FP.Div(offset.dx, dist), FP_STEP))
    );
    this.transformStore.arrays.fpPositionZ[tIdx] = FP.ToRaw(
      FP.Add(mz, FP.Mul(FP.Div(offset.dz, dist), FP_STEP))
    );
  }

  private clampMinAltitude(mc: MissileComponent, tIdx: number): void {
    const minY = this.cruiseAltitude(mc);
    const currentY = FP.FromRaw(this.transformStore.arrays.fpPositionY[tIdx]);
    if (FP.Lt(currentY, minY)) {
      this.transformStore.arrays.fpPositionY[tIdx] = FP.ToRaw(minY);
    }
  }

  private tryEnterAttack(
    missile: MissileEntity,
    mc: MissileComponent,
    tIdx: number,
    pIdx: number,
    tick: number,
    flatDistSq: FixedPoint | null
  ): boolean {
    if (flatDistSq === null || FP.Gt(flatDistSq, FP_ATTACK_RANGE_SQ)) {
      return false;
    }

    mc.phase = 'attack';
    this.tickAttack(missile, mc, tIdx, pIdx, tick);
    return true;
  }

  private readForward(tIdx: number): FPVector3 {
    const ax = this.transformStore.arrays;
    const q = {
      x: FP.FromRaw(ax.fpRotationX[tIdx]),
      y: FP.FromRaw(ax.fpRotationY[tIdx]),
      z: FP.FromRaw(ax.fpRotationZ[tIdx]),
      w: FP.FromRaw(ax.fpRotationW[tIdx]),
    };
    return FPQuaternion.RotateVector(q, FPVector3.Forward);
  }

  private moveAlongForward(tIdx: number, stepMag: FixedPoint): void {
    const forward = this.readForward(tIdx);
    if (FP.Eq(FPVector3.SqrMagnitude(forward), FP._0)) return;

    const delta = FPVector3.Scale(forward, stepMag);
    const mx = FP.FromRaw(this.transformStore.arrays.fpPositionX[tIdx]);
    const my = FP.FromRaw(this.transformStore.arrays.fpPositionY[tIdx]);
    const mz = FP.FromRaw(this.transformStore.arrays.fpPositionZ[tIdx]);

    this.transformStore.arrays.fpPositionX[tIdx] = FP.ToRaw(FP.Add(mx, delta.x));
    this.transformStore.arrays.fpPositionY[tIdx] = FP.ToRaw(FP.Add(my, delta.y));
    this.transformStore.arrays.fpPositionZ[tIdx] = FP.ToRaw(FP.Add(mz, delta.z));
  }

  private tickLaunch(
    missile: MissileEntity,
    mc: MissileComponent,
    tIdx: number,
    pIdx: number,
    tick: number
  ): void {
    this.disablePhysics(pIdx);

    const flat = this.flatOffsetToTarget(mc, tIdx);
    if (
      flat !== null &&
      this.tryEnterAttack(missile, mc, tIdx, pIdx, tick, flat.distSq)
    ) {
      return;
    }

    this.moveAlongForward(tIdx, FP_STEP);

    mc.launchTicksRemaining -= 1;
    if (mc.launchTicksRemaining <= 0) {
      mc.phase = 'approach';
    }
  }

  private tickApproach(
    missile: MissileEntity,
    mc: MissileComponent,
    tIdx: number,
    pIdx: number,
    tick: number
  ): void {
    this.disablePhysics(pIdx);

    if (!this.isTargetValid(mc)) {
      mc.targetEntityId = this.findNearestHostile(missile, tIdx);
    }

    const flat = this.flatOffsetToTarget(mc, tIdx);
    if (flat === null) {
      this.handleSelfDestruct(missile, tick);
      return;
    }

    if (this.tryEnterAttack(missile, mc, tIdx, pIdx, tick, flat.distSq)) {
      return;
    }

    this.clampMinAltitude(mc, tIdx);
    this.stepFlatTowardTarget(flat, tIdx);
  }

  private tickAttack(
    missile: MissileEntity,
    mc: MissileComponent,
    tIdx: number,
    pIdx: number,
    tick: number
  ): void {
    this.disablePhysics(pIdx);

    if (!this.isTargetValid(mc)) {
      mc.targetEntityId = this.findNearestHostile(missile, tIdx);
    }

    const ttIdx = this.transformStore.indexOf(mc.targetEntityId);
    if (ttIdx === -1) {
      this.handleSelfDestruct(missile, tick);
      return;
    }

    const mx = FP.FromRaw(this.transformStore.arrays.fpPositionX[tIdx]);
    const my = FP.FromRaw(this.transformStore.arrays.fpPositionY[tIdx]);
    const mz = FP.FromRaw(this.transformStore.arrays.fpPositionZ[tIdx]);
    const tx = FP.FromRaw(this.transformStore.arrays.fpPositionX[ttIdx]);
    const ty = FP.FromRaw(this.transformStore.arrays.fpPositionY[ttIdx]);
    const tz = FP.FromRaw(this.transformStore.arrays.fpPositionZ[ttIdx]);
    const dx = FP.Sub(tx, mx);
    const dy = FP.Sub(ty, my);
    const dz = FP.Sub(tz, mz);
    const distSq = FP.Add(
      FP.Add(FP.Mul(dx, dx), FP.Mul(dy, dy)),
      FP.Mul(dz, dz)
    );
    if (FP.Lte(distSq, FP._0)) {
      this.handleImpact(missile, mc.targetEntityId, tick);
      return;
    }

    const dist = FP.Sqrt(distSq);
    if (FP.Lte(dist, FP_STEP)) {
      this.transformStore.arrays.fpPositionX[tIdx] = FP.ToRaw(tx);
      this.transformStore.arrays.fpPositionY[tIdx] = FP.ToRaw(ty);
      this.transformStore.arrays.fpPositionZ[tIdx] = FP.ToRaw(tz);
      this.handleImpact(missile, mc.targetEntityId, tick);
      return;
    }

    const stepScale = FP.Div(FP_STEP, dist);
    this.transformStore.arrays.fpPositionX[tIdx] = FP.ToRaw(
      FP.Add(mx, FP.Mul(dx, stepScale))
    );
    this.transformStore.arrays.fpPositionY[tIdx] = FP.ToRaw(
      FP.Add(my, FP.Mul(dy, stepScale))
    );
    this.transformStore.arrays.fpPositionZ[tIdx] = FP.ToRaw(
      FP.Add(mz, FP.Mul(dz, stepScale))
    );
  }

  /** Detonate in place when no hostile can be homed (VFX only, no damage). */
  private handleSelfDestruct(missile: MissileEntity, tick: number): void {
    if (!missile.active) return;

    this.bufferMissileImpactCue(missile.id, tick);

    softDeactivateProjectile(this.entityManager, missile, { keepTransform: true });

    this.eventBus.emit<ProjectileDespawnRequestedEvent>(
      GameEvents.PROJECTILE_DESPAWN_REQUESTED,
      {
        projectileId: missile.id,
        dueTick: tick + PROJECTILE_DESPAWN_DELAY_TICKS,
      }
    );
  }

  private bufferMissileImpactCue(missileId: number, tick: number): void {
    const abilities = this.abilities as AbilitySystem | undefined;
    if (!abilities) return;

    (abilities.gameplayCueBuffer.events as CueEvent[]).push({
      tick,
      cueId: 'Cue.Missile.Impact',
      sourceEntityId: missileId,
      targetEntityId: missileId,
      phase: 'OnApplied',
    });
  }

  private handleImpact(
    missile: MissileEntity,
    targetEntityId: number,
    tick: number
  ): void {
    const target = this.entityManager.getEntity(targetEntityId);
    if (!target || !missile.active) return;

    const targetStats = target.getComponent<StatsComponent>(
      ComponentType.UnitStats
    );
    if (!targetStats?.alive) return;

    const missileTeam = missile.getComponent<TeamComponent>(ComponentType.Team);
    const targetTeam = target.getComponent<TeamComponent>(ComponentType.Team);
    if (missileTeam && targetTeam && missileTeam.teamId === targetTeam.teamId)
      return;

    const projectileComp = missile.getComponent<ProjectileComponent>(
      ComponentType.Projectile
    );
    const effectId = projectileComp?.damageEffectId ?? 'Effect.Damage.Missile';
    this.abilities?.applyEffect(target.id, effectId, missile.id);

    softDeactivateProjectile(this.entityManager, missile, { keepTransform: true });
    this.eventBus.emit<ProjectileDespawnRequestedEvent>(
      GameEvents.PROJECTILE_DESPAWN_REQUESTED,
      {
        projectileId: missile.id,
        dueTick: tick + PROJECTILE_DESPAWN_DELAY_TICKS,
      }
    );
  }

  /** A target is homable while it still exists, is alive, and has a transform. */
  private isTargetValid(mc: MissileComponent): boolean {
    if (mc.targetEntityId < 0) return false;
    const target = this.entityManager.getEntity(mc.targetEntityId);
    if (!target) return false;
    const stats = target.getComponent<StatsComponent>(ComponentType.UnitStats);
    return (
      stats?.alive === true &&
      this.transformStore.indexOf(mc.targetEntityId) !== -1
    );
  }

  /**
   * Deterministic nearest-hostile selection from a spatial-grid query around the
   * missile. Mirrors the volley hook's eligibility filter (alive, hostile, typed
   * unit with a transform); ties are broken by ascending entity id. Returns -1
   * when no hostile is within {@link MISSILE_RETARGET_RANGE}.
   */
  private findNearestHostile(missile: MissileEntity, tIdx: number): number {
    const physics = this.physics as PhysicsWorld | undefined;
    if (!physics) return -1;

    const team = missile.getComponent<TeamComponent>(ComponentType.Team);
    if (!team) return -1;

    const mx = FP.FromRaw(this.transformStore.arrays.fpPositionX[tIdx]);
    const mz = FP.FromRaw(this.transformStore.arrays.fpPositionZ[tIdx]);
    const nearby = physics.spatialGrid.queryRadius(mx, mz, FP_RETARGET_RANGE);

    let bestId = -1;
    let bestD2: FixedPoint | null = null;
    for (const id of nearby) {
      if (id === missile.id) continue;
      const entity = this.entityManager.getEntity(id);
      if (!entity) continue;

      const stats = entity.getComponent<StatsComponent>(
        ComponentType.UnitStats
      );
      const otherTeam = entity.getComponent<TeamComponent>(ComponentType.Team);
      if (!stats?.alive || !otherTeam || otherTeam.teamId === team.teamId)
        continue;
      if (!entity.hasComponent(ComponentType.UnitType)) continue;

      const ttIdx = this.transformStore.indexOf(id);
      if (ttIdx === -1) continue;

      const dx = FP.Sub(
        FP.FromRaw(this.transformStore.arrays.fpPositionX[ttIdx]),
        mx
      );
      const dz = FP.Sub(
        FP.FromRaw(this.transformStore.arrays.fpPositionZ[ttIdx]),
        mz
      );
      const d2 = FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz));
      if (
        bestD2 === null ||
        FP.Lt(d2, bestD2) ||
        (FP.Eq(d2, bestD2) && id < bestId)
      ) {
        bestD2 = d2;
        bestId = id;
      }
    }
    return bestId;
  }
}
