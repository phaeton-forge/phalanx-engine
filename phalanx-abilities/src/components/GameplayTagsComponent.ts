import type { IComponent } from 'phalanx-ecs';
import { AbilitiesComponentType } from './AbilitiesComponentType';

/**
 * Hierarchical gameplay tags attached to an entity.
 *
 * Tags are opaque dotted strings (e.g. `State.Buff.Speed`,
 * `Cooldown.Ability.AutoAttack`). String equality is the only operation:
 * hierarchy is interpretation, not enforced storage. This keeps tag checks
 * branch-free `Set.has(...)` lookups on the hot path.
 *
 * Tags are mutated only by the ability systems (`EffectApplicationSystem`,
 * `EffectTickSystem`) or by `AbilitySystemFacade.addTag`/`removeTag`. User
 * code must not mutate `tags` directly.
 */
export class GameplayTagsComponent implements IComponent {
  public readonly type = AbilitiesComponentType.GameplayTags;
  public readonly tags = new Set<string>();
}
