import { gameplayCueKey } from '@phalanx-engine/abilities';
import type {
  AbilityActivationContext,
  GameplayCueDispatchedEvent,
} from '@phalanx-engine/abilities';
import type { GameWorld } from '@phalanx-engine/ecs';

export const PLASMA_TANK_FIRE_CUE_ID = 'Cue.PlasmaTank.MachineGun.Fire';

/**
 * Hitscan machine-gun attack: damage comes from the ability's targetEffectIds;
 * this hook only dispatches the muzzle-flash/tracer cue.
 */
export const plasmaTankMachineGun = (
  ctx: AbilityActivationContext,
  world: GameWorld
): void => {
  const targetId = ctx.resolvedTargets[0];
  if (targetId === undefined) return;
  const event: GameplayCueDispatchedEvent = {
    tick: ctx.tick,
    cueId: PLASMA_TANK_FIRE_CUE_ID,
    sourceEntityId: ctx.casterEntityId,
    targetEntityId: targetId,
    phase: 'OnApplied',
  };
  world.eventBus.emit(gameplayCueKey(PLASMA_TANK_FIRE_CUE_ID), event);
};
