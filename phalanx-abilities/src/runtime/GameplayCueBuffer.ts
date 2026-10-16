import { getCueIdsForPhase } from '../types/index.js';
import type { CueEvent, CuePhase, EffectCueSpec } from '../types/index.js';

export interface GameplayCueBuffer {
  readonly events: CueEvent[];
}

export interface GameplayCueBufferView {
  readonly events: readonly CueEvent[];
}

export function createGameplayCueBuffer(): GameplayCueBuffer {
  return { events: [] };
}

export function appendGameplayCueEvents(
  buffer: GameplayCueBuffer,
  cues: EffectCueSpec | undefined,
  phase: CuePhase,
  tick: number,
  sourceEntityId: number,
  targetEntityId: number
): void {
  const cueIds = getCueIdsForPhase(cues, phase);
  for (const cueId of cueIds) {
    buffer.events.push({
      tick,
      cueId,
      sourceEntityId,
      targetEntityId,
      phase,
    });
  }
}
