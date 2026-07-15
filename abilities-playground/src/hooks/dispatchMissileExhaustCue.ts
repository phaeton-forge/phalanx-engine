import {
  gameplayCueKey,
  type GameplayCueDispatchedEvent,
} from '@phalanx-engine/abilities';
import type { GameWorld } from '@phalanx-engine/ecs';

export const MISSILE_EXHAUST_CUE_ID = 'Cue.Missile.Exhaust';

export function dispatchMissileExhaustCue(
  world: GameWorld,
  missileId: number,
  tick: number,
): void {
  const event: GameplayCueDispatchedEvent = {
    tick,
    cueId: MISSILE_EXHAUST_CUE_ID,
    sourceEntityId: missileId,
    targetEntityId: missileId,
    phase: 'OnApplied',
  };
  world.eventBus.emit(gameplayCueKey(MISSILE_EXHAUST_CUE_ID), event);
}
