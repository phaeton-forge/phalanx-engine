import type { Entity } from '@phalanx-engine/ecs';
import { AbilitiesComponentType } from '../components/AbilitiesComponentType.js';
import type { AbilitySystemComponent } from '../components/AbilitySystemComponent.js';
import type { ActiveEffectsComponent } from '../components/ActiveEffectsComponent.js';
import {
  getAbilitySystemComponent,
  getAttributesComponent,
  getGameplayTagsComponent,
} from '../components/AbilitySystemComponent.js';
import type { AttributesComponent } from '../components/AttributesComponent.js';
import type { GameplayTagsComponent } from '../components/GameplayTagsComponent.js';

const SHELL_ABILITY_SYSTEM = 1;
const SHELL_ATTRIBUTES = 2;
const SHELL_ACTIVE_EFFECTS = 4;
const SHELL_GAMEPLAY_TAGS = 8;

interface AttributeImage {
  readonly base: BigInt64Array;
  readonly current: BigInt64Array;
  readonly dirty: Uint8Array;
}

interface TagImage {
  readonly adHoc: readonly string[];
  readonly grants: readonly (readonly [string, number])[];
}

/**
 * Factory shell recorded on the first return to the pool (the prewarm
 * dormant pass). Later returns copy this image back: attributes, the
 * equipped ability set, and ad-hoc tags / effect grants from construction.
 */
interface ShellImage {
  readonly flags: number;
  readonly attributes: AttributeImage | null;
  readonly abilities: readonly string[] | null;
  readonly tags: TagImage | null;
}

const shellByEntity = new WeakMap<Entity, ShellImage>();

/**
 * Drop transient GAS state when a pooled entity returns to the pool.
 *
 * The first call records the factory shell: attribute `base` / `current` /
 * `dirty`, the equipped ability set, and the tag sets as the factory left
 * them (`initComponent` tags included). Later calls clear the effect queue
 * and `pendingAdd`, then copy that image back. Components attached after
 * the shell (`applyEffect`, `addTag`, standalone attributes) are removed.
 *
 * Idempotent. The image is stored once per entity object; later calls copy
 * into the existing arrays and sets. Safe after `removeEntity`: pool
 * despawn unregisters the entity before hooks run.
 *
 * A free-list entity is not in the GAS snapshot. Restore builds a fresh
 * factory instance and runs this again, so a respawn whose `onSpawn` does
 * not rewrite attributes still matches the restored copy.
 *
 * `createAbilitySystem` registers this on `PoolManager`. The pool fires
 * it on the initial dormant transition, on `despawn`, and when
 * `readPools` parks a restored free entity.
 */
export function releasePooledAbilityState(entity: Entity): void {
  const shell = rememberShell(entity);

  if ((shell.flags & SHELL_ABILITY_SYSTEM) !== 0) {
    const ability = getAbilitySystemComponent(entity);
    if (ability !== undefined) {
      clearEffects(ability.activeEffects);
      restoreAbility(ability, shell);
    }
  } else if (entity.hasComponent(AbilitiesComponentType.AbilitySystem)) {
    entity.removeComponent(AbilitiesComponentType.AbilitySystem);
  }

  if ((shell.flags & SHELL_ACTIVE_EFFECTS) !== 0) {
    const effects = entity.getComponent<ActiveEffectsComponent>(
      AbilitiesComponentType.ActiveEffects
    );
    if (effects !== undefined) clearEffects(effects);
  } else if (entity.hasComponent(AbilitiesComponentType.ActiveEffects)) {
    entity.removeComponent(AbilitiesComponentType.ActiveEffects);
  }

  if ((shell.flags & SHELL_ABILITY_SYSTEM) === 0) {
    if ((shell.flags & SHELL_GAMEPLAY_TAGS) !== 0) {
      const tags = entity.getComponent<GameplayTagsComponent>(
        AbilitiesComponentType.GameplayTags
      );
      if (tags !== undefined && shell.tags !== null)
        restoreTags(tags, shell.tags);
    } else if (entity.hasComponent(AbilitiesComponentType.GameplayTags)) {
      entity.removeComponent(AbilitiesComponentType.GameplayTags);
    }

    if ((shell.flags & SHELL_ATTRIBUTES) !== 0) {
      const attributes = getAttributesComponent(entity);
      if (attributes !== undefined && shell.attributes !== null) {
        restoreAttributes(attributes, shell.attributes);
      }
    } else if (entity.hasComponent(AbilitiesComponentType.Attributes)) {
      entity.removeComponent(AbilitiesComponentType.Attributes);
    }
  }
}

