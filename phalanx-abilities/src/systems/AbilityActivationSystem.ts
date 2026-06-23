import { GameSystem } from '@phalanx-engine/ecs';
import type { Entity } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import {
  ActiveEffectsComponent,
  getAbilitySystemComponent,
  getActiveEffectsComponent,
  getAttributesComponent,
  getGameplayTagsComponent,
} from '../components';
import { ABILITY_ACTIVATED_EVENT } from '../events';
import type { AbilityActivatedEvent } from '../events';
import type { AbilitySystemRegistries } from '../registry';
import type {
  AbilityActivationRequest,
  AbilitySystemRuntime,
  ResolvedAbilityActivationRecord,
} from '../runtime';
import { TargetResolver } from '../targeting';
import type { TargetResolutionResult } from '../targeting';
import type { AbilityDef, ProvidedTarget } from '../types';

/**
 * Drains pending {@link AbilityActivationRequest}s from the runtime, runs
 * `CanActivate` against the caster, and — for every approved request —
 * queues the caster-side and target-side effects on the relevant entities'
 * `ActiveEffectsComponent.pendingAdd`.
 *
 * `CanActivate` evaluates in fixed order:
 *  1. `activationBlockedTags` — none of the listed tags may be present on
 *     the caster (`GameplayTagsComponent.tags`).
 *  2. `tagsRequired` — every listed tag must be present on the caster.
 *  3. Cost — if `costEffectId` is set, the referenced effect must be
 *     affordable. Stage 5 supports cost effects of type `Instant` whose
 *     modifiers use the `Add` op with negative magnitude; in that case the
 *     caster's `current` attribute must remain `>= 0` after the subtraction.
 *     Multi-modifier costs (e.g. mana + stamina) are checked together. Non-
 *     `Instant` cost effects or non-`Add` modifiers throw at activation time
 *     — they are not supported in MVP.
 *  4. Cooldown — if `cooldownEffectId` is set, the effect's `tagsGranted`
 *     are inspected; if the caster already carries any of them, activation
 *     is rejected. This matches the convention in the design doc where a
 *     cooldown is "a Duration effect granting `Cooldown.Ability.<id>`".
 *
 * **Same-tick chained activations.** A naive implementation would allow two
 * activations of the same ability in the same tick because the cooldown
 * effect's `tagsGranted` only land when `EffectApplicationSystem` runs later
 * in the tick. To preserve "one cast per cooldown" semantics inside a single
 * tick, the system tracks two transient bookkeeping maps for the duration of
 * one drain pass:
 *  - `inFlightTagsByCaster`: tags that earlier-this-tick approved requests
 *    will grant. Each subsequent CanActivate check treats them as if they
 *    were already on the caster.
 *  - `inFlightCostsByCaster`: per-attribute cumulative would-be cost
 *    debits. Each subsequent affordability check subtracts them from the
 *    caster's `current` value.
 *
 * After successful CanActivate the system:
 *  - Enqueues `costEffectId` (if any), `cooldownEffectId` (if any), and
 *    every `selfEffectIds` entry on the caster's `pendingAdd`.
 *  - Resolves `target` via {@link TargetResolver}. Every `TargetSpec.kind`
 *    (`Self`, `Entity`, `Point`) and every `TargetOrigin.kind`
 *    including `Caller` is supported.
 *  - Enqueues every `targetEffectIds` entry on each resolved target's
 *    `pendingAdd`.
 *  - Emits an {@link AbilityActivatedEvent} on the world event bus.
 *  - Appends a {@link ResolvedAbilityActivationRecord} to
 *    `runtime.resolvedActivationsThisTick` so
 *    `AbilityHookExecutorSystem` can fire `hookId` later in the tick.
 *
 * Failed activations are silently dropped — they do not throw. A `boolean`
 * is returned by the facade-level `activateAbility` for the synchronous
 * "did we enqueue a request at all" check, but the actual approval verdict
 * is observable only via the side effects above (and the event). This
 * mirrors UE5's GAS where `TryActivateAbility` accepts the input but the
 * server-authoritative side decides whether the ability actually fires.
 */
