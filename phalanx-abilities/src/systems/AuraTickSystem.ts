import { GameSystem } from 'phalanx-ecs';
import type { Entity } from 'phalanx-ecs';
import {
  AbilitiesComponentType,
  ActiveEffectsComponent,
  AuraComponent,
  GameplayTagsComponent,
  getActiveEffectsComponent,
  getGameplayTagsComponent,
} from '../components';
import type { AbilitySystemRegistries } from '../registry';
import type { AbilitySystemRuntime } from '../runtime';
import { TargetResolver } from '../targeting';

/**
 * Per-tick driver for {@link AuraComponent}-bearing zone entities.
 *
 * For every aura entity, on every tick:
 *
 *  1. **Lifecycle check.** If the aura declared a {@link AuraComponent.lifetimeTag}
 *     and that tag is no longer present on the zone entity, the entity is
 *     removed from the world. The tag may have been revoked because the
 *     `Duration`-typed lifetime effect expired in {@link EffectTickSystem}
 *     earlier this tick, or because user code called
 *     `removeEffectsByTag` on the zone. Either way the system reacts on
 *     the SAME tick — never one tick late — so observers do not see a
 *     "ghost period" where the aura kept firing after its tag was
 *     revoked. Removal happens BEFORE the period check so an aura whose
 *     `nextTick` happens to coincide with its lifetime expiry tick fires
 *     zero (not one) extra time at the boundary.
 *
 *  2. **Activation gates** (Stage 7.1). If {@link AuraComponent.isActive}
 *     is `false`, or {@link AuraComponent.requiredTag} is configured and
 *     the carrier entity does not currently have that tag, the period
 *     check is skipped WITHOUT advancing `nextTick`. Both gates are
 *     independent and compose with AND.
 *
 *     Cadence interaction with catch-up: while the gate is closed,
 *     `nextTick` is frozen. When the gate opens, the standard period
 *     check in step 3 below runs against the (potentially in-the-past)
 *     `nextTick`, and its `while (tick >= nextTick)` catch-up loop
 *     fires ONCE for every missed period before draining. So a gate
 *     that was closed for N periods produces a burst of N catch-up
 *     fires on the tick it reopens (matching `EffectTickSystem`'s
 *     periodic catch-up semantics). Callers that need fresh-schedule
 *     behaviour on reactivation should use
 *     {@link AbilitySystemFacade.setAuraActive}'s `resetSchedule: true`
 *     option, which sets `nextTick = currentTick + periodTicks` at
 *     reactivation time — there is no equivalent for tag-driven gates,
 *     so authors driving activation purely through `requiredTag`
 *     should design their period to make the catch-up acceptable (or
 *     manage `nextTick` themselves alongside the tag flip).
 *
 *  3. **Period check.** If `currentTick >= nextTick`, the aura fires.
 *     Targets are re-resolved fresh every period via {@link TargetResolver}
 *     — auras intentionally do NOT cache target lists, so entities that
 *     walk in or out of the radius between periods are picked up/dropped
 *     deterministically. Each resolved target receives every effect in
 *     {@link AuraComponent.effectIds}, applied via the standard
 *     {@link ActiveEffectsComponent.pendingAdd} path so the effect lands
 *     through {@link EffectApplicationSystem} on the next tick (one-tick
 *     latency, identical to {@link AbilitySystemFacade.applyEffect}).
 *
 *     `nextTick` is advanced by `periodTicks` after firing. A `while` loop
 *     handles catch-up firings in the (misconfigured / time-warp) case
 *     where the tick has jumped ahead by more than one period, mirroring
 *     {@link EffectTickSystem}'s firePeriodics catch-up loop.
 *
 * Determinism:
 *  - Aura entities are iterated in `entityManager.queryEntities` order,
 *    which is entity-id ASC. Two aura zones firing on the same tick fire
 *    in id order.
 *  - The resolver's own determinism rules apply per fire (sorted by
 *    entity-id, dedup, maxTargets after sort, etc.).
 *  - Effect-application ordering across multiple resolved targets follows
 *    `effectIds` array order, then target order from the resolver. Same
 *    inputs → same `pendingAdd` queue contents.
 *
 * The system itself never mutates `AuraComponent` apart from advancing
 * `nextTick`, and never reads `Date.now` / `Math.random`. Hook authors who
 * spawn auras must respect the same rules.
 */
export class AuraTickSystem extends GameSystem {
  /**
   * Lazy resolver, instantiated on first fire. Stateless apart from its
   * captured `entityManager`+`registries` pair, so a single instance can
   * be reused across all aura entities.
   */
  private resolver: TargetResolver | undefined;

  public constructor(
    private readonly registries: AbilitySystemRegistries,
    private readonly runtime: AbilitySystemRuntime
  ) {
    super();
  }

  public override processTick(tick: number): void {
    // Keep the runtime tick in sync. Facade methods called between ticks
    // (notably `spawnAura`, which schedules its first fire at
    // `currentTick + 1`) read this field, so it must reflect the most
    // recently processed tick even when AbilityActivationSystem is not
    // registered alongside us.
    this.runtime.currentTick = tick;

    const entities = this.entityManager.queryEntities(AbilitiesComponentType.Aura);
    if (entities.length === 0) {
      return;
    }

    // Snapshot the candidate list before mutating the entity manager. The
    // lifecycle pass below removes expired auras, which would corrupt a
    // live iterator over the component index. queryEntities already
    // returns a fresh array (sorted by entityId ASC), so iterating it
    // while removing from the underlying index is safe.
    for (const entity of entities) {
      const aura = entity.getComponent<AuraComponent>(AbilitiesComponentType.Aura);
      if (!aura) {
        // Defensive: queryEntities returned an entity whose component was
        // removed between the index query and now (e.g. by a prior aura
        // firing in this same loop that despawned a neighbour). Skip.
        continue;
      }

      if (this.expireIfLifetimeEnded(entity, aura)) {
        continue;
      }

      if (!this.isActivationGateOpen(entity, aura)) {
        // Activation gates pause the aura WITHOUT advancing nextTick, so
        // toggling activation back on resumes the original cadence rather
        // than catching up missed fires. Skip the period check entirely.
        continue;
      }

      this.fireIfDue(entity, aura, tick);
    }
  }

