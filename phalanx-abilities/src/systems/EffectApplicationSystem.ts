import { GameSystem } from 'phalanx-ecs';
import type { Entity } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import type { FixedPoint } from 'phalanx-math';
import {
  AbilitiesComponentType,
  ActiveEffectsComponent,
  AttributesComponent,
  GameplayTagsComponent,
} from '../components';
import type { PendingEffectAdd } from '../components';
import type { AbilitySystemRegistries } from '../registry';
import { appendGameplayCueEvents } from '../runtime';
import type { AbilitySystemRuntime } from '../runtime';
import type {
  ActiveEffectInstance,
  EffectDef,
  Modifier,
  ModifierOp,
} from '../types';

/**
 * Drains `ActiveEffectsComponent.pendingAdd` per entity and applies each
 * effect deterministically.
 *
 * Per pending entry (in the order they were enqueued by `applyEffect`):
 *  1. Resolve the {@link EffectDef} from the registry.
 *  2. Gate by tag predicates against the target's
 *     {@link GameplayTagsComponent}:
 *      - if `tagsRequired` is set, every tag must be present;
 *      - if `tagsBlocked` is set, none of the tags may be present.
 *     A gated effect is dropped (the cooldown / source-side mechanics are
 *     handled by future stages — Stage 3 only models the application path).
 *  3. Grant `tagsGranted` on the target (idempotent set semantics).
 *  4. For `Instant`:
 *      - apply each modifier directly to the matching attribute's `base`;
 *      - mark that attribute dirty so `AttributeAggregationSystem`
 *        recomputes `current` on the same tick (system order guarantees
 *        application runs before aggregation).
 *  5. For `Duration`:
 *      - allocate a monotonic `instanceId` from the runtime counter;
 *      - push an {@link ActiveEffectInstance} onto `queue` in
 *        `instanceId` ASC order (insertions are monotonic, so append
 *        preserves the invariant that `AttributeAggregationSystem`
 *        relies on);
 *      - mark every attribute referenced by the effect's modifiers dirty.
 *  6. For `Periodic`:
 *      - Same queueing, tag-grant and lifetime-countdown path as `Duration`.
 *      - The per-period payload is applied Instant-style (modifiers fold
 *        into `base`, attributes marked dirty) by {@link EffectTickSystem}
 *        whenever `currentTick >= nextPeriodTick`. `nextPeriodTick` is
 *        initialized to `tick + periodTicks` here.
 *      - When `executePeriodicOnApplication` is true, modifiers also fire
 *        once immediately at apply time (Instant-style on the same tick),
 *        in addition to the regular schedule. The first scheduled firing
 *        still lands one full period later — the apply-time landing is an
 *        extra one-off, mirroring Unreal's GAS semantics.
 *
 * The system itself never *removes* effects — that responsibility belongs
 * to {@link EffectTickSystem}, including expirations from `removeEffectsBy*`
 * helpers (which queue removals into the same pipeline).
 */
export class EffectApplicationSystem extends GameSystem {
  public constructor(
    private readonly registries: AbilitySystemRegistries,
    private readonly runtime: AbilitySystemRuntime
  ) {
    super();
  }

  public override processTick(tick: number): void {
    const entities = this.entityManager.queryEntities(AbilitiesComponentType.ActiveEffects);
    const attributeIndexCache = this.attributeIndexCache;
    attributeIndexCache.clear();

    for (const entity of entities) {
      const activeEffects = entity.getComponent<ActiveEffectsComponent>(
        AbilitiesComponentType.ActiveEffects
      );
      if (!activeEffects || activeEffects.pendingAdd.length === 0) {
        continue;
      }

      // Drain pendingAdd by swapping with a stable empty array so re-entrant
      // applyEffect calls from inside (none today; insurance for the future)
      // accumulate for the next tick.
      const drained = activeEffects.pendingAdd.splice(0, activeEffects.pendingAdd.length);

      for (let i = 0; i < drained.length; i++) {
        this.applyOne(entity, drained[i], attributeIndexCache, tick);
      }
    }
  }

  private readonly attributeIndexCache = new Map<string, number>();

