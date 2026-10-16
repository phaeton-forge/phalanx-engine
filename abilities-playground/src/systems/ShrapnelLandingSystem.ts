import { GameSystem } from '@phalanx-engine/ecs';
import type { AbilitySystem } from '@phalanx-engine/abilities';
import {
  gameplayCueKey,
  type GameplayCueDispatchedEvent,
} from '@phalanx-engine/abilities';
import { PhysicsWorld } from '@phalanx-engine/physics';
import type { TransformComponent } from '@phalanx-engine/physics';
import { FP, type FixedPoint } from '@phalanx-engine/math';
import {
  ComponentType,
  StatsComponent,
  TeamComponent,
} from '../components';
import { ShrapnelPayloadComponent } from '../components/ShrapnelPayloadComponent';
import type { ShrapnelEntity } from '../entities/Shrapnel';
import { SAU_FRIENDLY_FIRE } from '../config/abilityDefinitions';
import { SAU_GROUND_Y } from '../config/constants';

export const SAU_SECONDARY_IMPACT_CUE_ID = 'Cue.SAU.SecondaryImpact';

const GROUND_Y = FP.FromFloat(SAU_GROUND_Y);

/** A world-space ground landing point. */
export interface GroundLanding {
  x: FixedPoint;
  y: FixedPoint;
  z: FixedPoint;
}

/**
 * Pure swept ground-plane crossing test for a prev→cur segment.
 *
 * Returns the interpolated landing point when the segment crosses `groundY`
 * downward (prevY > groundY && curY <= groundY), else `null`. The lerp
 * denominator (prevY - curY) is strictly positive under that condition, but we
 * still guard it explicitly because `FP.Div` throws on divide-by-zero.
 *
 * TODO(v2): raycast the prev→cur segment against building AABBs first (via
 * PhysicsWorld.raycastSegment) and prefer the nearer of building-hit vs ground.
 */
export function computeGroundLanding(
  prevX: FixedPoint,
  prevY: FixedPoint,
  prevZ: FixedPoint,
  curX: FixedPoint,
  curY: FixedPoint,
  curZ: FixedPoint,
  groundY: FixedPoint = GROUND_Y
): GroundLanding | null {
  if (!(FP.Gt(prevY, groundY) && FP.Lte(curY, groundY))) return null;

  const denom = FP.Sub(prevY, curY);
  if (FP.Eq(denom, FP._0)) {
    // Degenerate (should not happen given the crossing condition) — land at cur.
    return { x: curX, y: groundY, z: curZ };
  }

  const t = FP.Div(FP.Sub(prevY, groundY), denom);
  return {
    x: FP.Lerp(prevX, curX, t),
    y: groundY,
    z: FP.Lerp(prevZ, curZ, t),
  };
}

/**
 * ShrapnelLandingSystem — resolves shrapnel fragments when they hit the ground.
 *
 * Runs after physicsSystem (which integrated this tick's position). For each
 * fragment it sweeps its previous→current position for a ground-plane crossing;
 * on landing it applies the secondary AoE (enemy-only by default) around the
 * exact landing point, emits the secondary-impact cue, and returns the fragment
 * to the pool. The secondary is resolved from the original firing unit's id, so
 * it still lands even if that unit has since died (applyEffect only needs the
 * source id for attribution, not a live entity).
 *
 * v1 lands on the ground plane only; there is no building-AABB infrastructure in
 * the playground yet — see {@link computeGroundLanding} for the v2 extension.
 */
export class ShrapnelLandingSystem extends GameSystem {
  private get _abilities(): AbilitySystem | undefined {
    return this.abilities as AbilitySystem | undefined;
  }

  public override processTick(tick: number): void {
    const physics = this.physics as PhysicsWorld | undefined;
    if (!physics) return;

    const fragments = this.entityManager.queryEntities(
      ComponentType.ShrapnelPayload,
      ComponentType.Transform
    );

    for (const entity of fragments) {
      if ((entity as { active?: boolean }).active === false) continue;

      const payload = entity.getComponent<ShrapnelPayloadComponent>(
        ComponentType.ShrapnelPayload
      );
      const transform = entity.getComponent<TransformComponent>(
        ComponentType.Transform
      );
      if (!payload || !transform || payload.landed) continue;

      const cur = transform.fpPosition;
      const landing = computeGroundLanding(
        payload.prevPosX,
        payload.prevPosY,
        payload.prevPosZ,
        cur.x,
        cur.y,
        cur.z
      );

      if (!landing) {
        // No crossing yet: advance the swept-segment origin for next tick.
        payload.prevPosX = cur.x;
        payload.prevPosY = cur.y;
        payload.prevPosZ = cur.z;
        continue;
      }

      payload.landed = true;
      this.resolveSecondary(payload, landing, physics);
      this.emitCue(SAU_SECONDARY_IMPACT_CUE_ID, entity.id, tick);
      this.pools?.despawn(entity as ShrapnelEntity);
    }
  }

  private resolveSecondary(
    payload: ShrapnelPayloadComponent,
    landing: GroundLanding,
    physics: PhysicsWorld
  ): void {
    const abilities = this._abilities;
    if (!abilities) return;

    const radiusSq = FP.Mul(payload.secondaryRadius, payload.secondaryRadius);
    const nearby = physics.spatialGrid.queryRadius(
      landing.x,
      landing.z,
      payload.secondaryRadius
    );

    for (const id of nearby) {
      const entity = this.entityManager.getEntity(id);
      if (!entity) continue;

      const stats = entity.getComponent<StatsComponent>(
        ComponentType.UnitStats
      );
      if (!stats?.alive) continue;

      const team = entity.getComponent<TeamComponent>(ComponentType.Team);
      if (!SAU_FRIENDLY_FIRE && team && team.teamId === payload.teamId) continue;

      const pos = physics.getEntityPosition(id);
      if (pos) {
        const dx = FP.Sub(pos.x, landing.x);
        const dz = FP.Sub(pos.z, landing.z);
        const d2 = FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz));
        if (FP.Gt(d2, radiusSq)) continue;
      }

      abilities.applyEffect(id, payload.secondaryEffectId, payload.sourceEntityId);
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
