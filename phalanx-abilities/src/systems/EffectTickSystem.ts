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
import type { AbilitySystemRegistries } from '../registry';
import type { ActiveEffectInstance, EffectDef, ModifierOp } from '../types';

/**
 * Per-tick lifecycle for `Duration` and `Periodic` effects.
 *
 * Per entity per tick, the system runs three passes in order:
 *  1. Fire `Periodic` payloads. For every queued `Periodic` instance whose
 *     `nextPeriodTick <= currentTick` and that was not inserted on this
 *     same tick, apply its modifiers Instant-style (fold into
 *     `AttributesComponent.base`, mark attributes dirty for the downstream
 *     `AttributeAggregationSystem`) and advance `nextPeriodTick` by
 *     `EffectDef.periodTicks`. Fire-before-countdown ordering means the
 *     final periodic landing on the same tick as expiry still fires.
 *  2. Decrement `remainingTicks` on every queued instance — except those
 *     inserted on this same tick (so `durationTicks=1` survives long enough
 *     for aggregation to observe it) or already flagged at `0` by a forced
 *     removal helper (see `AbilitySystemFacade.removeEffectsBy*`).
 *  3. Compact the queue, harvesting any instance whose `remainingTicks`
 *     dropped to `<= 0`. Order is preserved (no re-sort). For each expired
 *     instance: revoke `tagsGranted` (with ref-count semantics so a tag
 *     stays on while another granter is alive or it is held ad hoc); mark
 *     every modifier-referenced attribute dirty so `AttributeAggregationSystem`
 *     recomputes `current` without the expired modifier on the same tick.
 *
 * Removals queued by `removeEffectsByTag` / `removeEffectsByDefId` flow
 * through this same path: the facade sets `remainingTicks = 0` on the
 * targeted instance(s); the periodic-fire pass skips them (no positive
 * remaining), countdown leaves them at zero, and the expiry pass harvests
 * them. Forced removal therefore never produces an extra periodic landing.
 *
 * The system relies on the invariant — established by
 * {@link EffectApplicationSystem} and `AbilitySystemFacade.removeEffectsBy*`
 * — that `queue` is sorted by `instanceId` ASC. It does not re-sort.
 */
export class EffectTickSystem extends GameSystem {
  public constructor(private readonly registries: AbilitySystemRegistries) {
    super();
  }

  public override processTick(tick: number): void {
    const entities = this.entityManager.queryEntities(AbilitiesComponentType.ActiveEffects);

    for (const entity of entities) {
      const activeEffects = entity.getComponent<ActiveEffectsComponent>(
        AbilitiesComponentType.ActiveEffects
      );
      if (!activeEffects || activeEffects.queue.length === 0) {
        continue;
      }

      this.tickEntity(entity, activeEffects, tick);
    }
  }

  private tickEntity(
    entity: Entity,
    activeEffects: ActiveEffectsComponent,
    tick: number
  ): void {
    const queue = activeEffects.queue;

    // First pass: fire Periodic payloads.
    //
    // Done BEFORE countdown so the final periodic landing on the same tick
    // the lifetime ends still fires (e.g. durationTicks=3, periodTicks=1
    // fires three times). Instances inserted on this same tick are skipped
    // — their `executePeriodicOnApplication` payload, if any, was already
    // applied by EffectApplicationSystem so firing again here would
    // double-apply. Instances flagged for forced removal (remainingTicks
    // already 0) are skipped too so cleanup never produces an extra landing.
    this.firePeriodics(entity, queue, tick);

    // Second pass: countdown.
    //
    // Instances inserted by EffectApplicationSystem earlier in *this same*
    // tick must NOT be decremented yet — otherwise a valid durationTicks=1
    // effect would reach remainingTicks=0 and be removed before
    // AttributeAggregationSystem runs, never becoming visible. We identify
    // such instances by enteredOnTick === current tick. Effects scheduled
    // for immediate removal (remainingTicks <= 0, set by removeEffectsBy*)
    // are also left alone here and harvested in the second pass.
    for (let i = 0; i < queue.length; i++) {
      const instance = queue[i];
      if (instance.enteredOnTick === tick) {
        continue;
      }
      if (instance.remainingTicks > 0) {
        instance.remainingTicks -= 1;
      }
    }

    // Third pass: extract expired and compact the queue, preserving order.
    const expired: ActiveEffectInstance[] = [];
    let writeIndex = 0;
    for (let readIndex = 0; readIndex < queue.length; readIndex++) {
      const instance = queue[readIndex];
      if (instance.remainingTicks <= 0) {
        expired.push(instance);
        continue;
      }
      if (writeIndex !== readIndex) {
        queue[writeIndex] = instance;
      }
      writeIndex += 1;
    }
    queue.length = writeIndex;

    if (expired.length === 0) {
      return;
    }

    this.processExpirations(entity, activeEffects, expired);
  }

  private processExpirations(
    entity: Entity,
    activeEffects: ActiveEffectsComponent,
    expired: readonly ActiveEffectInstance[]
  ): void {
    const tags = entity.getComponent<GameplayTagsComponent>(AbilitiesComponentType.GameplayTags);
    const attributes = entity.getComponent<AttributesComponent>(
      AbilitiesComponentType.Attributes
    );

    for (const instance of expired) {
      const effectDef = this.registries.effects.tryGet(instance.defId);
      if (!effectDef) {
        // Definitions are immutable per world, so a missing def here is a
        // genuine bug; surface it instead of silently swallowing.
        throw new Error(`EffectRegistry does not contain '${instance.defId}'`);
      }

      this.revokeTags(effectDef, tags, activeEffects.queue);
      this.markModifiersDirty(effectDef, attributes);
    }
  }