export class AbilityActivationSystem extends GameSystem {
  /** Per-tick scratch buffer: tag string → caster id → tag granted in flight. */
  private readonly inFlightTagsByCaster = new Map<number, Set<string>>();
  /**
   * Per-tick scratch buffer: caster id → attribute id → cumulative debit.
   * `debit` is stored as raw `FixedPoint` for cheap accumulation.
   */
  private readonly inFlightCostsByCaster = new Map<number, Map<string, bigint>>();

  /**
   * Lazily constructed once the entity manager has been attached (the
   * GameSystem base class sets `this.entityManager` after construction).
   * The resolver is stateless apart from the registries + entityManager
   * pair it captures.
   */
  private targetResolver: TargetResolver | undefined;

  public constructor(
    private readonly registries: AbilitySystemRegistries,
    private readonly runtime: AbilitySystemRuntime
  ) {
    super();
  }

  public override processTick(tick: number): void {
    this.runtime.currentTick = tick;

    // Reset transient bookkeeping at the start of every drain pass. We
    // deliberately do not retain in-flight state across ticks — by the next
    // tick, the actual tags / costs will have landed via
    // EffectApplicationSystem.
    this.inFlightTagsByCaster.clear();
    this.inFlightCostsByCaster.clear();

    // The hook executor will drain this buffer later in the tick, after
    // EffectApplicationSystem has run. We assert here that the buffer is
    // empty: a non-empty buffer means the executor did not run last tick,
    // which is a registration bug.
    if (this.runtime.resolvedActivationsThisTick.length !== 0) {
      throw new Error(
        'AbilityActivationSystem: resolvedActivationsThisTick is not empty at start of tick. ' +
          'Ensure AbilityHookExecutorSystem is registered after AbilityActivationSystem ' +
          'and EffectApplicationSystem in the system pipeline.'
      );
    }

    // Drain only requests that were enqueued BEFORE this tick. Requests made
    // from inside the tick (e.g. by a hook scheduling another activation)
    // wait for the next tick — mirrors the pendingAdd discipline used by
    // ActiveEffectsComponent.
    const pending = this.runtime.activationRequests;
    if (pending.length === 0) {
      return;
    }

    // Compact the queue inside a `try`/`finally` so that even if
    // `processOne` throws (e.g. on a misconfigured effect or an unsupported
    // target shape), every already-visited request is removed from the
    // queue. Otherwise a loud activation error would leave processed
    // requests behind to be replayed on a later tick — after their effects
    // were already enqueued and their `AbilityActivated` event emitted.
    let readIndex = 0;
    let writeIndex = 0;
    try {
      for (; readIndex < pending.length; readIndex++) {
        const request = pending[readIndex];
        if (request.enqueueTick === tick) {
          // Defer to next tick.
          if (writeIndex !== readIndex) {
            pending[writeIndex] = request;
          }
          writeIndex += 1;
          continue;
        }
        this.processOne(request, tick);
      }
    } finally {
      // Preserve any unread tail (readIndex+1..end) after the compacted
      // prefix so deferred requests from later in the queue are not lost
      // when an exception interrupts the drain mid-loop.
      if (readIndex + 1 < pending.length) {
        for (let k = readIndex + 1; k < pending.length; k++) {
          pending[writeIndex++] = pending[k];
        }
      }
      pending.length = writeIndex;
    }
  }

