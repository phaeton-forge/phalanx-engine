import { Entity, type EntityManager } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import type { FixedPoint } from 'phalanx-math';
import {
  AbilitiesComponentType,
  ActiveEffectsComponent,
  AttributesComponent,
  AuraComponent,
  GameplayTagsComponent,
} from '../components';
import type { AbilitySystemRegistries } from '../registry';
import type { AbilitySystemRuntime } from '../runtime/AbilitySystemRuntime';
import type { GameplayCueBuffer } from '../runtime/GameplayCueBuffer';
import type { ISpatialQuery } from '../spatial';
import { TargetResolver } from '../targeting';
import type { AbilityHook, ProvidedTarget, TargetSpec, TargetFilter } from '../types';

export interface AttributeValue {
  base: FixedPoint;
  current: FixedPoint;
}

/**
 * Sentinel `sourceEntityId` written by {@link AbilitySystemFacade.applyEffect}
 * when the caller does not supply a source. Distinct from any real entity id
 * (entity ids are non-negative) so consumers can branch on it cheaply.
 */
export const NO_SOURCE_ENTITY_ID = -1;

/**
 * Single user-facing entry point for the ability system.
 *
 * Determinism note: all mutations enqueue work and are processed by the
 * ability systems during the next tick. The facade never advances effect
 * state itself — it only writes into components that the systems own.
 * That keeps observable state changes anchored to the simulation tick and
 * therefore reproducible across lockstep peers.
 */
export class AbilitySystemFacade {
  public constructor(
    private readonly entityManager: EntityManager,
    private readonly registries: AbilitySystemRegistries,
    private readonly runtime: AbilitySystemRuntime
  ) {}

  // -----------------------------------------------------------------------
  // Attributes
  // -----------------------------------------------------------------------

  public initAttributesForEntity(entityId: number): AttributesComponent {
    const entity = this.requireEntity(entityId);

    const existing = entity.getComponent<AttributesComponent>(AbilitiesComponentType.Attributes);

    if (existing) {
      return existing;
    }

    const attributes = new AttributesComponent(this.registries.attributes.size);
    const defs = this.registries.attributes.values();

    for (let index = 0; index < defs.length; index++) {
      const rawDefault = FP.ToRaw(defs[index].default);
      attributes.base[index] = rawDefault;
      attributes.current[index] = rawDefault;
      // Mark every attribute dirty so AttributeAggregationSystem clamps the
      // seeded default value on the next tick. Without this, a default that
      // violates its own min/max would silently persist in `current`.
      attributes.dirty[index] = 1;
    }

    entity.addComponent(attributes);
    this.entityManager.onComponentAdded(entity, attributes.type);

    return attributes;
  }

  public getAttribute(entityId: number, attrId: string): AttributeValue {
    const value = this.tryGetAttribute(entityId, attrId);
    if (!value) {
      // Differentiate which precondition failed so callers get a useful message.
      const entity = this.entityManager.getEntity(entityId);
      if (!entity) {
        throw new Error(`Entity ${entityId} does not exist`);
      }
      if (!entity.getComponent<AttributesComponent>(AbilitiesComponentType.Attributes)) {
        throw new Error(`Entity ${entityId} does not have AttributesComponent`);
      }
      throw new Error(`AttributeRegistry does not contain '${attrId}'`);
    }
    return value;
  }

  /**
   * Non-throwing read. Returns `undefined` when the entity is missing, has no
   * {@link AttributesComponent}, or the attribute id is not registered. Useful
   * for user-side damage pipelines that need to fall back to a neutral value
   * (e.g. `IncomingDamageMultiplier === 1`) when the target has no abilities
   * setup.
   */
  public tryGetAttribute(entityId: number, attrId: string): AttributeValue | undefined {
    const entity = this.entityManager.getEntity(entityId);
    if (!entity) {
      return undefined;
    }

    const attributes = entity.getComponent<AttributesComponent>(AbilitiesComponentType.Attributes);
    if (!attributes) {
      return undefined;
    }

    const index = this.registries.attributes.indexOfOrMinusOne(attrId);
    if (index === -1) {
      return undefined;
    }

    return {
      base: FP.FromRaw(attributes.base[index]),
      current: FP.FromRaw(attributes.current[index]),
    };
  }

  // -----------------------------------------------------------------------
  // Effects
  // -----------------------------------------------------------------------

