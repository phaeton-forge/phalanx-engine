import type { IComponent } from '@phalanx-engine/ecs';
import { AbilitiesComponentType } from './AbilitiesComponentType';

/**
 * Hierarchical gameplay tags attached to an entity.
 *
 * Tags are opaque dotted strings (e.g. `State.Buff.Speed`,
 * `Cooldown.Ability.AutoAttack`). String equality is the only operation:
 * hierarchy is interpretation, not enforced storage. This keeps tag checks
 * branch-free `Set.has(...)` lookups on the hot path.
 *
 * Two ownership sources contribute to {@link tags}:
 *  - **Ad-hoc**: tags added via `AbilitySystemFacade.addTag`. Tracked in
 *    {@link adHocTags}.
 *  - **Effect-granted**: tags granted by an active effect via its
 *    `tagsGranted` field. Tracked via reference counts in
 *    {@link effectGrantCounts} — a tag stays granted while at least one
 *    active effect grants it.
 *
 * A tag is present in {@link tags} iff at least one of those sources still
 * owns it. This separation lets `removeTag` clear ad-hoc ownership without
 * dropping an effect's still-granted tag, and lets effect expiry revoke a
 * grant without dropping a tag that was also added ad hoc.
 *
 * Tags are mutated only by the ability systems (`EffectApplicationSystem`,
 * `EffectTickSystem`) or by `AbilitySystemFacade.addTag`/`removeTag`. User
 * code must not mutate any of these fields directly.
 */
export class GameplayTagsComponent implements IComponent {
  public readonly type = AbilitiesComponentType.GameplayTags;
  /**
   * Read-only union of {@link adHocTags} and all tags currently held by an
   * active effect grant (i.e. effectGrantCounts.get(tag) > 0). Maintained
   * incrementally by the systems and facade so lookups stay O(1) on the hot
   * path. Treat as read-only outside the abilities package.
   */
  public readonly tags = new Set<string>();
  /** Tags added manually by `AbilitySystemFacade.addTag`. */
  public readonly adHocTags = new Set<string>();
  /**
   * Per-tag count of active effect grants. Incremented by
   * `EffectApplicationSystem` when an effect's `tagsGranted` entry is
   * applied; decremented by `EffectTickSystem` when that effect expires.
   * When the count drops to zero AND the tag is not in {@link adHocTags},
   * the tag is removed from {@link tags}.
   */
  public readonly effectGrantCounts = new Map<string, number>();
}