  /**
   * Apply periodic payloads in FIFO `instanceId` order. Iterating the queue
   * front-to-back yields that order because
   * {@link EffectApplicationSystem} maintains the `instanceId` ASC sort.
   * The inner `while` loop catches catch-up firings should the world ever
   * advance multiple periods worth of ticks in a single tick (warp-forward,
   * misconfigured `periodTicks=0`). `periodTicks` is validated at
   * application time so the legitimate path runs the loop body exactly once.
   */
  private firePeriodics(
    entity: Entity,
    queue: readonly ActiveEffectInstance[],
    tick: number
  ): void {
    if (queue.length === 0) {
      return;
    }

    let attributes: AttributesComponent | undefined;

    for (let i = 0; i < queue.length; i++) {
      const instance = queue[i];
      if (instance.enteredOnTick === tick) {
        continue;
      }
      if (instance.remainingTicks <= 0) {
        continue;
      }
      if (tick < instance.nextPeriodTick) {
        continue;
      }
      const effectDef = this.registries.effects.tryGet(instance.defId);
      if (!effectDef) {
        throw new Error(`EffectRegistry does not contain '${instance.defId}'`);
      }
      if (effectDef.type !== 'Periodic') {
        // Only Periodic instances carry meaningful `nextPeriodTick`. Defensive
        // skip in case the registry shape ever drifts.
        continue;
      }
      const periodTicks = effectDef.periodTicks;
      if (periodTicks === undefined || periodTicks <= 0) {
        // Application time should have rejected this, but guard against a
        // late registry mutation rather than spin forever below.
        throw new Error(
          `EffectDef '${effectDef.id}' is Periodic but has invalid periodTicks=${String(periodTicks)}`
        );
      }

      // Resolve attributes lazily — a queue with only Duration entries should
      // not pay for the component lookup.
      if (attributes === undefined) {
        attributes =
          entity.getComponent<AttributesComponent>(AbilitiesComponentType.Attributes) ?? undefined;
      }

      while (tick >= instance.nextPeriodTick) {
        this.applyPeriodicPayload(effectDef, attributes);
        instance.nextPeriodTick += periodTicks;
      }
    }
  }

  /**
   * Apply a Periodic effect's modifiers Instant-style to `base` and mark the
   * attributes dirty so the same-tick aggregation pass observes the new
   * value. Tag grants are NOT re-issued per period — they were granted once
   * at apply time and are revoked when the instance expires.
   */
  private applyPeriodicPayload(
    effectDef: EffectDef,
    attributes: AttributesComponent | undefined
  ): void {
    if (!attributes || effectDef.modifiers.length === 0) {
      return;
    }
    for (const modifier of effectDef.modifiers) {
      const index = this.registries.attributes.indexOf(modifier.attributeId);
      const current = FP.FromRaw(attributes.base[index]);
      const next = applyPeriodicModifier(current, modifier.op, modifier.magnitude);
      attributes.base[index] = FP.ToRaw(next);
      attributes.dirty[index] = 1;
    }
  }

  private revokeTags(
    effectDef: EffectDef,
    tags: GameplayTagsComponent | undefined,
    _remainingQueue: readonly ActiveEffectInstance[]
  ): void {
    if (!tags || !effectDef.tagsGranted || effectDef.tagsGranted.length === 0) {
      return;
    }

    // Decrement per-tag effect-grant ref counts. A tag is removed from the
    // unified `tags` set only when its grant count reaches zero AND the tag
    // is not also held ad hoc (via `addTag`). This keeps lifecycle revocation
    // from clobbering manually managed tags, and — because shared grants are
    // now tracked by counts rather than queue scans — removes the O(n*m)
    // re-scan of the remaining queue per expired effect.
    for (const grantedTag of effectDef.tagsGranted) {
      const current = tags.effectGrantCounts.get(grantedTag) ?? 0;
      if (current <= 1) {
        tags.effectGrantCounts.delete(grantedTag);
        if (!tags.adHocTags.has(grantedTag)) {
          tags.tags.delete(grantedTag);
        }
      } else {
        tags.effectGrantCounts.set(grantedTag, current - 1);
      }
    }
  }

  private markModifiersDirty(
    effectDef: EffectDef,
    attributes: AttributesComponent | undefined
  ): void {
    if (!attributes || effectDef.modifiers.length === 0) {
      return;
    }
    for (const modifier of effectDef.modifiers) {
      const index = this.registries.attributes.indexOf(modifier.attributeId);
      attributes.dirty[index] = 1;
    }
  }
}

function applyPeriodicModifier(
  value: FixedPoint,
  op: ModifierOp,
  magnitude: FixedPoint
): FixedPoint {
  // Mirrors `EffectApplicationSystem.applyInstantModifier`. Kept private to
  // this file to avoid an import cycle and to keep periodic-write semantics
  // independently auditable.
  switch (op) {
    case 'Add':
      return FP.Add(value, magnitude);
    case 'Multiply':
      return FP.Mul(value, magnitude);
    case 'Override':
      return magnitude;
  }
}
