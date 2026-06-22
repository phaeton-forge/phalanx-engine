import { Entity, type EntityManager } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import type { FixedPoint } from 'phalanx-math';
import {
  ActiveEffectsComponent,
  AttributesComponent,
  GameplayTagsComponent,
  getActiveEffectsComponent,
  getAttributesComponent,
  getGameplayTagsComponent,
} from '../components';
import type { AbilitySystemRegistries } from '../registry';
import type { AbilitySystemRuntime, GameplayCueBufferView } from '../runtime';
import type { AbilityHook, ProvidedTarget } from '../types';

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

    const existing = getAttributesComponent(entity);

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
      if (!getAttributesComponent(entity)) {
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

    const attributes = getAttributesComponent(entity);
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
    const activeEffects = getActiveEffectsComponent(entity);
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
    const activeEffects = getActiveEffectsComponent(entity);
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
   * projectiles, rockets) and write into the physics package; the
   * resulting state is observable on the next tick.
   *
   * Throws if `hookId` is already registered. Registration is a one-shot
   * setup step done at world boot.
   */
  public registerHook(hookId: string, hook: AbilityHook): void {
    this.registries.hooks.register(hookId, hook);
  }

  // -----------------------------------------------------------------------
  // Tags
  // -----------------------------------------------------------------------

  public hasTag(entityId: number, tag: string): boolean {
    const entity = this.entityManager.getEntity(entityId);
    if (!entity) {
      return false;
    }
    const tags = getGameplayTagsComponent(entity);
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
    const tags = getGameplayTagsComponent(entity);
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
   * Read-only view of this world's gameplay cue buffer for tests and debug
   * tooling that need to inspect cues before {@link CueBufferCleanupSystem}
   * clears them. Not for general gameplay code; cue listeners should subscribe
   * through {@link CueDispatchSystem} instead of mutating this deterministic
   * runtime buffer directly.
   */
  public get gameplayCueBufferInternal(): GameplayCueBufferView {
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
    const existing = getActiveEffectsComponent(entity);
    if (existing) {
      return existing;
    }
    const component = new ActiveEffectsComponent();
    entity.addComponent(component);
    this.entityManager.onComponentAdded(entity, component.type);
    return component;
  }

  private getOrCreateTags(entity: Entity): GameplayTagsComponent {
    const existing = getGameplayTagsComponent(entity);
    if (existing) {
      return existing;
    }
    const tags = new GameplayTagsComponent();
    entity.addComponent(tags);
    this.entityManager.onComponentAdded(entity, tags.type);
    return tags;
  }
}
