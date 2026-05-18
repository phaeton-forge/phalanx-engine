import type { IComponent } from 'phalanx-ecs';
import type { TargetSpec } from '../types';
import { AbilitiesComponentType } from './AbilitiesComponentType';

/**
 * Marks an entity as a persistent ability "zone" — the auras of GAS.
 *
 * An aura is a long-lived entity, distinct from the caster, that re-resolves
 * a {@link TargetSpec} every {@link periodTicks} and applies its
 * {@link effectIds} to the resolved targets. The plan's "healing aura"
 * recipe is the canonical use case: caster spawns a zone entity, attaches
 * this component plus a `Duration` effect that grants the lifetime tag, and
 * lets {@link AuraTickSystem} drive the rest.
 *
 * Lifecycle model: aura lifetime is decoupled from this component. The
 * caster (or a facade helper) attaches a `Duration`-typed effect with
 * `tagsGranted: [lifetimeTag]` to the zone entity. While the tag is present
 * the zone keeps ticking. When the tag is revoked — either because the
 * Duration effect expired or because user code called
 * `removeEffectsByTag(zoneId, lifetimeTag)` — `AuraTickSystem` despawns the
 * zone entity at the start of the next tick. Coupling the lifetime to a tag
 * (rather than an internal `lifetimeTicks` counter on this component) means
 * the same tooling that manages debuffs and cooldowns manages auras: the
 * user can extend an aura by re-applying the duration effect, force-end it
 * with `removeEffectsByTag`, or query "is this aura still active" with
 * `hasTag`.
 *
 * Field invariants (enforced by {@link AuraTickSystem}; user code mutating
 * the component directly must preserve them):
 *  - {@link periodTicks} ≥ 1. A zero or negative period would spin forever.
 *  - {@link nextTick} is the tick on which the aura will fire next. The
 *    facade helper that spawns the aura initialises it to `currentTick + 1`
 *    so the aura fires on the tick after creation (matching the
 *    `pendingAdd` convention), then increments by `periodTicks` per fire.
 *  - {@link target} is most commonly a `Radius` spec whose origin is
 *    `{ kind: 'TargetEntity', entityId: <zoneEntityId> }` — i.e. the aura
 *    centres on its own entity. `Self`/`Entity`/`Point` are legal but
 *    unusual for auras.
 *  - {@link effectIds} entries must reference `Instant`-type effects.
 *    `Duration`/`Periodic` effects re-applied every period would compound
 *    their queue entries — the resolver does not deduplicate. Application
 *    time does not check the type (consistent with how `applyEffect`
 *    behaves elsewhere); recipes in the README enforce the rule.
 */
export class AuraComponent implements IComponent {
  public readonly type = AbilitiesComponentType.Aura;

  /**
   * @param abilityId Ability that spawned this aura. Stored for tracing /
   *   cue attribution; the system itself does not read it.
   * @param target Target spec evaluated every period. Most auras pass a
   *   `Radius` with origin `TargetEntity` pointing at the zone entity.
   * @param effectIds Instant effects applied to every resolved target each
   *   period, in array order. FIFO ordering is preserved within a single
   *   period; cross-period ordering is governed by `instanceId`.
   * @param periodTicks Number of ticks between fires. Must be ≥ 1.
   * @param nextTick First tick on which the aura should fire.
   * @param ownerEntityId Caster of the aura — passed as `sourceEntityId`
   *   when applying effects so user damage pipelines can credit the
   *   originator. Use `NO_SOURCE_ENTITY_ID` for environmental hazards.
   * @param lifetimeTag Optional tag whose presence on this zone entity
   *   keeps it alive. When the tag is missing at the start of an aura
   *   tick, `AuraTickSystem` despawns the zone. Omit (or pass `undefined`)
   *   to make the aura persist until the entity is removed by user code.
   *
   * Activation gates (Stage 7.1):
   *  - {@link isActive} is an imperative on/off switch. While `false`, the
   *    aura skips its period check entirely — `nextTick` is NOT advanced,
   *    so toggling back to `true` resumes the original cadence without
   *    "catching up" missed fires. Intended for player-controlled toggles
   *    (channeled auras, click-to-toggle abilities, charge-based systems).
   *    Use {@link AbilitySystemFacade.setAuraActive} rather than mutating
   *    this field directly so the optional schedule reset is handled
   *    consistently.
   *  - {@link requiredTag} is a declarative gate. If set, the aura fires
   *    only while the carrier entity has that gameplay tag. Designed for
   *    data-driven suppression — "silenced" / "polymorphed" / "inside
   *    anti-magic field" effects can grant a counter-tag, or the aura's
   *    own activation can be driven by a status effect that grants the
   *    required tag. Multiple suppression sources naturally compose
   *    because tags are sets, not booleans, and the engine's existing
   *    tag tooling (`addTag`, `removeTag`, effect-driven grants) Just
   *    Works.
   *
   * The two gates compose: an aura fires only when **both**
   * `isActive === true` AND (`requiredTag === undefined` OR the carrier
   * has the tag). Both gates pause cadence rather than reset it — see
   * {@link AuraTickSystem} for the exact ordering relative to the
   * lifecycle check.
   *
   * @param options Optional fields. Pass `{ isActive: false }` to spawn
   *   a dormant aura (it will sit on the entity but not fire until
   *   `setAuraActive(entityId, true)` is called). Pass `requiredTag` to
   *   gate fires on a gameplay tag.
   */
  public constructor(
    public readonly abilityId: string,
    public readonly target: TargetSpec,
    public readonly effectIds: readonly string[],
    public readonly periodTicks: number,
    public nextTick: number,
    public readonly ownerEntityId: number,
    public readonly lifetimeTag?: string,
    options?: {
      readonly isActive?: boolean;
      readonly requiredTag?: string;
    }
  ) {
    if (!Number.isInteger(periodTicks) || periodTicks < 1) {
      throw new Error(
        `AuraComponent.periodTicks must be a positive integer, got ${periodTicks}`
      );
    }
    if (!Number.isInteger(nextTick)) {
      throw new Error(`AuraComponent.nextTick must be an integer, got ${nextTick}`);
    }
    if (effectIds.length === 0) {
      // An aura with no effects is a misconfiguration: it would consume a
      // re-resolve every period and produce no observable side effect.
      // Reject up front so the bug surfaces at spawn time.
      throw new Error(`AuraComponent.effectIds must be non-empty (abilityId='${abilityId}')`);
    }
    if (options?.requiredTag !== undefined && options.requiredTag.length === 0) {
      // An empty string would never match any real gameplay tag, leaving
      // the aura permanently dormant. Surface the misconfiguration
      // instead of silently disabling the aura.
      throw new Error(
        `AuraComponent.requiredTag must be a non-empty string when provided ` +
          `(abilityId='${abilityId}')`
      );
    }
    this.isActive = options?.isActive ?? true;
    this.requiredTag = options?.requiredTag;
  }

  /**
   * Imperative activation flag. Mutated through
   * {@link AbilitySystemFacade.setAuraActive}. Defaults to `true`.
   */
  public isActive: boolean;

  /**
   * Optional gameplay tag whose presence on the carrier entity gates
   * firing. `undefined` means "no tag gate" (the legacy behaviour).
   * Tag identity is established at construction time and never changes
   * — use {@link addTag} / {@link removeTag} on the carrier to control
   * activation, not mutation of this field.
   */
  public readonly requiredTag: string | undefined;
}
