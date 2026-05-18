import type { Entity, EntityManager } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import type { FixedPoint } from 'phalanx-math';
import {
  AbilitiesComponentType,
  ActiveEffectsComponent,
  AttributesComponent,
  GameplayTagsComponent,
} from '../components';
import type { AbilitySystemRegistries } from '../registry';
import type { AbilitySystemRuntime } from '../runtime';

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
   */
  public addTag(entityId: number, tag: string): void {
    const entity = this.requireEntity(entityId);
    const tags = this.getOrCreateTags(entity);
    tags.tags.add(tag);
  }

  /**
   * Remove an ad-hoc tag. Note: this does NOT remove tags that are
   * currently granted by an active effect — those will be re-granted on
   * the next {@link EffectApplicationSystem} pass (today, application is
   * one-shot from pendingAdd, so a re-grant requires a fresh applyEffect;
   * see Stage 5 for grant-on-tick semantics). For predictable removal
   * use {@link removeEffectsByTag}.
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
    return tags.tags.delete(tag);
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
