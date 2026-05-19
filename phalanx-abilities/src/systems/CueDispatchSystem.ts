import { GameSystem } from 'phalanx-ecs';
import { GAMEPLAY_CUE_EVENT, gameplayCueKey } from '../events';
import type { AbilitySystemRuntime } from '../runtime';

/**
 * Mirrors deterministic gameplay cue events from the runtime buffer to the
 * local world EventBus.
 *
 * Register this only in client worlds after simulation/aggregation systems and
 * before {@link CueBufferCleanupSystem}. EventBus listeners are for local
 * VFX/SFX/UI/debug side effects only; they must not mutate deterministic
 * gameplay state.
 */
export class CueDispatchSystem extends GameSystem {
  public constructor(private readonly runtime: AbilitySystemRuntime) {
    super();
  }

  public override processTick(_tick: number): void {
    const events = this.runtime.gameplayCueBuffer.events;
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      this.eventBus.emit(GAMEPLAY_CUE_EVENT, event);
      this.eventBus.emit(gameplayCueKey(event.cueId), event);
    }
  }
}