  /**
   * Queue an effect application onto the target. The actual application
   * (modifier write, tag grant, queue insertion) happens in
   * {@link EffectApplicationSystem} on the next system pass. Throws if
   * the target entity or the effect id are unknown.
   *
   * `sourceEntityId` is optional: omit it for sourceless applications such
   * as world hazards, debug helpers, or initial spawn-time buffs. When
   * omitted, the recorded source is {@link NO_SOURCE_ENTITY_ID} (`-1`).
   * This is a deterministic default — every peer that omits a source ends
   * up with the same sentinel — so lockstep reproducibility is preserved.
   *
   * Returns nothing in Stage 3 — the future `ActiveEffectInstance.instanceId`
   * is allocated during application, not enqueue, so the facade cannot hand
   * it back synchronously. If callers need to track an applied instance,
   * Stage 5 will introduce an `apply` event on `EventBus`.
   */
  public applyEffect(
    targetEntityId: number,
    effectId: string,
    sourceEntityId: number = NO_SOURCE_ENTITY_ID
  ): void {
    const target = this.requireEntity(targetEntityId);
    if (!this.registries.effects.has(effectId)) {
      throw new Error(`EffectRegistry does not contain '${effectId}'`);
    }

    const activeEffects = this.getOrCreateActiveEffects(target);
    activeEffects.pendingAdd.push({ defId: effectId, sourceEntityId });
  }

  /**
   * Short-circuit AoE: resolve every entity inside a disc and enqueue
   * `effectId` onto each. Designed for the projectile-impact path used by
   * rockets and grenades — the projectile entity lives in user code, and
   * when it impacts the user calls `applyEffectAoE(point, ...)` directly,
   * bypassing the ability layer.
   *
   * The resolve is deterministic: every peer using the same
   * {@link ISpatialQuery} implementation and the same world state
   * produces the same sorted, deduplicated, capped target list. See
   * {@link TargetResolver} for the determinism rules.
   *
   * `selfId` is the entity that "owns" the AoE for `includeSelf`
   * filtering. Defaults to `sourceEntityId`. Pass an explicit value
   * when the source is `NO_SOURCE_ENTITY_ID` (world hazards) and you
   * still want to exclude a specific entity — e.g. the rocket's
   * launcher should not damage themselves with their own splash, even
   * when the rocket has no "source" in the gameplay sense.
   *
   * Returns the list of entity ids that actually received the effect
   * (i.e. had `pendingAdd` enqueued). The list is sorted by entity id ASC.
   * It is a subset of what {@link TargetResolver} produced: any id that
   * the resolver returned but that no longer exists in the entity
   * manager at enqueue time is omitted. User code can rely on this list
   * to drive secondary effects — cues, damage numbers, screen shakes —
   * without re-validating entities itself. Re-sort by distance if you
   * need presentation order.
   *
   * Throws if no spatial query is registered. Self / Entity / Point
   * abilities do not need one, but this method always does — it is the
   * Radius shape by construction.
   */
  public applyEffectAoE(
    origin: { x: FixedPoint; z: FixedPoint },
    effectId: string,
    sourceEntityId: number = NO_SOURCE_ENTITY_ID,
    opts: {
      radius: FixedPoint;
      maxTargets?: number;
      filter?: TargetFilter;
      includeSelf?: boolean;
      selfId?: number;
    }
  ): number[] {
    if (!this.registries.effects.has(effectId)) {
      throw new Error(`EffectRegistry does not contain '${effectId}'`);
    }
    const resolver = this.getTargetResolver();
    const selfId = opts.selfId !== undefined ? opts.selfId : sourceEntityId;
    const resolution = resolver.resolve({
      casterEntityId: selfId,
      spec: {
        kind: 'Radius',
        origin: { kind: 'Point', x: origin.x, z: origin.z },
        radius: opts.radius,
        maxTargets: opts.maxTargets,
        filter: opts.filter,
        includeSelf: opts.includeSelf,
      },
    });
    // The synthetic spec above uses a literal Point origin (never
    // Caller), so the resolver cannot return `dropped: true` here.
    // Assert defensively in case the spec construction ever changes.
    /* istanbul ignore if */
    if (resolution.dropped) {
      return [];
    }
    const targets = resolution.targets;
    // Only return ids that successfully enqueued the effect. The resolver
    // already drops stale ids, but a removal can still happen between
    // resolve and enqueue inside a single tick (e.g. an earlier hook in
    // the same activation despawned the target). Returning the enqueued
    // subset gives callers a precise "who actually got hit" list and
    // matches what observers will see via component pendingAdd queues.
    const applied: number[] = [];
    for (let i = 0; i < targets.length; i++) {
      const entity = this.entityManager.getEntity(targets[i]);
      if (!entity) {
        continue;
      }
      const activeEffects = this.getOrCreateActiveEffects(entity);
      activeEffects.pendingAdd.push({ defId: effectId, sourceEntityId });
      applied.push(targets[i]);
    }
    return applied;
  }

