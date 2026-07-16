import type { TransformComponent } from '@phalanx-engine/physics';
import { FP } from '@phalanx-engine/math';
import {
  gameplayCueKey,
  type AbilityActivationContext,
  type GameplayCueDispatchedEvent,
} from '@phalanx-engine/abilities';
import { GameWorld } from '@phalanx-engine/ecs';
import { ComponentType, TeamComponent } from '../components';
import { ArtilleryShellEntity } from '../entities/ArtilleryShell';
import {
  SAU_PRIMARY_RADIUS,
  SAU_SECONDARY_RADIUS,
  SAU_SHRAPNEL_COUNT,
  SAU_MIN_ENGAGEMENT_RANGE,
} from '../config/abilityDefinitions';
import {
  SAU_SHELL_DELAY_TICKS,
  SAU_SHRAPNEL_CONE,
  SAU_SHRAPNEL_SPEED,
} from '../config/constants';

export const SAU_MUZZLE_FLASH_CUE_ID = 'Cue.SAU.MuzzleFlash';

/** Squared minimum engagement range: the SAU ignores enemies closer than this. */
const MIN_ENGAGE_RANGE_SQ = FP.Mul(
  FP.FromFloat(SAU_MIN_ENGAGEMENT_RANGE),
  FP.FromFloat(SAU_MIN_ENGAGEMENT_RANGE)
);

/**
 * SAU artillery fire hook.
 *
 * Snapshots the current target position into a fixed impact point (so the shell
 * lands where the target *was* when fired, independent of later movement),
 * enforces the minimum engagement dead zone, emits the muzzle-flash cue, and
 * spawns a logic-only {@link ArtilleryShellEntity} that detonates after
 * {@link SAU_SHELL_DELAY_TICKS}.
 */
export const sauArtillery = (
  ctx: AbilityActivationContext,
  world: GameWorld
): void => {
  const target = world.entityManager.getEntity(ctx.resolvedTargets[0]);
  const caster = world.entityManager.getEntity(ctx.casterEntityId);
  if (!target || !caster) return;
  if (!world.pools) return;

  const targetTransform = target.getComponent<TransformComponent>(
    ComponentType.Transform
  );
  const casterTransform = caster.getComponent<TransformComponent>(
    ComponentType.Transform
  );
  const casterTeam = caster.getComponent<TeamComponent>(ComponentType.Team);
  if (!targetTransform || !casterTransform || !casterTeam) return;

  const casterPos = casterTransform.fpPosition;
  const targetPos = targetTransform.fpPosition;

  // Dead zone: refuse to fire on enemies inside the minimum engage range.
  const dx = FP.Sub(targetPos.x, casterPos.x);
  const dz = FP.Sub(targetPos.z, casterPos.z);
  const d2 = FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz));
  if (FP.Lt(d2, MIN_ENGAGE_RANGE_SQ)) return;

  // Snapshot the impact point by value — decoupled from later target movement.
  const impactPoint = {
    x: targetPos.x,
    y: targetPos.y,
    z: targetPos.z,
  };

  const muzzleEvent: GameplayCueDispatchedEvent = {
    tick: ctx.tick,
    cueId: SAU_MUZZLE_FLASH_CUE_ID,
    sourceEntityId: caster.id,
    targetEntityId: target.id,
    phase: 'OnApplied',
  };
  world.eventBus.emit(gameplayCueKey(SAU_MUZZLE_FLASH_CUE_ID), muzzleEvent);

  world.pools.spawn<ArtilleryShellEntity>('artilleryShell', {
    impactPoint,
    sourceEntityId: caster.id,
    teamId: casterTeam.teamId,
    detonateTick: ctx.tick + SAU_SHELL_DELAY_TICKS,
    primaryRadius: FP.FromFloat(SAU_PRIMARY_RADIUS),
    primaryEffectId: 'Effect.Damage.SAU.Primary',
    secondaryRadius: FP.FromFloat(SAU_SECONDARY_RADIUS),
    secondaryEffectId: 'Effect.Damage.SAU.Secondary',
    shrapnelConfig: {
      count: SAU_SHRAPNEL_COUNT,
      cone: FP.FromFloat(SAU_SHRAPNEL_CONE),
      speed: FP.FromFloat(SAU_SHRAPNEL_SPEED),
    },
  });
};
