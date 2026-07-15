import type { TransformComponent } from '@phalanx-engine/physics';
import { PhysicsWorld } from '@phalanx-engine/physics';
import { FP, type FixedPoint } from '@phalanx-engine/math';
import type { AbilityActivationContext } from '@phalanx-engine/abilities';
import { GameWorld } from '@phalanx-engine/ecs';
import {
  ComponentType,
  StatsComponent,
  TeamComponent,
  UnitTypeComponent,
} from '../components';
import { MissileEntity } from '../entities/Missile';
import { ROCKET_MAX_TARGETS } from '../config/abilityDefinitions';
import { dispatchMissileExhaustCue } from './dispatchMissileExhaustCue';

/**
 * Missile volley activation hook.
 *
 * The {@link MissileLauncherSystem} only decides *when* to fire (off cooldown +
 * an enemy in detection range) and commits the cast via
 * `activateAbility('Ability.MissileVolley')`. Because phalanx-abilities blocks
 * same-tick re-activations of a single ability (see
 * `AbilityActivationSystem.inFlightTagsByCaster`), a multi-target volley cannot
 * be expressed as N activations — so the full target acquisition lives here.
 *
 * This mirrors the SKILL.md guidance that AoE / multi-target selection is
 * user-side: the hook queries the spatial grid, picks the nearest enemies, and
 * spawns one homing missile per target.
 */
export const missileVolley = (
  ctx: AbilityActivationContext,
  world: GameWorld
): void => {
  const caster = world.entityManager.getEntity(ctx.casterEntityId);
  if (!caster) {
    console.error(
      `MissileVolley caster entity not found: ${ctx.casterEntityId}`
    );
    return;
  }

  const team = caster.getComponent<TeamComponent>(ComponentType.Team);
  const transform = caster.getComponent<TransformComponent>(
    ComponentType.Transform
  );
  const unitType = caster.getComponent<UnitTypeComponent>(
    ComponentType.UnitType
  );
  if (!team || !transform || !unitType) return;

  const physics = world.context.physics as PhysicsWorld | undefined;
  if (!physics || !world.pools) return;

  const origin = transform.fpPosition;
  const nearby = physics.spatialGrid.queryRadius(
    origin.x,
    origin.z,
    unitType.detectionRadius
  );
  const targets = pickNearestEnemies(
    caster.id,
    team.teamId,
    origin.x,
    origin.z,
    nearby,
    ROCKET_MAX_TARGETS,
    world
  );

  for (let i = 0; i < targets.length; i++) {
    const missile = world.pools.spawn<MissileEntity>('missile', {
      fpPosition: origin,
      targetEntityId: targets[i],
      teamId: team.teamId,
      volleyIndex: i,
      volleyCount: targets.length,
      launcherRotation: transform.fpRotation,
    });
    dispatchMissileExhaustCue(world, missile.id, ctx.tick);
  }
};

/**
 * Deterministic nearest-enemy selection: filters the spatial-grid result to
 * alive, hostile, typed units, sorts by squared XZ distance (ties broken by
 * ascending entity id), and returns up to `max` ids. Pure function of its
 * inputs — lockstep-safe.
 */
function pickNearestEnemies(
  selfId: number,
  selfTeam: number,
  cx: FixedPoint,
  cz: FixedPoint,
  nearbyIds: readonly number[],
  max: number,
  world: GameWorld
): number[] {
  const candidates: { id: number; d2: FixedPoint }[] = [];
  for (const id of nearbyIds) {
    if (id === selfId) continue;
    const entity = world.entityManager.getEntity(id);
    if (!entity) continue;

    const stats = entity.getComponent<StatsComponent>(ComponentType.UnitStats);
    const team = entity.getComponent<TeamComponent>(ComponentType.Team);
    if (!stats?.alive || !team || team.teamId === selfTeam) continue;
    if (!entity.hasComponent(ComponentType.UnitType)) continue;

    const targetTransform = entity.getComponent<TransformComponent>(
      ComponentType.Transform
    );
    if (!targetTransform) continue;

    const dx = FP.Sub(targetTransform.fpPosition.x, cx);
    const dz = FP.Sub(targetTransform.fpPosition.z, cz);
    candidates.push({ id, d2: FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz)) });
  }

  candidates.sort((a, b) =>
    FP.Lt(a.d2, b.d2) ? -1 : FP.Gt(a.d2, b.d2) ? 1 : a.id - b.id
  );
  return candidates.slice(0, max).map((c) => c.id);
}
