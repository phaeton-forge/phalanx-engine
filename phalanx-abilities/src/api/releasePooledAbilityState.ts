import type { Entity } from '@phalanx-engine/ecs';
import {
  AbilityOwner,
  abilityOwnerOf,
  abilityOwnerSlotOf,
  attributesOf,
  gameplayTagsOf,
  valueOf,
  type AbilityOwnerState,
} from '../components/abilityOwner.js';
import {
  ActiveEffects,
  type ActiveEffectsState,
} from '../components/activeEffects.js';
import { Attributes, type AttributesState } from '../components/attributes.js';
import {
  GameplayTags,
  type GameplayTagsState,
} from '../components/gameplayTags.js';

const SHELL_ABILITY_OWNER = 1;
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
 * @internal Installed by `createAbilitySystem`. Not a public API.
 *
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
 * Factory `pendingAdd` is captured in `initComponent`, before snapshot
 * effects replace the list on a restored live entity. The call below is
 * then a no-op. A component that was not built that way still captures
 * on the first return to the pool.
 *
 * `createAbilitySystem` registers this on `PoolManager`. The pool fires
 * it on the initial dormant transition, on `despawn`, and when
 * `readPools` parks a restored free entity.
 */
export function releasePooledAbilityState(entity: Entity): void {
  const shell = rememberShell(entity);

  if ((shell.flags & SHELL_ABILITY_OWNER) !== 0) {
    const slot = abilityOwnerSlotOf(entity);
    if (slot !== undefined) {
      slot.captureInitialPending();
      clearEffects(slot.value.activeEffects);
      slot.requestReseed();
      restoreAbility(slot.value, shell);
    }
  } else if (entity.hasComponent(AbilityOwner.type)) {
    entity.removeComponent(AbilityOwner.type);
  }

  if ((shell.flags & SHELL_ACTIVE_EFFECTS) !== 0) {
    const effects = valueOf(entity, ActiveEffects);
    if (effects !== undefined) clearEffects(effects);
  } else if (entity.hasComponent(ActiveEffects.type)) {
    entity.removeComponent(ActiveEffects.type);
  }

  if ((shell.flags & SHELL_ABILITY_OWNER) === 0) {
    if ((shell.flags & SHELL_GAMEPLAY_TAGS) !== 0) {
      const tags = valueOf(entity, GameplayTags);
      if (tags !== undefined && shell.tags !== null)
        restoreTags(tags, shell.tags);
    } else if (entity.hasComponent(GameplayTags.type)) {
      entity.removeComponent(GameplayTags.type);
    }

    if ((shell.flags & SHELL_ATTRIBUTES) !== 0) {
      const attributes = attributesOf(entity);
      if (attributes !== undefined && shell.attributes !== null) {
        restoreAttributes(attributes, shell.attributes);
      }
    } else if (entity.hasComponent(Attributes.type)) {
      entity.removeComponent(Attributes.type);
    }
  }
}

function rememberShell(entity: Entity): ShellImage {
  const remembered = shellByEntity.get(entity);
  if (remembered !== undefined) return remembered;
  let flags = 0;
  if (entity.hasComponent(AbilityOwner.type)) {
    flags |= SHELL_ABILITY_OWNER;
  }
  if (entity.hasComponent(Attributes.type)) {
    flags |= SHELL_ATTRIBUTES;
  }
  if (entity.hasComponent(ActiveEffects.type)) {
    flags |= SHELL_ACTIVE_EFFECTS;
  }
  if (entity.hasComponent(GameplayTags.type)) {
    flags |= SHELL_GAMEPLAY_TAGS;
  }
  const ability =
    (flags & SHELL_ABILITY_OWNER) !== 0 ? abilityOwnerOf(entity) : undefined;
  const attributes =
    ability?.attributes ??
    ((flags & SHELL_ATTRIBUTES) !== 0 ? attributesOf(entity) : undefined);
  const tags =
    ability?.tags ??
    ((flags & SHELL_GAMEPLAY_TAGS) !== 0 ? gameplayTagsOf(entity) : undefined);
  const image: ShellImage = {
    flags,
    attributes: attributes === undefined ? null : captureAttributes(attributes),
    abilities: ability === undefined ? null : [...ability.abilities],
    tags: tags === undefined ? null : captureTags(tags),
  };
  shellByEntity.set(entity, image);
  return image;
}

function restoreAbility(ability: AbilityOwnerState, shell: ShellImage): void {
  if (shell.attributes !== null) {
    restoreAttributes(ability.attributes, shell.attributes);
  }
  if (shell.abilities !== null) {
    ability.abilities.clear();
    for (const id of shell.abilities) ability.abilities.add(id);
  }
  if (shell.tags !== null) restoreTags(ability.tags, shell.tags);
}

function captureAttributes(attributes: AttributesState): AttributeImage {
  return {
    base: attributes.base.slice(),
    current: attributes.current.slice(),
    dirty: attributes.dirty.slice(),
  };
}

function restoreAttributes(
  attributes: AttributesState,
  image: AttributeImage
): void {
  attributes.base.set(image.base);
  attributes.current.set(image.current);
  attributes.dirty.set(image.dirty);
}

function captureTags(tags: GameplayTagsState): TagImage {
  return {
    adHoc: [...tags.adHocTags],
    grants: [...tags.effectGrantCounts],
  };
}

function restoreTags(tags: GameplayTagsState, image: TagImage): void {
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

function clearEffects(effects: ActiveEffectsState): void {
  effects.queue.length = 0;
  effects.pendingAdd.length = 0;
}
