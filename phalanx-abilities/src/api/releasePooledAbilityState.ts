import type { Entity } from '@phalanx-engine/ecs';
import {
  AbilityOwner,
  abilityOwnerOf,
  abilityOwnerSlotOf,
  activeEffectsOf,
  attributesOf,
  gameplayTagsOf,
  valueOf,
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
 * them (`AbilityOwner` init tags included). Later calls clear the effect queue
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
 * Factory `pendingAdd` is captured when `AbilityOwner` is attached, before snapshot
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

  const owner = keepOrRemove(entity, shell, SHELL_ABILITY_OWNER, AbilityOwner);
  if (owner !== undefined && shell.abilities !== null) {
    owner.abilities.clear();
    for (const id of shell.abilities) owner.abilities.add(id);
  }

  const effects = keepOrRemove(
    entity,
    shell,
    SHELL_ACTIVE_EFFECTS,
    ActiveEffects
  );
  if (effects !== undefined) {
    const slot = owner === undefined ? undefined : abilityOwnerSlotOf(entity);
    slot?.captureInitialPending(effects);
    clearEffects(effects);
    slot?.requestReseed(effects);
  }

  const tags = keepOrRemove(entity, shell, SHELL_GAMEPLAY_TAGS, GameplayTags);
  if (tags !== undefined && shell.tags !== null) restoreTags(tags, shell.tags);

  const attributes = keepOrRemove(entity, shell, SHELL_ATTRIBUTES, Attributes);
  if (attributes !== undefined && shell.attributes !== null) {
    restoreAttributes(attributes, shell.attributes);
  }
}

/** The value when the shell had `component`; otherwise drop it and return `undefined`. */
function keepOrRemove<T extends object>(
  entity: Entity,
  shell: ShellImage,
  flag: number,
  component: { readonly type: symbol; create(): T }
): T | undefined {
  if ((shell.flags & flag) !== 0) return valueOf(entity, component);
  if (entity.hasComponent(component.type))
    entity.removeComponent(component.type);
  return undefined;
}

function rememberShell(entity: Entity): ShellImage {
  const remembered = shellByEntity.get(entity);
  if (remembered !== undefined) return remembered;
  const owner = abilityOwnerOf(entity);
  const attributes = attributesOf(entity);
  const tags = gameplayTagsOf(entity);
  let flags = 0;
  if (owner !== undefined) flags |= SHELL_ABILITY_OWNER;
  if (attributes !== undefined) flags |= SHELL_ATTRIBUTES;
  if (activeEffectsOf(entity) !== undefined) flags |= SHELL_ACTIVE_EFFECTS;
  if (tags !== undefined) flags |= SHELL_GAMEPLAY_TAGS;
  const image: ShellImage = {
    flags,
    attributes: attributes === undefined ? null : captureAttributes(attributes),
    abilities: owner === undefined ? null : [...owner.abilities],
    tags: tags === undefined ? null : captureTags(tags),
  };
  shellByEntity.set(entity, image);
  return image;
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