  /**
   * Flag every active effect on `entityId` that grants `grantedTag` for
   * removal on the next {@link EffectTickSystem} pass. Returns the number
   * of instances flagged.
   *
   * Removal is timed to the system tick — never inline — so two peers
   * issuing removals in the same tick observe identical state after the
   * tick boundary.
   */
  public removeEffectsByTag(entityId: number, grantedTag: string): number {
    const entity = this.entityManager.getEntity(entityId);
    if (!entity) {
      return 0;
    }
    const activeEffects = entity.getComponent<ActiveEffectsComponent>(
      AbilitiesComponentType.ActiveEffects
    );
    if (!activeEffects) {
      return 0;
    }

    let flagged = 0;
    for (let i = 0; i < activeEffects.queue.length; i++) {
      const instance = activeEffects.queue[i];
      const def = this.registries.effects.tryGet(instance.defId);
      if (!def || !def.tagsGranted) {
        continue;
      }
      if (def.tagsGranted.indexOf(grantedTag) === -1) {
        continue;
      }
      if (instance.remainingTicks > 0) {
        instance.remainingTicks = 0;
        flagged += 1;
      }
    }
    return flagged;
  }

  /**
   * Flag every active effect on `entityId` whose `defId === effectId` for
   * removal on the next {@link EffectTickSystem} pass.
   */
  public removeEffectsByDefId(entityId: number, effectId: string): number {
    const entity = this.entityManager.getEntity(entityId);
    if (!entity) {
      return 0;
    }
    const activeEffects = entity.getComponent<ActiveEffectsComponent>(
      AbilitiesComponentType.ActiveEffects
    );
    if (!activeEffects) {
      return 0;
    }

    let flagged = 0;
    for (let i = 0; i < activeEffects.queue.length; i++) {
      const instance = activeEffects.queue[i];
      if (instance.defId !== effectId) {
        continue;
      }
      if (instance.remainingTicks > 0) {
        instance.remainingTicks = 0;
        flagged += 1;
      }
    }
    return flagged;
  }

  // -----------------------------------------------------------------------
  // Abilities
  // -----------------------------------------------------------------------

  /**
   * Enqueue an ability activation request. The actual `CanActivate` check
   * (tag predicates, cost, cooldown) and the application of caster-side
   * effects (cost, cooldown, `selfEffectIds`) are performed by
   * `AbilityActivationSystem` on the next tick. Target-side effects
   * (`targetEffectIds`) and the hook (if any) follow on the same tick as
   * activation.
   *
   * Returns `true` if the request was accepted and queued; `false` only if
   * the caster or ability id are unknown. A return value of `true` does
   * NOT mean the activation will succeed — the verdict is delivered
   * asynchronously via the `AbilityActivatedEvent` on the world event bus,
   * and observable through side effects (cooldown tag granted, cost
   * deducted). This mirrors UE5's GAS where `TryActivateAbility` accepts
   * the input but the server-authoritative side decides whether the
   * ability actually fires.
   *
   * `providedTarget` is required for abilities whose `TargetSpec.origin` is
   * `{ kind: 'Caller' }` — it carries the target the user clicked on (an
   * entity id, a point, or both). It is ignored for `Self`-targeted
   * abilities and abilities resolving target from the registry.
   *
   * Deterministic enqueue order: requests are appended to a single FIFO
   * queue on the runtime. Multiple casters racing the same ability on the
   * same tick are resolved in the strict order their `activateAbility`
   * calls arrived. In lockstep games this order is the input-replay order,
   * which every peer reconstructs identically.
   */
  public activateAbility(
    casterEntityId: number,
    abilityId: string,
    providedTarget?: ProvidedTarget
  ): boolean {
    if (!this.entityManager.getEntity(casterEntityId)) {
      return false;
    }
    if (!this.registries.abilities.has(abilityId)) {
      return false;
    }
    // Snapshot `providedTarget` so callers that reuse or mutate their
    // target object between this call and the next tick cannot retroactively
    // change an already-enqueued activation. `ProvidedTarget` is a flat
    // record of primitives + bigint FixedPoint values, so a shallow copy is
    // sufficient to make the request immutable.
    const snapshotTarget: ProvidedTarget | undefined =
      providedTarget === undefined
        ? undefined
        : {
            entityId: providedTarget.entityId,
            x: providedTarget.x,
            z: providedTarget.z,
          };
    this.runtime.activationRequests.push({
      casterEntityId,
      abilityId,
      providedTarget: snapshotTarget,
      enqueueTick: this.runtime.currentTick,
    });
    return true;
  }

