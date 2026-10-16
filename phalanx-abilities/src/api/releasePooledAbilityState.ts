import type { Entity } from '@phalanx-engine/ecs';
import { AbilitiesComponentType } from '../components/AbilitiesComponentType.js';
import type { ActiveEffectsComponent } from '../components/ActiveEffectsComponent.js';
import { getAbilitySystemComponent } from '../components/AbilitySystemComponent.js';
import type { GameplayTagsComponent } from '../components/GameplayTagsComponent.js';

/**
 * Drop transient GAS state when a pooled entity returns to the pool.
 *
 * Clears the active-effect queue, `pendingAdd`, the tag set, ad-hoc tags,
 * and effect-grant counts. Idempotent and allocation-free. Safe after
 * `removeEntity`: pool despawn unregisters the entity before hooks run.
 *
 * Attribute values and the equipped ability set stay on the component.
 * `onSpawn` must rewrite tags and any attribute values the next life
 * needs. A free-list entity is not in the GAS snapshot, and restore
 * builds a fresh instance then runs this again.
 *
 * `createAbilitySystem` registers this on `PoolManager`. The pool fires
 * it on the initial dormant transition, on `despawn`, and when
 * `readPools` parks a restored free entity.
 */
export function releasePooledAbilityState(entity: Entity): void {
  const ability = getAbilitySystemComponent(entity);
  if (ability !== undefined) {
    clearEffects(ability.activeEffects);
    clearTags(ability.tags);
  }

  const effects = entity.getComponent<ActiveEffectsComponent>(
    AbilitiesComponentType.ActiveEffects
  );
  if (effects !== undefined && effects !== ability?.activeEffects) {
    clearEffects(effects);
  }

  const tags = entity.getComponent<GameplayTagsComponent>(
    AbilitiesComponentType.GameplayTags
  );
  if (tags !== undefined && tags !== ability?.tags) {
    clearTags(tags);
  }
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