  private applyOne(
    entity: Entity,
    pending: PendingEffectAdd,
    attributeIndexCache: Map<string, number>,
    tick: number
  ): void {
    const effectDef = this.registries.effects.tryGet(pending.defId);
    if (!effectDef) {
      // Misconfigured caller: a defId that isn't registered. Surface loudly so
      // determinism bugs don't hide behind silent drops.
      throw new Error(`EffectRegistry does not contain '${pending.defId}'`);
    }

    const tags = this.getOrCreateTags(entity);

    if (!this.checkTagPredicates(effectDef, tags)) {
      return;
    }

    // Validate everything that can throw BEFORE any visible mutation so a
    // misconfigured effect cannot leave the entity in a half-applied state
    // (e.g. tags granted while the effect itself was rejected). The cost is
    // two extra passes for Duration/Periodic — cheap given typical modifier
    // counts (1-3) and amortized by attributeIndexCache.
    this.validateEffectOrThrow(effectDef, attributeIndexCache);

    // From here on out the effect cannot reject itself, so it is safe to
    // grant tags and queue the instance atomically.
    this.grantTags(effectDef, tags);

    switch (effectDef.type) {
      case 'Instant':
        this.applyInstant(entity, effectDef, attributeIndexCache);
        appendGameplayCueEvents(
          this.runtime.gameplayCueBuffer,
          effectDef.cues,
          'OnApplied',
          tick,
          pending.sourceEntityId,
          entity.id
        );
        return;
      case 'Duration':
      case 'Periodic':
        this.queueDurational(entity, effectDef, pending, attributeIndexCache, tick);
        appendGameplayCueEvents(
          this.runtime.gameplayCueBuffer,
          effectDef.cues,
          'OnApplied',
          tick,
          pending.sourceEntityId,
          entity.id
        );
        // Periodic with executePeriodicOnApplication: fire the payload once
        // at apply time. Instance was queued above so the lifetime countdown
        // and subsequent periodic firings keep working. Determinism is
        // preserved because the queueing path allocated the FIFO instanceId
        // before we mutate base, so aggregation on the same tick observes
        // ordering identical to a freshly-applied Instant.
        if (
          effectDef.type === 'Periodic' &&
          effectDef.executePeriodicOnApplication === true
        ) {
          this.applyInstant(entity, effectDef, attributeIndexCache);
          appendGameplayCueEvents(
            this.runtime.gameplayCueBuffer,
            effectDef.cues,
            'OnPeriodic',
            tick,
            pending.sourceEntityId,
            entity.id
          );
        }
        return;
    }
  }

  /**
   * Pre-flight validation for the slow paths that can throw at apply time.
   * Currently catches:
   *  - Duration/Periodic with missing or non-positive `durationTicks`.
   *  - Modifiers that reference an attribute id not registered with this world.
   *
   * Throws on any inconsistency; otherwise returns silently. Populates
   * `attributeIndexCache` as a side-effect so the subsequent apply path does
   * not re-resolve indices.
   */
  private validateEffectOrThrow(
    effectDef: EffectDef,
    attributeIndexCache: Map<string, number>
  ): void {
    if (effectDef.type === 'Duration' || effectDef.type === 'Periodic') {
      const durationTicks = effectDef.durationTicks;
      if (durationTicks === undefined || durationTicks <= 0) {
        throw new Error(
          `EffectDef '${effectDef.id}' is type '${effectDef.type}' but has invalid durationTicks=${String(durationTicks)}`
        );
      }
    }
    if (effectDef.type === 'Periodic') {
      const periodTicks = effectDef.periodTicks;
      if (periodTicks === undefined || periodTicks <= 0) {
        throw new Error(
          `EffectDef '${effectDef.id}' is type 'Periodic' but has invalid periodTicks=${String(periodTicks)}`
        );
      }
    }
    // Pre-resolve modifier attribute indices so registry.indexOf failures
    // surface here, not after tag grants. Cached resolutions are reused.
    for (const modifier of effectDef.modifiers) {
      this.resolveAttributeIndex(modifier.attributeId, attributeIndexCache);
    }
  }

  private checkTagPredicates(effectDef: EffectDef, tags: GameplayTagsComponent): boolean {
    if (effectDef.tagsRequired) {
      for (const tag of effectDef.tagsRequired) {
        if (!tags.tags.has(tag)) {
          return false;
        }
      }
    }
    if (effectDef.tagsBlocked) {
      for (const tag of effectDef.tagsBlocked) {
        if (tags.tags.has(tag)) {
          return false;
        }
      }
    }
    return true;
  }

  private grantTags(effectDef: EffectDef, tags: GameplayTagsComponent): void {
    if (!effectDef.tagsGranted) {
      return;
    }
    // Increment per-tag effect-grant ref count and reflect into the unified
    // `tags` set. The unified set is the lookup surface (hasTag uses it); the
    // ref count is the source of truth for revocation. Ad-hoc ownership in
    // `adHocTags` is unaffected by grants.
    for (const tag of effectDef.tagsGranted) {
      const current = tags.effectGrantCounts.get(tag) ?? 0;
      tags.effectGrantCounts.set(tag, current + 1);
      tags.tags.add(tag);
    }
  }

