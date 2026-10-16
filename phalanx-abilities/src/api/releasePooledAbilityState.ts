import type { Entity } from '@phalanx-engine/ecs';
import { AbilitiesComponentType } from '../components/AbilitiesComponentType.js';
import type { ActiveEffectsComponent } from '../components/ActiveEffectsComponent.js';
import { getAbilitySystemComponent } from '../components/AbilitySystemComponent.js';
import type { GameplayTagsComponent } from '../components/GameplayTagsComponent.js';

const SHELL_ABILITY_SYSTEM = 1;
const SHELL_ATTRIBUTES = 2;
const SHELL_ACTIVE_EFFECTS = 4;
const SHELL_GAMEPLAY_TAGS = 8;

/**
 * Component flags present the first time this entity returned to the pool.
 *
 * That call is the factory's dormant pass when `createAbilitySystem` is
 * registered before prewarm. The mask is the factory shell. Later calls
 * drop GAS components attached during a life (`applyEffect`, `addTag`,
 * `initAttributesForEntity`) so a dormant bare entity matches the shell
 * `readPools` rebuilds.
 */
const shellFlagsByEntity = new WeakMap<Entity, number>();

/**
 * Drop transient GAS state when a pooled entity returns to the pool.
 *
 * Clears the active-effect queue, `pendingAdd`, the tag set, ad-hoc tags,
 * and effect-grant counts on components that belong to the factory shell.
 * Removes `AbilitySystem`, `Attributes`, `ActiveEffects`, and
 * `GameplayTags` components that were attached after that shell was
 * recorded. Idempotent. The shell mask is stored once per entity object;
 * later calls do not allocate. Safe after `removeEntity`: pool despawn
 * unregisters the entity before hooks run.
 *
 * Attribute values and the equipped ability set stay on a shell
 * component. `onSpawn` must rewrite tags and any attribute values the
 * next life needs. A free-list entity is not in the GAS snapshot, and
 * restore builds a fresh instance then runs this again.
 *
 * `createAbilitySystem` registers this on `PoolManager`. The pool fires
 * it on the initial dormant transition, on `despawn`, and when
 * `readPools` parks a restored free entity.
 */
export function releasePooledAbilityState(entity: Entity): void {
  const shell = rememberShell(entity);

  if ((shell & SHELL_ABILITY_SYSTEM) !== 0) {
    const ability = getAbilitySystemComponent(entity);
    if (ability !== undefined) {
      clearEffects(ability.activeEffects);
      clearTags(ability.tags);
    }
  } else if (entity.hasComponent(AbilitiesComponentType.AbilitySystem)) {
    entity.removeComponent(AbilitiesComponentType.AbilitySystem);
  }

  if ((shell & SHELL_ACTIVE_EFFECTS) !== 0) {
    const effects = entity.getComponent<ActiveEffectsComponent>(
      AbilitiesComponentType.ActiveEffects
    );
    if (effects !== undefined) clearEffects(effects);
  } else if (entity.hasComponent(AbilitiesComponentType.ActiveEffects)) {
    entity.removeComponent(AbilitiesComponentType.ActiveEffects);
  }

  if ((shell & SHELL_GAMEPLAY_TAGS) !== 0) {
    const tags = entity.getComponent<GameplayTagsComponent>(
      AbilitiesComponentType.GameplayTags
    );
    if (tags !== undefined) clearTags(tags);
  } else if (entity.hasComponent(AbilitiesComponentType.GameplayTags)) {
    entity.removeComponent(AbilitiesComponentType.GameplayTags);
  }

  if (
    (shell & SHELL_ATTRIBUTES) === 0 &&
    entity.hasComponent(AbilitiesComponentType.Attributes)
  ) {
    entity.removeComponent(AbilitiesComponentType.Attributes);
  }
}

function rememberShell(entity: Entity): number {
  const remembered = shellFlagsByEntity.get(entity);
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
  shellFlagsByEntity.set(entity, flags);
  return flags;
}

function clearEffects(effects: ActiveEffectsComponent): void {
  effects.queue.length = 0;
  effects.pendingAdd.length = 0;
}

function clearTags(tags: GameplayTagsComponent): void {
  tags.tags.clear();
  tags.adHocTags.clear();
  tags.effectGrantCounts.clear();
}