  /**
   * Register a callback for `AbilityDef.hookId`. The callback fires inside
   * `AbilityHookExecutorSystem` after `EffectApplicationSystem` has run on
   * the activation tick, so the hook observes freshly-applied
   * cost/cooldown/self-effects on the caster.
   *
   * Hooks MUST be deterministic — no `Date.now`, no `Math.random`, no
   * non-replayable floating-point math. They may spawn entities (e.g.
   * projectiles, aura zones) and write into the physics package; the
   * resulting state is observable on the next tick.
   *
   * Throws if `hookId` is already registered. Registration is a one-shot
   * setup step done at world boot.
   */
  public registerHook(hookId: string, hook: AbilityHook): void {
    this.registries.hooks.register(hookId, hook);
  }

  /**
   * Install the {@link ISpatialQuery} adapter that the resolver uses for
   * `TargetSpec.kind === 'Radius'` and {@link applyEffectAoE}. The
   * adapter is a thin wrapper over the user's spatial index (typically
   * `SpatialHashGrid` in `phalanx-physics`); the package itself stays
   * physics-free.
   *
   * Registration is a one-shot world-bootstrap step. Re-registering the
   * same query replaces the previous one — useful for tests that swap
   * the implementation. Callers wanting to detect a missing setup can
   * read {@link AbilitySystemRegistries.spatialQuery} directly.
   */
  public registerSpatialQuery(query: ISpatialQuery): void {
    this.registries.spatialQuery = query;
  }

  // -----------------------------------------------------------------------
  // Tags
  // -----------------------------------------------------------------------

  public hasTag(entityId: number, tag: string): boolean {
    const entity = this.entityManager.getEntity(entityId);
    if (!entity) {
      return false;
    }
    const tags = entity.getComponent<GameplayTagsComponent>(AbilitiesComponentType.GameplayTags);
    if (!tags) {
      return false;
    }
    return tags.tags.has(tag);
  }

  /**
   * Add an ad-hoc tag to an entity, outside the effect-driven grant lifecycle.
   *
   * Intended for setup code (team / faction tags assigned at spawn). For
   * lifecycle-managed state tags, prefer `tagsGranted` on an effect so the
   * tag is automatically revoked when the effect expires.
   *
   * Ad-hoc and effect-granted ownership are tracked separately: adding the
   * same tag both ways is safe and idempotent. The tag survives until both
   * sources release it.
   */
  public addTag(entityId: number, tag: string): void {
    const entity = this.requireEntity(entityId);
    const tags = this.getOrCreateTags(entity);
    tags.adHocTags.add(tag);
    tags.tags.add(tag);
  }

