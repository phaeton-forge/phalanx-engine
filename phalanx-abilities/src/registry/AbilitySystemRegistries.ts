
import { AbilityHooksRegistry } from './AbilityHooksRegistry';
import { AbilityRegistry } from './AbilityRegistry';
import { AttributeRegistry } from './AttributeRegistry';
import { EffectRegistry } from './EffectRegistry';

/**
 * Bundle of per-world ability-system registries.
 *
 * `attributes`, `effects`, `abilities`, and `hooks` hold *definitions* —
 * immutable across the lifetime of the world once the world has been built.
 */
export interface AbilitySystemRegistries {
  attributes: AttributeRegistry;
  effects: EffectRegistry;
  abilities: AbilityRegistry;
  hooks: AbilityHooksRegistry;
}

export function createAbilitySystemRegistries(): AbilitySystemRegistries {
  return {
    attributes: new AttributeRegistry(),
    effects: new EffectRegistry(),
    abilities: new AbilityRegistry(),
    hooks: new AbilityHooksRegistry(),
  };
}
