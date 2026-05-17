import type { EffectDef, Modifier } from '../types';

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
    cues: def.cues ? [...def.cues] : undefined,
  };
}
