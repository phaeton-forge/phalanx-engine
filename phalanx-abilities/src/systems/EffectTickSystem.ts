import { GameSystem } from 'phalanx-ecs';
import type { Entity } from 'phalanx-ecs';
import {
  AbilitiesComponentType,
  ActiveEffectsComponent,
  AttributesComponent,
  GameplayTagsComponent,
} from '../components';
import type { AbilitySystemRegistries } from '../registry';
import type { ActiveEffectInstance, EffectDef } from '../types';

/**
 * Per-tick lifecycle for `Duration` (and, from Stage 4, `Periodic`) effects.
 *
 * Stage 3 responsibilities:
 *  - Decrement `remainingTicks` on every queued `ActiveEffectInstance`.
 *  - Remove expired instances (`remainingTicks <= 0`).
 *  - On removal:
 *      * revoke `tagsGranted` from the target's
 *        {@link GameplayTagsComponent}, but only when no other still-active
 *        instance grants the same tag (set semantics: a tag is "on" while
 *        any granter is present);
 *      * mark every attribute referenced by the removed effect's
 *        modifiers dirty, so {@link AttributeAggregationSystem}
 *        recomputes `current` without the expired modifier on the same
 *        tick (system order: this system runs before aggregation).
 *
 * Removals queued by `removeEffectsByTag` / `removeEffectsByDefId` flow
 * through this same path: the facade sets `remainingTicks = 0` on the
 * targeted instance(s); this system then handles revocation in tick order.
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

    // First pass: countdown.
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

    // Second pass: extract expired and compact the queue, preserving order.
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

  private revokeTags(
    effectDef: EffectDef,
    tags: GameplayTagsComponent | undefined,
    remainingQueue: readonly ActiveEffectInstance[]
  ): void {
    if (!tags || !effectDef.tagsGranted || effectDef.tagsGranted.length === 0) {
      return;
    }

    for (const grantedTag of effectDef.tagsGranted) {
      if (this.tagGrantedByAnyRemaining(grantedTag, remainingQueue)) {
        // Another still-active instance grants the same tag; keep it.
        continue;
      }
      tags.tags.delete(grantedTag);
    }
  }

  private tagGrantedByAnyRemaining(
    tag: string,
    queue: readonly ActiveEffectInstance[]
  ): boolean {
    for (let i = 0; i < queue.length; i++) {
      const def = this.registries.effects.tryGet(queue[i].defId);
      if (!def || !def.tagsGranted) {
        continue;
      }
      for (const grantedTag of def.tagsGranted) {
        if (grantedTag === tag) {
          return true;
        }
      }
    }
    return false;
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