  private applyInstant(
    entity: Entity,
    effectDef: EffectDef,
    attributeIndexCache: Map<string, number>
  ): void {
    const attributes = entity.getComponent<AttributesComponent>(AbilitiesComponentType.Attributes);
    if (!attributes) {
      // Instant effects with attribute modifiers need an AttributesComponent.
      // If the target has none, we silently no-op the modifier application —
      // tag grants above still took effect. Users that need Instant effects
      // on tag-only entities should leave `modifiers` empty.
      return;
    }

    for (const modifier of effectDef.modifiers) {
      const index = this.resolveAttributeIndex(modifier.attributeId, attributeIndexCache);
      const current = FP.FromRaw(attributes.base[index]);
      const next = applyInstantModifier(current, modifier.op, modifier.magnitude);
      attributes.base[index] = FP.ToRaw(next);
      attributes.dirty[index] = 1;
    }
  }

  private queueDurational(
    entity: Entity,
    effectDef: EffectDef,
    pending: PendingEffectAdd,
    attributeIndexCache: Map<string, number>,
    tick: number
  ): void {
    const activeEffects = entity.getComponent<ActiveEffectsComponent>(
      AbilitiesComponentType.ActiveEffects
    );
    // pendingAdd lives on ActiveEffectsComponent, so it must exist here.
    if (!activeEffects) {
      throw new Error('ActiveEffectsComponent missing while draining pendingAdd');
    }

    // durationTicks was validated upstream in validateEffectOrThrow, so the
    // non-null assertion below is safe — keep the cast local.
    const durationTicksValidated = effectDef.durationTicks as number;
    // For Periodic effects, schedule the first firing one full period after
    // application. `executePeriodicOnApplication` (handled separately in
    // applyOne) does NOT advance nextPeriodTick — the immediate landing is
    // additive to the regular schedule, matching Unreal's GAS semantics.
    const nextPeriodTick =
      effectDef.type === 'Periodic' ? tick + (effectDef.periodTicks as number) : 0;
    const instance: ActiveEffectInstance = {
      instanceId: this.runtime.instanceIdCounter.next(),
      defId: effectDef.id,
      remainingTicks: durationTicksValidated,
      nextPeriodTick,
      sourceEntityId: pending.sourceEntityId,
      // Record the application tick so EffectTickSystem can skip the very
      // first countdown for this instance — without that, a durationTicks=1
      // effect would expire before AttributeAggregationSystem ever sees it.
      enteredOnTick: tick,
    };
    activeEffects.queue.push(instance);

    // Mark every attribute referenced by the effect dirty so aggregation
    // picks up the new modifier set on this same tick.
    this.markAttributesDirty(entity, effectDef.modifiers, attributeIndexCache);
  }

  private markAttributesDirty(
    entity: Entity,
    modifiers: readonly Modifier[],
    attributeIndexCache: Map<string, number>
  ): void {
    if (modifiers.length === 0) {
      return;
    }
    const attributes = entity.getComponent<AttributesComponent>(AbilitiesComponentType.Attributes);
    if (!attributes) {
      return;
    }
    for (const modifier of modifiers) {
      const index = this.resolveAttributeIndex(modifier.attributeId, attributeIndexCache);
      attributes.dirty[index] = 1;
    }
  }

  private resolveAttributeIndex(
    attributeId: string,
    attributeIndexCache: Map<string, number>
  ): number {
    const cached = attributeIndexCache.get(attributeId);
    if (cached !== undefined) {
      return cached;
    }
    const index = this.registries.attributes.indexOf(attributeId);
    attributeIndexCache.set(attributeId, index);
    return index;
  }

  private getOrCreateTags(entity: Entity): GameplayTagsComponent {
    const existing = entity.getComponent<GameplayTagsComponent>(
      AbilitiesComponentType.GameplayTags
    );
    if (existing) {
      return existing;
    }
    const tags = new GameplayTagsComponent();
    entity.addComponent(tags);
    this.entityManager.onComponentAdded(entity, tags.type);
    return tags;
  }
}

function applyInstantModifier(
  value: FixedPoint,
  op: ModifierOp,
  magnitude: FixedPoint
): FixedPoint {
  switch (op) {
    case 'Add':
      return FP.Add(value, magnitude);
    case 'Multiply':
      return FP.Mul(value, magnitude);
    case 'Override':
      return magnitude;
  }
}
