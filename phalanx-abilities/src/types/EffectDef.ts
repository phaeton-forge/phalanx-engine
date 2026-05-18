import type { Modifier } from './ModifierOp';

export type EffectType = 'Instant' | 'Duration' | 'Periodic';

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
  cues?: string[];
}