  private processOne(request: AbilityActivationRequest, tick: number): void {
    const abilityDef = this.registries.abilities.tryGet(request.abilityId);
    if (!abilityDef) {
      // Unknown ability id is a programming error, not a runtime miss.
      throw new Error(`AbilityRegistry does not contain '${request.abilityId}'`);
    }

    const caster = this.entityManager.getEntity(request.casterEntityId);
    if (!caster) {
      // Caster despawned between enqueue and drain; silently drop.
      return;
    }

    if (!this.canActivate(caster, abilityDef)) {
      return;
    }

    // 1) Resolve targets BEFORE enqueueing any effects. If the caller
    //    forgot to supply required input (Caller-origin point/entity)
    //    the resolver returns `dropped: true` and we abort here — no
    //    cost, no cooldown, no event, no hook. Other failure modes
    //    (missing entity position) throw inside
    //    `resolve` and propagate up via the drain loop's try/finally.
    const resolution = this.resolveTargets(caster, abilityDef, request.providedTarget);
    if (resolution.dropped) {
      return;
    }
    const resolvedTargets = resolution.targets;

    // 2) Apply caster-side effects (cost, cooldown, selfEffectIds).
    this.enqueueCasterEffects(caster, abilityDef);

    // 3) Apply target-side effects (every targetEffectIds entry on each
    //    resolved target).
    if (abilityDef.targetEffectIds && abilityDef.targetEffectIds.length > 0) {
      for (let i = 0; i < resolvedTargets.length; i++) {
        const targetEntity = this.entityManager.getEntity(resolvedTargets[i]);
        if (!targetEntity) {
          // Target despawned between resolve and apply; skip without
          // aborting the rest of the activation. Determinism-safe because
          // every peer makes the same observation (snapshot at this point
          // in the tick).
          continue;
        }
        for (const effectId of abilityDef.targetEffectIds) {
          this.enqueueEffect(targetEntity, effectId, request.casterEntityId);
        }
      }
    }

    // 4) Record an in-flight cooldown tag-grant so subsequent same-tick
    //    requests on the same caster see it.
    this.recordCooldownInFlight(request.casterEntityId, abilityDef);

    // 5) Stash the resolved activation for the hook executor.
    const record: ResolvedAbilityActivationRecord = {
      abilityId: abilityDef.id,
      casterEntityId: request.casterEntityId,
      resolvedTargets,
      providedTarget: request.providedTarget,
      hookId: abilityDef.hookId,
      tick,
    };
    this.runtime.resolvedActivationsThisTick.push(record);

    // 6) Emit AbilityActivated for any subscribers (gameplay scripts that
    //    want to react to a successful cast — e.g. analytics, scripted
    //    encounters). Hook execution runs later in the tick via the executor
    //    system; the event is fired now so consumers see consistent ordering
    //    with the cost/cooldown enqueue.
    const event: AbilityActivatedEvent = {
      abilityId: abilityDef.id,
      casterEntityId: request.casterEntityId,
      resolvedTargets,
      providedTarget: request.providedTarget,
      tick,
    };
    this.eventBus.emit(ABILITY_ACTIVATED_EVENT, event);
  }

  // ---------------------------------------------------------------------------
  // CanActivate
  // ---------------------------------------------------------------------------

