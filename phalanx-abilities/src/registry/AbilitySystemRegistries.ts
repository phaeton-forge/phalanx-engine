import type { ISpatialQuery } from '../spatial';
import { AbilityHooksRegistry } from './AbilityHooksRegistry';
import { AbilityRegistry } from './AbilityRegistry';
import { AttributeRegistry } from './AttributeRegistry';
import { EffectRegistry } from './EffectRegistry';

/**
 * Bundle of per-world ability-system registries.
 *
 * `attributes`, `effects`, `abilities`, and `hooks` hold *definitions* —
 * immutable across the lifetime of the world once the world has been built.
 *
 * `spatialQuery` is the one optional slot, populated via
 * {@link AbilitySystemFacade.registerSpatialQuery}. It is required only for
 * abilities and `applyEffectAoE` calls that resolve `TargetSpec.kind ===
 * 'Radius'` targets — i.e. abilities that need to ask the world "which
 * entities are inside this disc". Self / Entity / Point targets do not need
 * a spatial query and work without one.
 *
 * Implementations are user-supplied (typically a thin adapter over
 * `SpatialHashGrid` in `phalanx-physics`) so the package stays free of a
 * physics peer dependency.
 */
export interface AbilitySystemRegistries {
  attributes: AttributeRegistry;
  effects: EffectRegistry;
  abilities: AbilityRegistry;
  hooks: AbilityHooksRegistry;
  /**
   * Optional adapter that translates a (center, radius) query into a list of
   * entity ids. Stage 6's Radius targeting and `applyEffectAoE` require it;
   * abilities that only use Self/Entity/Point targets do not. Left
   * `undefined` until `AbilitySystemFacade.registerSpatialQuery` is called.
   */
  spatialQuery?: ISpatialQuery;
}

export function createAbilitySystemRegistries(): AbilitySystemRegistries {
  return {
    attributes: new AttributeRegistry(),
    effects: new EffectRegistry(),
    abilities: new AbilityRegistry(),
    hooks: new AbilityHooksRegistry(),
  };
}
