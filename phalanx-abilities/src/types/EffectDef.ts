import type { CuePhase } from './CueEvent';
import type { Modifier } from './ModifierOp';

export type EffectType = 'Instant' | 'Duration' | 'Periodic';

export interface EffectCues {
  onApplied?: string[];
  onPeriodic?: string[];
  onExpired?: string[];
}

export type EffectCueSpec = EffectCues | string[];

const EMPTY_CUE_IDS: readonly string[] = [];

export interface EffectDef {
  id: string;
  type: EffectType;
  /** Only for Duration and Periodic effects. Stored as whole simulation ticks. */
  durationTicks?: number;
  /** Only for Periodic effects. Stored as whole simulation ticks. */
  periodTicks?: number;
  /** If true, a Periodic effect executes once immediately when applied. */
  executePeriodicOnApplication?: boolean;
  modifiers: Modifier[];
  tagsGranted?: string[];
  tagsRequired?: string[];
  tagsBlocked?: string[];
  cues?: EffectCueSpec;
}

export function getCueIdsForPhase(
  cues: EffectCueSpec | undefined,
  phase: CuePhase
): readonly string[] {
  if (!cues) {
    return EMPTY_CUE_IDS;
  }
  if (Array.isArray(cues)) {
    return phase === 'OnApplied' ? cues : EMPTY_CUE_IDS;
  }
  switch (phase) {
    case 'OnApplied':
      return cues.onApplied ?? EMPTY_CUE_IDS;
    case 'OnPeriodic':
      return cues.onPeriodic ?? EMPTY_CUE_IDS;
    case 'OnExpired':
      return cues.onExpired ?? EMPTY_CUE_IDS;
  }
}
