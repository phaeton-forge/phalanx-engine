import type { CueEvent } from '../types';

/** Per-event dispatch payload posted to the world EventBus. */
export type GameplayCueDispatchedEvent = CueEvent;

/**
 * Global gameplay cue event key. CueDispatchSystem emits both this key and a
 * cue-specific key from {@link gameplayCueKey} for each buffered cue event.
 */
export const GAMEPLAY_CUE_EVENT = 'phalanx-abilities:GameplayCue';

export function gameplayCueKey(cueId: string): string {
  return `phalanx-abilities:Cue:${cueId}`;
}
