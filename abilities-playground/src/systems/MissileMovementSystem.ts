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
import { FP, type FixedPoint } from '@phalanx-engine/math';
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
          this.tickLaunch(mc, tIdx, pIdx);
          break;
        case 'targeting':
          this.tickTargeting(mc, tIdx, pIdx);
          break;
        case 'cruise':
          this.tickCruise(missile, mc, tIdx, pIdx, tick);
          break;
        case 'attack':
          this.tickAttack(missile, mc, tIdx, pIdx, tick);
          break;
      }
    }
  }

  private launchPeakHeight(mc: MissileComponent) {
    return FP.Mul(FP.FromFloat(MISSILE_LAUNCH_HEIGHT), mc.launchHeightScale);
  }

  /** Nose (+Z local) in world space from the missile quaternion (float, matches targeting slerp). */
  private missileForward(mc: MissileComponent): { x: number; y: number; z: number } {
    const { qx, qy, qz, qw } = mc;
    return {
      x: 2 * (qx * qz + qw * qy),
      y: 2 * (qy * qz - qw * qx),
      z: 1 - 2 * (qx * qx + qy * qy),
    };
  }

  private moveAlongForward(
    mc: MissileComponent,
    tIdx: number,
    stepMag: FixedPoint
  ): void {
    const forward = this.missileForward(mc);
    const fLen = Math.hypot(forward.x, forward.y, forward.z);
    if (fLen < 1e-8) return;

    const scale = FP.ToFloat(stepMag) / fLen;
    const mx = FP.FromRaw(this.transformStore.arrays.fpPositionX[tIdx]);
    const my = FP.FromRaw(this.transformStore.arrays.fpPositionY[tIdx]);
    const mz = FP.FromRaw(this.transformStore.arrays.fpPositionZ[tIdx]);

    this.transformStore.arrays.fpPositionX[tIdx] = FP.ToRaw(
      FP.Add(mx, FP.FromFloat(forward.x * scale))
    );
    this.transformStore.arrays.fpPositionY[tIdx] = FP.ToRaw(
      FP.Add(my, FP.FromFloat(forward.y * scale))
    );
    this.transformStore.arrays.fpPositionZ[tIdx] = FP.ToRaw(
      FP.Add(mz, FP.FromFloat(forward.z * scale))
    );
  }

  private tickLaunch(mc: MissileComponent, tIdx: number, pIdx: number): void {
    this.physicsStore.arrays.ignorePhysics[pIdx] = 1;
    this.physicsStore.arrays.velocityX[pIdx] = 0n;
    this.physicsStore.arrays.velocityY[pIdx] = 0n;
    this.physicsStore.arrays.velocityZ[pIdx] = 0n;

    this.moveAlongForward(mc, tIdx, FP_STEP);

    mc.launchTicksRemaining -= 1;
    if (mc.launchTicksRemaining <= 0) mc.phase = 'targeting';
  }

  /** Coast at cruise speed while the targeting system turns the nose toward the target. */
  private tickTargeting(mc: MissileComponent, tIdx: number, pIdx: number): void {
    this.physicsStore.arrays.ignorePhysics[pIdx] = 1;
    this.physicsStore.arrays.velocityX[pIdx] = 0n;
    this.physicsStore.arrays.velocityY[pIdx] = 0n;
    this.physicsStore.arrays.velocityZ[pIdx] = 0n;

    this.moveAlongForward(mc, tIdx, FP_STEP);
  }

  private tickCruise(
    missile: MissileEntity,
    mc: MissileComponent,
    tIdx: number,
    pIdx: number,
    tick: number
  ): void {
    this.physicsStore.arrays.ignorePhysics[pIdx] = 1;
    this.physicsStore.arrays.velocityX[pIdx] = 0n;
    this.physicsStore.arrays.velocityY[pIdx] = 0n;
    this.physicsStore.arrays.velocityZ[pIdx] = 0n;

    // Keep cruise altitude at or above the launch peak (targeting may coast higher).
    const cruiseY = FP.Add(mc.spawnY, this.launchPeakHeight(mc));
    const currentY = FP.FromRaw(this.transformStore.arrays.fpPositionY[tIdx]);
    if (FP.Lt(currentY, cruiseY)) {
      this.transformStore.arrays.fpPositionY[tIdx] = FP.ToRaw(cruiseY);
    }

    // Re-acquire a target if the original was destroyed mid-flight by someone
    // else — the missile retargets the nearest hostile instead of gliding.
    if (!this.isTargetValid(mc)) {
      mc.targetEntityId = this.findNearestHostile(missile, tIdx);
    }

    const ttIdx = this.transformStore.indexOf(mc.targetEntityId);
    if (ttIdx === -1) {
      this.handleSelfDestruct(missile, tick);
      return;
    }

    const mx = FP.FromRaw(this.transformStore.arrays.fpPositionX[tIdx]);
    const mz = FP.FromRaw(this.transformStore.arrays.fpPositionZ[tIdx]);
    const tx = FP.FromRaw(this.transformStore.arrays.fpPositionX[ttIdx]);
    const tz = FP.FromRaw(this.transformStore.arrays.fpPositionZ[ttIdx]);
    const dx = FP.Sub(tx, mx);
    const dz = FP.Sub(tz, mz);
    const distSq = FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz));
    if (FP.Lte(distSq, FP._0)) {
      mc.phase = 'attack';
      this.tickAttack(missile, mc, tIdx, pIdx, tick);
      return;
    }
    const dist = FP.Sqrt(distSq);
    if (FP.Lte(distSq, FP_ATTACK_RANGE_SQ)) {
      mc.phase = 'attack';
      this.tickAttack(missile, mc, tIdx, pIdx, tick);
      return;
    }

    this.transformStore.arrays.fpPositionX[tIdx] = FP.ToRaw(
      FP.Add(mx, FP.Mul(FP.Div(dx, dist), FP_STEP))
    );
    this.transformStore.arrays.fpPositionZ[tIdx] = FP.ToRaw(
      FP.Add(mz, FP.Mul(FP.Div(dz, dist), FP_STEP))
    );
  }

  private tickAttack(
    missile: MissileEntity,
    mc: MissileComponent,
    tIdx: number,
    pIdx: number,
    tick: number
  ): void {
    this.physicsStore.arrays.ignorePhysics[pIdx] = 1;
    this.physicsStore.arrays.velocityX[pIdx] = 0n;
    this.physicsStore.arrays.velocityY[pIdx] = 0n;
    this.physicsStore.arrays.velocityZ[pIdx] = 0n;

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