function rememberShell(entity: Entity): ShellImage {
  const remembered = shellByEntity.get(entity);
  if (remembered !== undefined) return remembered;
  let flags = 0;
  if (entity.hasComponent(AbilitiesComponentType.AbilitySystem)) {
    flags |= SHELL_ABILITY_SYSTEM;
  }
  if (entity.hasComponent(AbilitiesComponentType.Attributes)) {
    flags |= SHELL_ATTRIBUTES;
  }
  if (entity.hasComponent(AbilitiesComponentType.ActiveEffects)) {
    flags |= SHELL_ACTIVE_EFFECTS;
  }
  if (entity.hasComponent(AbilitiesComponentType.GameplayTags)) {
    flags |= SHELL_GAMEPLAY_TAGS;
  }
  const ability =
    (flags & SHELL_ABILITY_SYSTEM) !== 0
      ? getAbilitySystemComponent(entity)
      : undefined;
  const attributes =
    ability?.attributes ??
    ((flags & SHELL_ATTRIBUTES) !== 0
      ? getAttributesComponent(entity)
      : undefined);
  const tags =
    ability?.tags ??
    ((flags & SHELL_GAMEPLAY_TAGS) !== 0
      ? getGameplayTagsComponent(entity)
      : undefined);
  const image: ShellImage = {
    flags,
    attributes: attributes === undefined ? null : captureAttributes(attributes),
    abilities: ability === undefined ? null : [...ability.abilities],
    tags: tags === undefined ? null : captureTags(tags),
  };
  shellByEntity.set(entity, image);
  return image;
}

function restoreAbility(
  ability: AbilitySystemComponent,
  shell: ShellImage
): void {
  if (shell.attributes !== null) {
    restoreAttributes(ability.attributes, shell.attributes);
  }
  if (shell.abilities !== null) {
    ability.abilities.clear();
    for (const id of shell.abilities) ability.abilities.add(id);
  }
  if (shell.tags !== null) restoreTags(ability.tags, shell.tags);
}

function captureAttributes(attributes: AttributesComponent): AttributeImage {
  return {
    base: attributes.base.slice(),
    current: attributes.current.slice(),
    dirty: attributes.dirty.slice(),
  };
}

function restoreAttributes(
  attributes: AttributesComponent,
  image: AttributeImage
): void {
  attributes.base.set(image.base);
  attributes.current.set(image.current);
  attributes.dirty.set(image.dirty);
}

function captureTags(tags: GameplayTagsComponent): TagImage {
  return {
    adHoc: [...tags.adHocTags],
    grants: [...tags.effectGrantCounts],
  };
}

function restoreTags(tags: GameplayTagsComponent, image: TagImage): void {
  tags.tags.clear();
  tags.adHocTags.clear();
  tags.effectGrantCounts.clear();
  for (const tag of image.adHoc) {
    tags.adHocTags.add(tag);
    tags.tags.add(tag);
  }
  for (const [tag, count] of image.grants) {
    tags.effectGrantCounts.set(tag, count);
    if (count > 0) tags.tags.add(tag);
  }
}

function clearEffects(effects: ActiveEffectsComponent): void {
  effects.queue.length = 0;
  effects.pendingAdd.length = 0;
}
