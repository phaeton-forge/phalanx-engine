import type { StateReader, StateWriter } from '@phalanx-engine/ecs';
import { defineComponent, writeSorted } from '@phalanx-engine/ecs';

/**
 * Hierarchical gameplay tags on an entity.
 *
 * Tags are opaque dotted strings (e.g. `State.Buff.Speed`). String equality
 * is the only operation, so tag checks stay `Set.has(...)` lookups.
 *
 * `tags` is the union of `adHocTags` and every tag whose
 * `effectGrantCounts` entry is above zero. `removeTag` clears ad-hoc
 * ownership without dropping a still-granted tag; effect expiry revokes a
 * grant without dropping a tag that was also added ad hoc.
 *
 * Only the ability systems and `AbilitySystemFacade.addTag` / `removeTag`
 * mutate these collections.
 */
export interface GameplayTagsState {
  readonly tags: Set<string>;
  /** Tags added by `AbilitySystemFacade.addTag`. */
  readonly adHocTags: Set<string>;
  /** Active effect grants per tag. */
  readonly effectGrantCounts: Map<string, number>;
}

export function createGameplayTagsState(): GameplayTagsState {
  return {
    tags: new Set<string>(),
    adHocTags: new Set<string>(),
    effectGrantCounts: new Map<string, number>(),
  };
}

/** Tags, ad-hoc tags, then grants, each sorted by UTF-16 code unit. */
export function saveGameplayTags(
  tags: GameplayTagsState,
  w: StateWriter
): void {
  writeSorted<string>(w, tags.tags, (tag, item) => item.str(tag));
  writeSorted<string>(w, tags.adHocTags, (tag, item) => item.str(tag));
  writeSorted<string>(w, tags.effectGrantCounts, (tag, item) => {
    item.str(tag);
    item.varint(tags.effectGrantCounts.get(tag) ?? 0);
  });
}

export function loadGameplayTags(r: StateReader): GameplayTagsState {
  const state = createGameplayTagsState();
  for (const tag of r.list((item) => item.str())) state.tags.add(tag);
  for (const tag of r.list((item) => item.str())) state.adHocTags.add(tag);
  r.list((item) => {
    const tag = item.str();
    state.effectGrantCounts.set(tag, item.varint());
    return tag;
  });
  return state;
}

export const GameplayTags = defineComponent<GameplayTagsState>('GameplayTags', {
  kind: 'object',
  create: createGameplayTagsState,
  save: saveGameplayTags,
  load: loadGameplayTags,
});

export function copyGameplayTags(
  target: GameplayTagsState,
  source: GameplayTagsState
): void {
  target.tags.clear();
  target.adHocTags.clear();
  target.effectGrantCounts.clear();
  source.tags.forEach((tag) => target.tags.add(tag));
  source.adHocTags.forEach((tag) => target.adHocTags.add(tag));
  source.effectGrantCounts.forEach((count, tag) =>
    target.effectGrantCounts.set(tag, count)
  );
}