  /**
   * Remove ad-hoc ownership of `tag`. If the tag is still granted by one or
   * more active effects, it remains in {@link GameplayTagsComponent.tags}
   * (and {@link hasTag} keeps returning `true`) until the last grant expires.
   * For predictable removal of effect-granted tags use
   * {@link removeEffectsByTag}.
   *
   * Returns `true` if ad-hoc ownership was actually cleared, `false` if the
   * entity / component is missing or the tag was not held ad hoc.
   */
  public removeTag(entityId: number, tag: string): boolean {
    const entity = this.entityManager.getEntity(entityId);
    if (!entity) {
      return false;
    }
    const tags = entity.getComponent<GameplayTagsComponent>(AbilitiesComponentType.GameplayTags);
    if (!tags) {
      return false;
    }
    const wasAdHoc = tags.adHocTags.delete(tag);
    if (!wasAdHoc) {
      return false;
    }
    // Only drop from the unified set when no active effect still grants it.
    const grantCount = tags.effectGrantCounts.get(tag) ?? 0;
    if (grantCount === 0) {
      tags.tags.delete(tag);
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Auras
  // -----------------------------------------------------------------------

  /**
   * Spawn a persistent aura zone — a new entity bearing an
   * {@link AuraComponent} that re-resolves its target spec and applies
   * its effects every `periodTicks`. Returns the freshly allocated zone
   * entity so the caller can position it (e.g. register it with their
   * spatial index, set transform, attach extra components).
   *
   * Lifecycle is tag-driven: when `params.lifetimeEffectId` is provided
   * the zone entity also receives that `Duration`-typed effect on
   * spawn, granting `params.lifetimeTag`. {@link AuraTickSystem} watches
   * the tag — when it disappears (because the effect expired naturally
   * or because user code force-removed it via
   * {@link removeEffectsByTag}), the zone entity is despawned on the
   * next aura tick. Leaving `lifetimeEffectId` undefined skips the
   * lifetime effect entirely; the aura then persists until the caller
   * removes the entity directly. The system then has no tag to watch,
   * which is exactly what users of "manually managed" auras want.
   *
   * Determinism: spawning an entity here uses {@link Entity}'s shared
   * id counter — every peer creating an aura on the same tick gets the
   * same id sequence (which is exactly why lockstep replay requires
   * `resetEntityIdCounter()` at game start). The first aura tick fires
   * on `currentTick + 1` so it lines up with the standard "writes
   * enqueue this tick, system observes them next tick" discipline used
   * by `applyEffect`. Hooks that spawn auras should call this method
   * directly inside the hook callback — they then observe the zone
   * starting to fire on the tick after activation.
   */
  public spawnAura(params: {
    abilityId: string;
    target: TargetSpec;
    effectIds: readonly string[];
    periodTicks: number;
    ownerEntityId: number;
    lifetimeEffectId?: string;
    lifetimeTag?: string;
    /**
     * Stage 7.1. Pass `false` to spawn the aura in a dormant state
     * (component attached, but no fires until
     * {@link setAuraActive} flips it back on). Defaults to `true`.
     */
    isActive?: boolean;
    /**
     * Stage 7.1. If set, the aura fires only while the carrier entity
     * (the zone) has this gameplay tag. Composes with `isActive` via
     * AND: both gates must pass for a fire to occur.
     */
    requiredTag?: string;
  }): Entity {
    // ---------------------------------------------------------------
    // Validation phase. All checks happen BEFORE the zone entity is
    // created so a thrown error never leaves a zombie entity behind in
    // the world (Copilot review #36, line 550). The two phases are:
    //   (a) registry + effect-shape checks against `params`,
    //   (b) AuraComponent construction (shape checks: periodTicks ≥ 1,
    //       non-empty effectIds, requiredTag non-empty if present).
    // Only after both phases succeed do we call entityManager.addEntity.
    // ---------------------------------------------------------------

    // (a1) Every effect id must exist in the registry. Otherwise the
    // first fire would throw deep inside AuraTickSystem and the user
    // would lose the spawn-site context.
    for (const effectId of params.effectIds) {
      if (!this.registries.effects.has(effectId)) {
        throw new Error(
          `EffectRegistry does not contain '${effectId}' (referenced by aura '${params.abilityId}')`
        );
      }
    }

    // (a2) Aura effects must be `Instant` (see AuraComponent JSDoc).
    // Duration/Periodic effects re-applied every period would compound:
    // each fire would push a new active-effect instance onto the
    // target, and `tagsGranted` would accumulate without bound. Reject
    // at spawn time so the misconfiguration surfaces here, not as a
    // mysterious memory leak hours into a session (Copilot review #36,
    // line 541).
    for (const effectId of params.effectIds) {
      const def = this.registries.effects.get(effectId);
      if (def.type !== 'Instant') {
        throw new Error(
          `Aura '${params.abilityId}' references non-Instant effect '${effectId}' ` +
            `(type='${def.type}'). Aura effects must be Instant — Duration/Periodic ` +
            `effects would stack new instances every aura fire.`
        );
      }
    }

    // (a3) Lifetime effect, if configured, must exist AND must actually
    // grant `lifetimeTag` (Copilot review #36, line 546). If the user
    // configures a `lifetimeEffectId` without a `lifetimeTag` the aura
    // would persist forever despite the user's evident intent to gate
    // it on the effect. If they configure both but the effect's
    // `tagsGranted` does not include `lifetimeTag`, the aura would
    // despawn on its very first tick because the watched tag is never
    // present. Both are silent footguns; reject up front.
    if (params.lifetimeEffectId !== undefined) {
      if (!this.registries.effects.has(params.lifetimeEffectId)) {
        throw new Error(
          `EffectRegistry does not contain '${params.lifetimeEffectId}' ` +
            `(referenced as lifetimeEffectId for aura '${params.abilityId}')`
        );
      }
      if (params.lifetimeTag === undefined) {
        throw new Error(
          `Aura '${params.abilityId}' configures lifetimeEffectId='${params.lifetimeEffectId}' ` +
            `but no lifetimeTag. The lifetime effect must grant a tag that AuraTickSystem ` +
            `watches — pass both fields together or omit both.`
        );
      }
      const lifetimeDef = this.registries.effects.get(params.lifetimeEffectId);
      const grantsTag =
        lifetimeDef.tagsGranted !== undefined &&
        lifetimeDef.tagsGranted.includes(params.lifetimeTag);
      if (!grantsTag) {
        throw new Error(
          `Aura '${params.abilityId}' lifetimeEffectId='${params.lifetimeEffectId}' ` +
            `does not grant lifetimeTag='${params.lifetimeTag}' (effect.tagsGranted=` +
            `${JSON.stringify(lifetimeDef.tagsGranted ?? [])}). The lifetime effect must ` +
            `grant the watched tag, otherwise the aura would despawn on its first tick.`
        );
      }
    } else if (params.lifetimeTag !== undefined) {
      // The reverse pairing — lifetimeTag without lifetimeEffectId —
      // is the legitimate "caller is managing the tag manually" path.
      // We do not reject it: callers may want to grant the tag via
      // applyEffect / addTag after spawnAura returns. This is
      // documented in the lifetimeTag JSDoc.
    }

    // First fire scheduled for currentTick + 1 so an aura spawned by a
    // hook on tick N fires for the first time on tick N+1, matching the
    // "writes are visible next tick" convention. `currentTick` is -1
    // during world bootstrap (before the first processTick); offsetting
    // by +1 yields 0 there, which is the first real simulation tick.
    const nextTick = this.runtime.currentTick + 1;

    // (b) Construct the component. Its constructor enforces remaining
    // shape invariants (periodTicks, effectIds non-empty, requiredTag
    // non-empty). If any throw, we've still not touched the world.
    const aura = new AuraComponent(
      params.abilityId,
      params.target,
      params.effectIds,
      params.periodTicks,
      nextTick,
      params.ownerEntityId,
      params.lifetimeTag,
      {
        isActive: params.isActive,
        requiredTag: params.requiredTag,
      }
    );

    // ---------------------------------------------------------------
    // Mutation phase. From here, every step succeeds or the function
    // returns; nothing below throws.
    // ---------------------------------------------------------------
    const zone = new Entity();
    this.entityManager.addEntity(zone);
    zone.addComponent(aura);
    this.entityManager.onComponentAdded(zone, aura.type);

    if (params.lifetimeEffectId !== undefined) {
      // Apply the lifetime effect through the standard pendingAdd path
      // so the tag is granted by EffectApplicationSystem on the same
      // tick the aura first fires — keeping the tag-grant and the
      // first fire in lockstep. Without this, AuraTickSystem could
      // observe the aura on tick N+1 *before* the lifetime tag has
      // been granted, triggering the lifecycle-end despawn path on
      // its very first tick.
      const activeEffects = this.getOrCreateActiveEffects(zone);
      activeEffects.pendingAdd.push({
        defId: params.lifetimeEffectId,
        sourceEntityId: params.ownerEntityId,
      });
    }

    return zone;
  }

  /**
   * Toggle the imperative activation flag on an aura carrier (Stage 7.1).
   *
   * The carrier entity must already have an {@link AuraComponent}. While
   * `active` is `false`, {@link AuraTickSystem} skips the period check
   * for this aura without advancing `nextTick`.
   *
   * Cadence on reactivation:
   *  - **Default (`resetSchedule` unset or `false`):** when the gate
   *    reopens, `nextTick` is still where it was at pause time. If the
   *    pause spanned several periods, the standard period check fires
   *    ONCE per missed period on the reactivation tick (catch-up
   *    while-loop). This is the right default for short pauses where
   *    "pay back what we missed" is intuitive (e.g. a one-tick stun).
   *  - **`resetSchedule: true`:** sets `nextTick = currentTick +
   *    periodTicks` at the moment of reactivation, so the next fire
   *    happens one full period from now. This is the right choice for
   *    long pauses (player toggled the aura off for 30 seconds) where
   *    a catch-up burst would be undesirable, and is the only way to
   *    avoid the catch-up under the imperative gate. NOTE: the
   *    declarative `requiredTag` gate has no equivalent opt-out —
   *    authors driving activation purely through tags must either
   *    accept catch-up or manage `nextTick` themselves alongside the
   *    tag flip.
   *
   * Intended use cases:
   *  - Player toggles a channeled aura on/off with a hotkey.
   *  - A charge-based system disables the aura when charges hit zero
   *    and re-enables when they recharge.
   *  - Test code wants to deterministically pause a specific aura
   *    without grafting in a `requiredTag` just for that purpose.
   *
   * For data-driven suppression (silence, polymorph, anti-magic) prefer
   * {@link AuraComponent.requiredTag} + the existing tag tooling — it
   * composes naturally across multiple suppression sources, which a
   * single boolean cannot.
   *
   * @param entityId Carrier entity. Must currently have an AuraComponent;
   *   throws otherwise so the bug surfaces at the call site rather than
   *   silently no-op'ing.
   * @param active Target value for the activation flag.
   * @param options Optional. Pass `{ resetSchedule: true }` to also set
   *   `nextTick = currentTick + periodTicks` so the first post-reactivation
   *   fire is a full period in the future — suppressing catch-up after
   *   long pauses. Defaults to `false`, which preserves `nextTick` and
   *   produces one catch-up fire per missed period on reactivation. Has
   *   no effect when `active === false`.
   */
  public setAuraActive(
    entityId: number,
    active: boolean,
    options?: { readonly resetSchedule?: boolean }
  ): void {
    const entity = this.requireEntity(entityId);
    const aura = entity.getComponent<AuraComponent>(AbilitiesComponentType.Aura);
    if (!aura) {
      throw new Error(
        `setAuraActive: entity ${entityId} has no AuraComponent`
      );
    }
    aura.isActive = active;
    if (active && options?.resetSchedule === true) {
      // Schedule the next fire one full period out from "now" so the
      // first post-reactivation fire feels like a fresh start. We do
      // NOT fire on the next tick, because that would let a player
      // exploit toggle-off/toggle-on to fire faster than `periodTicks`.
      aura.nextTick = this.runtime.currentTick + aura.periodTicks;
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Exposed for tests and downstream packages that need to allocate
   * `instanceId`s consistent with this world's counter (e.g. a future
   * `phalanx-projectiles` package that wants to apply effects through the
   * same FIFO ordering). Not for general use.
   */
  public get runtimeInternal(): AbilitySystemRuntime {
    return this.runtime;
  }

  /**
   * Lazy singleton resolver. Stateless apart from its captured
   * `entityManager` + `registries` pair; constructed on first use so
   * tests that never touch AoE pay no allocation cost.
   */
  private targetResolver: TargetResolver | undefined;

  private getTargetResolver(): TargetResolver {
    if (!this.targetResolver) {
      this.targetResolver = new TargetResolver(this.entityManager, this.registries);
    }
    return this.targetResolver;
  }

  public get gameplayCueBufferInternal(): GameplayCueBuffer {
    return this.runtime.gameplayCueBuffer;
  }

  private requireEntity(entityId: number): Entity {
    const entity = this.entityManager.getEntity(entityId);
    if (!entity) {
      throw new Error(`Entity ${entityId} does not exist`);
    }
    return entity;
  }

  private getOrCreateActiveEffects(entity: Entity): ActiveEffectsComponent {
    const existing = entity.getComponent<ActiveEffectsComponent>(
      AbilitiesComponentType.ActiveEffects
    );
    if (existing) {
      return existing;
    }
    const component = new ActiveEffectsComponent();
    entity.addComponent(component);
    this.entityManager.onComponentAdded(entity, component.type);
    return component;
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
