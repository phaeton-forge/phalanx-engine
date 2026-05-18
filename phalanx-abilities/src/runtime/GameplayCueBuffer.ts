import type { CueEvent } from '../types';

export interface GameplayCueBuffer {
  readonly events: CueEvent[];
}

export function createGameplayCueBuffer(): GameplayCueBuffer {
  return { events: [] };
}
