import type { AbilityDef, AttributeDef, EffectDef } from '../types';

export interface AbilitySystemDefinitions {
  attributes: readonly AttributeDef[];
  effects?: readonly EffectDef[];
  abilities?: readonly AbilityDef[];
}

export function defineAbilitySystem(
  definitions: AbilitySystemDefinitions
): AbilitySystemDefinitions {
  return {
    attributes: [...definitions.attributes],
    effects: definitions.effects ? [...definitions.effects] : undefined,
    abilities: definitions.abilities ? [...definitions.abilities] : undefined,
  };
}
