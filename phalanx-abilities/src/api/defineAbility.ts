import type { AbilityDef } from '../types';

export function defineAbility(def: AbilityDef): AbilityDef {
  return {
    ...def,
    tagsRequired: def.tagsRequired ? [...def.tagsRequired] : undefined,
    activationBlockedTags: def.activationBlockedTags ? [...def.activationBlockedTags] : undefined,
    selfEffectIds: def.selfEffectIds ? [...def.selfEffectIds] : undefined,
    targetEffectIds: def.targetEffectIds ? [...def.targetEffectIds] : undefined,
  };
}
