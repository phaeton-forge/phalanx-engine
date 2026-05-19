import type { EffectCueSpec, EffectDef, Modifier } from '../types';

export type EffectDefInput = Omit<EffectDef, 'modifiers'> & {
  modifiers?: Modifier[];
};

export function defineEffect(def: EffectDefInput): EffectDef {
  return {
    ...def,
    modifiers: def.modifiers ? [...def.modifiers] : [],
    tagsGranted: def.tagsGranted ? [...def.tagsGranted] : undefined,
    tagsRequired: def.tagsRequired ? [...def.tagsRequired] : undefined,
    tagsBlocked: def.tagsBlocked ? [...def.tagsBlocked] : undefined,
    cues: cloneEffectCueSpec(def.cues),
  };
}

function cloneEffectCueSpec(
  cues: EffectCueSpec | undefined
): EffectCueSpec | undefined {
  if (!cues) {
    return undefined;
  }
  if (Array.isArray(cues)) {
    return [...cues];
  }
  return {
    onApplied: cues.onApplied ? [...cues.onApplied] : undefined,
    onPeriodic: cues.onPeriodic ? [...cues.onPeriodic] : undefined,
    onExpired: cues.onExpired ? [...cues.onExpired] : undefined,
  };
}
