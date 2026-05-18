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
import type { AbilitySystemRuntime } from '../runtime';
import type { ActiveEffectInstance, EffectDef, Modifier, ModifierOp } from '../types';

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
 *      - Stage 4 will handle the periodic tick semantics. In Stage 3 we
 *        treat the application identically to `Duration` (queue + dirty)
 *        but do not yet apply per-period modifiers. The dedicated test
 *        suite for Periodic lives in stage 4.
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

    // Tag grants are applied regardless of effect type (Instant grants are
    // ephemeral in practice because Instant carries no lifecycle — but we
    // honor `tagsGranted` for both for consistency; users who don't want
    // sticky tags on Instant simply leave the field empty).
    this.grantTags(effectDef, tags);

    switch (effectDef.type) {
      case 'Instant':
        this.applyInstant(entity, effectDef, attributeIndexCache);
        return;
      case 'Duration':
      case 'Periodic':
        this.queueDurational(entity, effectDef, pending, attributeIndexCache, tick);
        return;
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
    for (const tag of effectDef.tagsGranted) {
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

    const durationTicks = effectDef.durationTicks;
    if (durationTicks === undefined || durationTicks <= 0) {
      throw new Error(
        `EffectDef '${effectDef.id}' is type '${effectDef.type}' but has invalid durationTicks=${String(durationTicks)}`
      );
    }

    const instance: ActiveEffectInstance = {
      instanceId: this.runtime.instanceIdCounter.next(),
      defId: effectDef.id,
      remainingTicks: durationTicks,
      // Stage 4 will use nextPeriodTick; in Stage 3 we initialize to 0.
      nextPeriodTick: 0,
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
