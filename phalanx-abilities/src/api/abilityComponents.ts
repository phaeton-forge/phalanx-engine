import { ValueComponent } from '@phalanx-engine/ecs';
import type { Entity, GameWorld } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import type { FixedPoint } from '@phalanx-engine/math';
import {
  AbilityOwner,
  AbilityOwnerSlot,
  createAbilityOwnerState,
  type AbilityOwnerState,
} from '../components/abilityOwner.js';
import {
  ActiveEffects,
  createActiveEffectsState,
  type ActiveEffectsState,
} from '../components/activeEffects.js';
import {
  Attributes,
  createAttributesState,
  type AttributesState,
} from '../components/attributes.js';
import {
  GameplayTags,
  createGameplayTagsState,
  type GameplayTagsState,
} from '../components/gameplayTags.js';
import type {
  AbilityOwnerInit,
  AttributeInitializer,
  InitialEffect,
} from '../components/init.js';
import type { AbilitySystemRegistries } from '../registry/index.js';
import { NO_SOURCE_ENTITY_ID } from './AbilitySystemFacade.js';

const OWNED = [AbilityOwner, Attributes, ActiveEffects, GameplayTags] as const;

/**
 * Register the four ability components as module components: the
 * `abilities` save section writes them and the ability pool hook resets
 * them.
 *
 * - `world.addComponent(e, AbilityOwner, init)` attaches all four.
 * - `world.addComponent(e, Attributes, overrides)` sizes and seeds the
 *   attributes from the registry.
 * - `world.removeComponent(e, AbilityOwner)` removes all four; removing one
 *   of the other three while the owner is attached throws.
 */
export function registerAbilityComponents(
  world: GameWorld,
  registries: AbilitySystemRegistries
): void {
  world.registerComponent(AbilityOwner, {
    attach: (entity, init) => attachOwner(entity, registries, init ?? {}),
    remove: (entity) => {
      const had = entity.hasComponent(AbilityOwner.type);
      for (const component of OWNED) entity.removeComponent(component.type);
      return had;
    },
  });
  world.registerComponent(Attributes, {
    attach: (entity, overrides) => {
      assertAbsent(entity, Attributes);
      const attributes = seededAttributes(registries, overrides);
      entity.addComponent(new ValueComponent(Attributes.type, attributes));
    },
    remove: (entity) => removeUnlessOwned(entity, Attributes),
  });
  world.registerComponent(ActiveEffects, {
    remove: (entity) => removeUnlessOwned(entity, ActiveEffects),
  });
  world.registerComponent(GameplayTags, {
    remove: (entity) => removeUnlessOwned(entity, GameplayTags),
  });
}

function attachOwner(
  entity: Entity,
  registries: AbilitySystemRegistries,
  init: AbilityOwnerInit
): void {
  for (const component of OWNED) assertAbsent(entity, component);
  const owner = createAbilityOwnerState();
  const attributes = seededAttributes(registries, init.attributes);
  const effects = createActiveEffectsState();
  const tags = createGameplayTagsState();
  seedAbilities(registries, owner, init.abilities);
  seedTags(tags, init.tags);
  seedEffects(registries, effects, init.effects);
  const slot = new AbilityOwnerSlot(owner);
  // Capture before any snapshot can replace pendingAdd. A restored live
  // pooled entity is built by its factory and then overwritten; the later
  // pool return must reseed these factory effects, not the snapshot.
  slot.captureInitialPending(effects);
  entity.addComponent(slot);
  entity.addComponent(new ValueComponent(Attributes.type, attributes));
  entity.addComponent(new ValueComponent(ActiveEffects.type, effects));
  entity.addComponent(new ValueComponent(GameplayTags.type, tags));
}

function assertAbsent(
  entity: Entity,
  component: { readonly name: string; readonly type: symbol }
): void {
  if (entity.hasComponent(component.type)) {
    throw new Error(
      `world.addComponent: entity ${String(entity.id)} already has '${component.name}'`
    );
  }
}

function removeUnlessOwned(
  entity: Entity,
  component: { readonly name: string; readonly type: symbol }
): boolean {
  if (entity.hasComponent(AbilityOwner.type)) {
    throw new Error(
      `world.removeComponent: cannot remove '${component.name}' from entity ${String(entity.id)} while 'AbilityOwner' is attached; remove AbilityOwner instead`
    );
  }
  return entity.removeComponent(component.type);
}

/** Registry defaults, all dirty so aggregation clamps them, then overrides. */
function seededAttributes(
  registries: AbilitySystemRegistries,
  overrides: Record<string, AttributeInitializer> | undefined
): AttributesState {
  const attributes = createAttributesState(registries.attributes.size);
  const defs = registries.attributes.values();
  for (let index = 0; index < defs.length; index++) {
    const rawDefault = FP.ToRaw(defs[index].default);
    attributes.base[index] = rawDefault;
    attributes.current[index] = rawDefault;
    attributes.dirty[index] = 1;
  }
  if (!overrides) {
    return attributes;
  }
  for (const [attributeId, value] of Object.entries(overrides)) {
    const index = registries.attributes.indexOf(attributeId);
    const base = isAttributeValuePair(value) ? value.base : value;
    const current = isAttributeValuePair(value)
      ? (value.current ?? value.base)
      : value;
    attributes.base[index] = FP.ToRaw(base);
    attributes.current[index] = FP.ToRaw(current);
    attributes.dirty[index] = 1;
  }
  return attributes;
}

function seedAbilities(
  registries: AbilitySystemRegistries,
  owner: AbilityOwnerState,
  abilities: readonly string[] | undefined
): void {
  for (const abilityId of abilities ?? []) {
    if (!registries.abilities.has(abilityId)) {
      throw new Error(`AbilityRegistry does not contain '${abilityId}'`);
    }
    owner.abilities.add(abilityId);
  }
}

function seedTags(
  gameplayTags: GameplayTagsState,
  tags: readonly string[] | undefined
): void {
  for (const tag of tags ?? []) {
    gameplayTags.adHocTags.add(tag);
    gameplayTags.tags.add(tag);
  }
}

function seedEffects(
  registries: AbilitySystemRegistries,
  activeEffects: ActiveEffectsState,
  effects: readonly (string | InitialEffect)[] | undefined
): void {
  for (const entry of effects ?? []) {
    const effectId = typeof entry === 'string' ? entry : entry.id;
    if (!registries.effects.has(effectId)) {
      throw new Error(`EffectRegistry does not contain '${effectId}'`);
    }
    activeEffects.pendingAdd.push({
      defId: effectId,
      sourceEntityId:
        typeof entry === 'string'
          ? NO_SOURCE_ENTITY_ID
          : (entry.sourceEntityId ?? NO_SOURCE_ENTITY_ID),
      setByCaller: null,
    });
  }
}

function isAttributeValuePair(
  value: AttributeInitializer
): value is { base: FixedPoint; current?: FixedPoint } {
  // FixedPoint also exposes `.base`; exclude it so plain scalars stay scalars.
  return (
    typeof value === 'object' &&
    value !== null &&
    'base' in value &&
    !('precision' in value)
  );
}