  /**
   * Check the activation gates introduced in Stage 7.1. Returns `true`
   * when the aura is allowed to fire this tick.
   *
   * Two gates, both must pass:
   *  - {@link AuraComponent.isActive} — imperative on/off, mutated via
   *    {@link AbilitySystemFacade.setAuraActive}.
   *  - {@link AuraComponent.requiredTag} — if set, the carrier entity
   *    must currently have that gameplay tag. A missing tags component
   *    counts as "tag absent".
   *
   * Both gates short-circuit the period check rather than advancing
   * `nextTick`. When the gate reopens, the standard period check
   * fires ONCE per missed period via its `while (tick >= nextTick)`
   * catch-up loop — callers that prefer fresh-schedule behaviour over
   * catch-up should use {@link AbilitySystemFacade.setAuraActive}'s
   * `resetSchedule: true` option (applies to the imperative gate;
   * tag-driven gates have no equivalent and authors should design
   * `periodTicks` so the catch-up is acceptable).
   */
  private isActivationGateOpen(entity: Entity, aura: AuraComponent): boolean {
    if (!aura.isActive) {
      return false;
    }
    const requiredTag = aura.requiredTag;
    if (requiredTag === undefined) {
      return true;
    }
    const tags = getGameplayTagsComponent(entity);
    if (!tags) {
      return false;
    }
    return tags.tags.has(requiredTag);
  }

  /**
   * Check the lifetime tag. Returns `true` if the aura was removed, in
   * which case the caller must skip the period check — the entity is
   * gone.
   *
   * When no `lifetimeTag` was configured the aura persists indefinitely
   * (until user code removes its entity directly), and this method is a
   * cheap no-op.
   */
  private expireIfLifetimeEnded(entity: Entity, aura: AuraComponent): boolean {
    const lifetimeTag = aura.lifetimeTag;
    if (lifetimeTag === undefined) {
      return false;
    }
    const tags = getGameplayTagsComponent(entity);
    if (tags && tags.tags.has(lifetimeTag)) {
      return false;
    }
    // Lifetime tag is missing: either the granting Duration effect
    // expired earlier this tick (in EffectTickSystem), or user code
    // force-removed it. Despawn the zone.
    this.entityManager.removeEntity(entity);
    return true;
  }

  /**
   * Apply the aura's effects to every resolved target if `currentTick`
   * has reached `nextTick`. `nextTick` is advanced by `periodTicks` per
   * fire so the schedule remains deterministic regardless of when the
   * system observes the tick.
   */
  private fireIfDue(entity: Entity, aura: AuraComponent, tick: number): void {
    if (tick < aura.nextTick) {
      return;
    }

    while (tick >= aura.nextTick) {
      this.fireOnce(entity, aura);
      aura.nextTick += aura.periodTicks;
    }
  }

  private fireOnce(entity: Entity, aura: AuraComponent): void {
    const resolver = this.getResolver();
    const resolution = resolver.resolve({
      casterEntityId: entity.id,
      spec: aura.target,
    });
    // The aura spec never has `TargetOrigin.kind === 'Caller'` — that
    // origin requires runtime `providedTarget` input which the system
    // does not have. A misconfigured spec is a programming error; surface
    // it loudly instead of silently dropping the periodic.
    if (resolution.dropped) {
      throw new Error(
        `AuraComponent (abilityId='${aura.abilityId}') resolved to dropped: ` +
          'auras must not use TargetOrigin.kind === "Caller". Use TargetEntity, ' +
          'Caster, or Point instead.'
      );
    }

    const targets = resolution.targets;
    if (targets.length === 0) {
      return;
    }

    for (const effectId of aura.effectIds) {
      if (!this.registries.effects.has(effectId)) {
        // The aura was spawned referencing an effect that no longer
        // exists in the registry. Definitions are meant to be
        // world-immutable, so this is a bug rather than a runtime miss.
        throw new Error(
          `AuraComponent.effectIds references unknown effect '${effectId}' ` +
            `(abilityId='${aura.abilityId}')`
        );
      }
      for (const targetId of targets) {
        const targetEntity = this.entityManager.getEntity(targetId);
        if (!targetEntity) {
          // Stale id returned by the resolver: target was removed
          // between the resolve and the enqueue. Same handling as
          // applyEffectAoE — silently skip.
          continue;
        }
        let activeEffects = getActiveEffectsComponent(targetEntity);
        if (!activeEffects) {
          activeEffects = new ActiveEffectsComponent();
          targetEntity.addComponent(activeEffects);
          this.entityManager.onComponentAdded(targetEntity, activeEffects.type);
        }
        activeEffects.pendingAdd.push({
          defId: effectId,
          sourceEntityId: aura.ownerEntityId,
        });
      }
    }
  }

  private getResolver(): TargetResolver {
    if (!this.resolver) {
      this.resolver = new TargetResolver(this.entityManager, this.registries);
    }
    return this.resolver;
  }
}
