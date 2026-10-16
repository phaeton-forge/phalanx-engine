import { GameSystem } from '@phalanx-engine/ecs';
import type { AbilitySystem } from '@phalanx-engine/abilities';
import {
  gameplayCueKey,
  type GameplayCueDispatchedEvent,
} from '@phalanx-engine/abilities';
import { PhysicsWorld } from '@phalanx-engine/physics';
import { FP, type FixedPoint } from '@phalanx-engine/math';
import {
  ComponentType,
  StatsComponent,
  TeamComponent,
} from '../components';
import { ArtilleryShellComponent } from '../components/ArtilleryShellComponent';
import type { ArtilleryShellEntity } from '../entities/ArtilleryShell';
import { ShrapnelEntity } from '../entities/Shrapnel';
import { SAU_FRIENDLY_FIRE } from '../config/abilityDefinitions';

export const SAU_IMPACT_CUE_ID = 'Cue.SAU.Impact';
export const SAU_FALLING_SHADOW_CUE_ID = 'Cue.SAU.FallingShadow';

/** Ticks before detonation that the falling-shadow warning cue is emitted. */
const SAU_SHADOW_LEAD_TICKS = 2;

/**
 * ArtilleryShellSystem — detonates SAU shells and sprays shrapnel.
 *
 * System order (documented): AttackSystem → abilities (Hook.SAU.Fire spawns the
 * shell) → **ArtilleryShellSystem** → GravitySystem → physicsSystem →
 * ShrapnelLandingSystem. Running before GravitySystem/physicsSystem means
 * shrapnel spawned this tick gets its first gravity + integration step in the
 * same tick it is born.
 *
 * On the detonation tick it applies the primary AoE (enemy-only by default; see
 * {@link SAU_FRIENDLY_FIRE}) around the snapshotted impact point, spawns N
 * gravity-affected shrapnel fragments along a deterministic cone (seeded via
 * {@link SystemContext.random} so replays match), emits the impact cue, and returns the
 * shell to the pool. A one-shot falling-shadow cue fires
 * {@link SAU_SHADOW_LEAD_TICKS} ticks earlier.
 */
export class ArtilleryShellSystem extends GameSystem {
  private get _abilities(): AbilitySystem | undefined {
    return this.abilities as AbilitySystem | undefined;
  }

  public override processTick(tick: number): void {
    const physics = this.physics as PhysicsWorld | undefined;
    if (!physics) return;

    const shells = this.entityManager.queryEntities(
      ComponentType.ArtilleryShell
    );

    for (const entity of shells) {
      const shell = entity.getComponent<ArtilleryShellComponent>(
        ComponentType.ArtilleryShell
      );
      if (!shell) continue;
      if ((entity as { active?: boolean }).active === false) continue;

      // One-shot falling-shadow warning ahead of detonation.
      if (
        !shell.shadowEmitted &&
        tick >= shell.detonateTick - SAU_SHADOW_LEAD_TICKS
      ) {
        this.emitCue(SAU_FALLING_SHADOW_CUE_ID, entity.id, tick);
        shell.shadowEmitted = true;
      }

      if (tick < shell.detonateTick) continue;

      this.detonate(entity as ArtilleryShellEntity, shell, physics, tick);
    }
  }

  private detonate(
    entity: ArtilleryShellEntity,
    shell: ArtilleryShellComponent,
    physics: PhysicsWorld,
    tick: number
  ): void {
    const ip = shell.impactPoint;

    // Primary AoE around the impact point.
    this.applyAoE(
      ip.x,
      ip.z,
      shell.primaryRadius,
      shell.teamId,
      shell.primaryEffectId,
      shell.sourceEntityId,
      physics
    );

    this.emitCue(SAU_IMPACT_CUE_ID, entity.id, tick);

    this.spawnShrapnel(shell, physics);

    this.pools?.despawn(entity);
  }

  private spawnShrapnel(
    shell: ArtilleryShellComponent,
    physics: PhysicsWorld
  ): void {
    const pools = this.pools;
    if (!pools) return;

    const { count, cone, speed } = shell.shrapnelConfig;
    const speedF = FP.ToFloat(speed);
    const coneF = FP.ToFloat(cone);
    const rng = this.random;

    for (let i = 0; i < count; i++) {
      const azimuth = rng.floatRange(0, Math.PI * 2);
      const polar = rng.floatRange(0, coneF);

      const sinP = Math.sin(polar);
      const dirX = sinP * Math.cos(azimuth);
      const dirZ = sinP * Math.sin(azimuth);
      const dirY = Math.cos(polar); // mostly upward

      const shrapnel = pools.spawn<ShrapnelEntity>('shrapnel', {
        fpPosition: shell.impactPoint,
        sourceEntityId: shell.sourceEntityId,
        teamId: shell.teamId,
        secondaryEffectId: shell.secondaryEffectId,
        secondaryRadius: shell.secondaryRadius,
      });

      physics.applyImpulse3D(
        shrapnel.id,
        FP.FromFloat(dirX * speedF),
        FP.FromFloat(dirY * speedF),
        FP.FromFloat(dirZ * speedF)
      );
    }
  }

  private applyAoE(
    cx: FixedPoint,
    cz: FixedPoint,
    radius: FixedPoint,
    sourceTeam: number,
    effectId: string,
    sourceEntityId: number,
    physics: PhysicsWorld
  ): void {
    const abilities = this._abilities;
    if (!abilities) return;

    const radiusSq = FP.Mul(radius, radius);
    const nearby = physics.spatialGrid.queryRadius(cx, cz, radius);

    for (const id of nearby) {
      const entity = this.entityManager.getEntity(id);
      if (!entity) continue;

      const stats = entity.getComponent<StatsComponent>(
        ComponentType.UnitStats
      );
      if (!stats?.alive) continue;

      const team = entity.getComponent<TeamComponent>(ComponentType.Team);
      if (!SAU_FRIENDLY_FIRE && team && team.teamId === sourceTeam) continue;

      // queryRadius is grid-cell coarse; confirm the true XZ distance.
      const pos = physics.getEntityPosition(id);
      if (pos) {
        const dx = FP.Sub(pos.x, cx);
        const dz = FP.Sub(pos.z, cz);
        const d2 = FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz));
        if (FP.Gt(d2, radiusSq)) continue;
      }

      abilities.applyEffect(id, effectId, sourceEntityId);
    }
  }

  private emitCue(cueId: string, sourceEntityId: number, tick: number): void {
    const event: GameplayCueDispatchedEvent = {
      tick,
      cueId,
      sourceEntityId,
      targetEntityId: sourceEntityId,
      phase: 'OnApplied',
    };
    this.eventBus.emit(gameplayCueKey(cueId), event);
  }
}