  private canActivate(caster: Entity, def: AbilityDef): boolean {
    const casterId = caster.id;
    const abilitySystem = getAbilitySystemComponent(caster);
    if (abilitySystem && !abilitySystem.abilities.has(def.id)) {
      return false;
    }
    const tags = getGameplayTagsComponent(caster);
    const inFlightTags = this.inFlightTagsByCaster.get(casterId);

    if (def.activationBlockedTags) {
      for (const tag of def.activationBlockedTags) {
        if (tags?.tags.has(tag) === true) {
          return false;
        }
        if (inFlightTags?.has(tag) === true) {
          return false;
        }
      }
    }

    if (def.tagsRequired) {
      for (const tag of def.tagsRequired) {
        if (tags?.tags.has(tag) !== true && inFlightTags?.has(tag) !== true) {
          return false;
        }
      }
    }

    if (def.costEffectId !== undefined) {
      if (!this.canAffordCost(caster, def.costEffectId)) {
        return false;
      }
    }

    if (def.cooldownEffectId !== undefined) {
      if (!this.isOffCooldown(caster, def.cooldownEffectId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Stage 5 cost model:
   *  - Cost effect must be `Instant`.
   *  - Every modifier must be `Add` with negative magnitude (a debit).
   *  - The caster must have enough `current` (post-aggregation) to absorb
   *    every debit without dropping below `0`. We use `current` (not `base`)
   *    so transient buffs / debuffs are accounted for — e.g. a fortitude
   *    buff that boosts max mana also boosts affordable spend.
   *  - Multiple modifiers on different attributes are checked independently.
   *  - In-flight costs from earlier same-tick requests on the same caster
   *    are subtracted before the comparison.
   *
   * Non-Instant cost effects and non-Add modifiers throw — they're a
   * misconfiguration in MVP, not a runtime miss.
   */
  private canAffordCost(caster: Entity, costEffectId: string): boolean {
    const effectDef = this.registries.effects.tryGet(costEffectId);
    if (!effectDef) {
      throw new Error(`EffectRegistry does not contain '${costEffectId}'`);
    }
    if (effectDef.type !== 'Instant') {
      throw new Error(
        `Ability cost effect '${costEffectId}' must be type 'Instant'; got '${effectDef.type}'`
      );
    }

    if (effectDef.modifiers.length === 0) {
      // Free cost: trivially affordable.
      return true;
    }

    const attributes = getAttributesComponent(caster);
    if (!attributes) {
      // No attribute store at all — cost cannot be charged. Reject so the
      // caller isn't silently let through.
      return false;
    }

    const inFlightCosts = this.inFlightCostsByCaster.get(caster.id);

    for (const modifier of effectDef.modifiers) {
      if (modifier.op !== 'Add') {
        throw new Error(
          `Ability cost effect '${costEffectId}' uses unsupported op '${modifier.op}'. ` +
            'MVP supports only Instant + Add modifiers for cost.'
        );
      }
      const rawMagnitude = FP.ToRaw(modifier.magnitude);
      if (rawMagnitude >= 0n) {
        // Non-negative magnitudes aren't really a "cost"; they cannot fail
        // the affordability check and we let them through unchanged.
        continue;
      }
      const attributeIndex = this.registries.attributes.indexOfOrMinusOne(modifier.attributeId);
      if (attributeIndex === -1) {
        throw new Error(
          `Ability cost effect '${costEffectId}' references unknown attribute '${modifier.attributeId}'`
        );
      }
      const currentRaw = attributes.current[attributeIndex];
      const inFlightDebit = inFlightCosts?.get(modifier.attributeId) ?? 0n;
      // After the debit, attribute value would be: current - inFlight + magnitude
      // (magnitude is negative). Reject if it would go below 0.
      const after = currentRaw - inFlightDebit + rawMagnitude;
      if (after < 0n) {
        return false;
      }
    }

    return true;
  }

  /**
   * Cooldown is encoded as a Duration effect whose `tagsGranted` contains
   * the cooldown tag (e.g. `Cooldown.Ability.AutoAttack`). The ability is
   * "off cooldown" iff none of those tags are present on the caster — both
   * as real tags and as in-flight grants from same-tick earlier activations.
   *
   * A cooldown effect with no `tagsGranted` is a misconfiguration: there
   * would be no way to gate the next activation. We throw rather than
   * silently letting the second activation through.
   */
  private isOffCooldown(caster: Entity, cooldownEffectId: string): boolean {
    const effectDef = this.registries.effects.tryGet(cooldownEffectId);
    if (!effectDef) {
      throw new Error(`EffectRegistry does not contain '${cooldownEffectId}'`);
    }
    if (!effectDef.tagsGranted || effectDef.tagsGranted.length === 0) {
      throw new Error(
        `Ability cooldown effect '${cooldownEffectId}' must have at least one tagsGranted entry.`
      );
    }

    const tags = getGameplayTagsComponent(caster);
    const inFlightTags = this.inFlightTagsByCaster.get(caster.id);

    for (const tag of effectDef.tagsGranted) {
      if (tags?.tags.has(tag) === true) {
        return false;
      }
      if (inFlightTags?.has(tag) === true) {
        return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Application
  // ---------------------------------------------------------------------------

  private enqueueCasterEffects(caster: Entity, def: AbilityDef): void {
    if (def.costEffectId !== undefined) {
      this.enqueueEffect(caster, def.costEffectId, caster.id);
      this.recordCostInFlight(caster.id, def.costEffectId);
    }
    if (def.cooldownEffectId !== undefined) {
      this.enqueueEffect(caster, def.cooldownEffectId, caster.id);
    }
    if (def.selfEffectIds) {
      for (const effectId of def.selfEffectIds) {
        this.enqueueEffect(caster, effectId, caster.id);
      }
    }
  }

  /**
   * Mirror of `AbilitySystemFacade.applyEffect`'s enqueue path. We do not
   * call the facade directly — the facade requires entity existence to
   * `throw`, which is appropriate for user code but the system already
   * knows the entity exists.
   */
  private enqueueEffect(target: Entity, effectId: string, sourceEntityId: number): void {
    if (!this.registries.effects.has(effectId)) {
      throw new Error(`EffectRegistry does not contain '${effectId}'`);
    }
    const activeEffects = this.getOrCreateActiveEffects(target);
    activeEffects.pendingAdd.push({ defId: effectId, sourceEntityId });
  }

  private getOrCreateActiveEffects(target: Entity): ActiveEffectsComponent {
    const existing = getActiveEffectsComponent(target);
    if (existing) {
      return existing;
    }
    const component = new ActiveEffectsComponent();
    target.addComponent(component);
    this.entityManager.onComponentAdded(target, component.type);
    return component;
  }

  private recordCooldownInFlight(casterId: number, def: AbilityDef): void {
    if (def.cooldownEffectId === undefined) {
      return;
    }
    const effectDef = this.registries.effects.tryGet(def.cooldownEffectId);
    if (!effectDef || !effectDef.tagsGranted) {
      return;
    }
    let set = this.inFlightTagsByCaster.get(casterId);
    if (!set) {
      set = new Set<string>();
      this.inFlightTagsByCaster.set(casterId, set);
    }
    for (const tag of effectDef.tagsGranted) {
      set.add(tag);
    }
  }

  private recordCostInFlight(casterId: number, costEffectId: string): void {
    const effectDef = this.registries.effects.tryGet(costEffectId);
    if (!effectDef) {
      return;
    }
    let map = this.inFlightCostsByCaster.get(casterId);
    for (const modifier of effectDef.modifiers) {
      if (modifier.op !== 'Add') {
        // Already rejected by canAffordCost; defensive skip.
        continue;
      }
      const rawMagnitude = FP.ToRaw(modifier.magnitude);
      if (rawMagnitude >= 0n) {
        continue;
      }
      if (!map) {
        map = new Map<string, bigint>();
        this.inFlightCostsByCaster.set(casterId, map);
      }
      const existing = map.get(modifier.attributeId) ?? 0n;
      // Stored as positive debit so canAffordCost can subtract it cleanly.
      map.set(modifier.attributeId, existing + -rawMagnitude);
    }
  }

  // ---------------------------------------------------------------------------
  // Target resolution
  // ---------------------------------------------------------------------------

  /**
   * Delegate to {@link TargetResolver}. The resolver handles every
   * `TargetSpec.kind` (`Self`, `Entity`, `Point`) and every
   * `TargetOrigin.kind` including `Caller`.
   *
   * Returns the resolver's discriminated result so `processOne` can
   * distinguish a legitimate empty target list from a silent drop
   * ("Caller forgot to supply the target point").
   * Drops abort the activation before any side effects — see
   * {@link TargetResolutionResult} for the contract.
   */
  private resolveTargets(
    caster: Entity,
    def: AbilityDef,
    providedTarget: ProvidedTarget | undefined
  ): TargetResolutionResult {
    if (this.targetResolver === undefined) {
      this.targetResolver = new TargetResolver();
    }
    return this.targetResolver.resolve({
      casterEntityId: caster.id,
      spec: def.target,
      providedTarget,
    });
  }
}

