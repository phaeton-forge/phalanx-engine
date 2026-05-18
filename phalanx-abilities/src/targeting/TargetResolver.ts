import type { EntityManager } from 'phalanx-ecs';
import type { FixedPoint } from 'phalanx-math';
import { AbilitiesComponentType, GameplayTagsComponent } from '../components';
import type { AbilitySystemRegistries } from '../registry';
import type { ProvidedTarget, TargetFilter, TargetOrigin, TargetSpec } from '../types';

/**
 * Input to {@link TargetResolver.resolve}. Keeps the resolver self-contained
 * — every input it needs is on this record, not on a system field.
 */
export interface TargetResolutionInput {
  /**
   * The entity casting the ability. Used to resolve `TargetOrigin.kind ===
   * 'Caster'`, to evaluate `includeSelf` on `Radius`, and as the `selfId`
   * default for `applyEffectAoE` invocations that don't override it.
   */
  casterEntityId: number;
  spec: TargetSpec;
  /**
   * Caller-supplied target for `TargetOrigin.kind === 'Caller'`. May supply
   * `entityId` (for `Entity` shapes) or `x`/`z` (for `Point`/`Radius`
   * origins). When the origin kind is `Caller` and the required field is
   * missing, {@link TargetResolver.resolve} returns a `{ dropped: true }`
   * result so the caller can abort the activation cleanly.
   */
  providedTarget?: ProvidedTarget;
}

/**
 * Result of {@link TargetResolver.resolve}. The discriminated `dropped`
 * flag distinguishes between:
 *   - `{ dropped: false, targets: [...] }`: resolution succeeded. `targets`
 *     is the deterministic, possibly-empty list of affected entity ids.
 *     An empty list is a legitimate outcome (e.g. an AoE that contained
 *     no entities, or a `Point` target shape) and the activation should
 *     proceed: caster-side effects, event emission, hook scheduling.
 *   - `{ dropped: true }`: the caller forgot to supply required input
 *     (e.g. `TargetOrigin.kind === 'Caller'` on a Radius without a
 *     point). The activation must NOT enqueue cost / cooldown / self
 *     effects, must NOT emit `AbilityActivated`, and must NOT schedule
 *     hooks. This matches the documented contract that "the verdict is
 *     observed via side effects, not via `activateAbility`'s return
 *     value".
 */
export type TargetResolutionResult =
  | { dropped: false; targets: number[] }
  | { dropped: true };

/**
 * Pure resolver for {@link TargetSpec}. Owns the entire mapping from a
 * declarative spec + caller input to the deterministic ordered list of
 * affected entity ids.
 *
 * Determinism rules enforced here:
 *   1. The result is always sorted by `entityId` ASC. {@link ISpatialQuery}
 *      implementations are free to return entities in any order — the
 *      resolver normalises that.
 *   2. {@link TargetSpec.maxTargets} (Radius only) trims the sorted list,
 *      never the unsorted query result. Two peers running the same query
 *      with different internal orderings still trim to the same first-N
 *      entity ids.
 *   3. Distance is never computed here. `dx*dx + dz*dz <= r*r` is the
 *      contract of {@link ISpatialQuery.queryRadius}; the resolver trusts
 *      it. Anything beyond that (cones, boxes, LOS) is v2.
 *   4. The resolver is stateless — it never reads "the current tick" or
 *      mutates registries — so two invocations with identical inputs are
 *      byte-for-byte identical regardless of when they run.
 *
 * Used from two call sites:
 *   - {@link AbilityActivationSystem} during ability activation, where the
 *     spec comes from `AbilityDef.target` and the caller is the user that
 *     invoked `activateAbility`.
 *   - {@link AbilitySystemFacade.applyEffectAoE} for the short-circuit
 *     "explode here, ignore the ability layer" path (rockets on impact,
 *     environment hazards, etc.). That path always passes a synthetic
 *     `Radius` spec — it never needs to resolve `Self`/`Entity`/`Point`.
 */
export class TargetResolver {
  public constructor(
    private readonly entityManager: EntityManager,
    private readonly registries: AbilitySystemRegistries
  ) {}

  /**
   * Sentinel value for the "drop activation" outcome. Reused across calls
   * so the system path can compare by reference.
   */
  private static readonly DROPPED: TargetResolutionResult = { dropped: true };

  public resolve(input: TargetResolutionInput): TargetResolutionResult {
    const { spec } = input;
    switch (spec.kind) {
      case 'Self':
        return { dropped: false, targets: [input.casterEntityId] };
      case 'Entity': {
        const resolved = this.resolveEntityOrigin(
          input.casterEntityId,
          spec.origin,
          input.providedTarget
        );
        if (resolved.dropped) {
          return TargetResolver.DROPPED;
        }
        if (resolved.entityId === undefined) {
          // Legitimate "no target" — e.g. TargetEntity origin pointing
          // at an id that's no longer present. We continue the
          // activation: the caster pays the cost, the hook fires with
          // an empty target list.
          return { dropped: false, targets: [] };
        }
        return { dropped: false, targets: [resolved.entityId] };
      }
      case 'Point': {
        // A Point target intentionally resolves to zero entities. The point
        // itself is consumed by ability hooks via providedTarget (or by
        // user code reading AbilityActivationContext). `targetEffectIds`
        // on a Point-targeted ability is therefore a no-op — that is
        // expected: damage/heal is applied by the rocket/projectile hook
        // on impact via `applyEffectAoE`, not by the ability's
        // target-effects pipeline.
        //
        // However, when the origin is `Caller` the caller MUST supply a
        // point — otherwise the hook has no impact location and the
        // activation should drop. Other origins (Point, Caster,
        // TargetEntity) carry the point inside the spec itself.
        if (spec.origin.kind === 'Caller') {
          const provided = input.providedTarget;
          if (!provided || provided.x === undefined || provided.z === undefined) {
            return TargetResolver.DROPPED;
          }
        }
        return { dropped: false, targets: [] };
      }
      case 'Radius':
        return this.resolveRadius(input);
    }
  }

  // ---------------------------------------------------------------------------
  // Radius (the heavy path)
  // ---------------------------------------------------------------------------

  private resolveRadius(input: TargetResolutionInput): TargetResolutionResult {
    const spec = input.spec as Extract<TargetSpec, { kind: 'Radius' }>;
    const originResult = this.resolveRadiusOrigin(input, spec.origin);
    if (originResult.dropped) {
      return TargetResolver.DROPPED;
    }
    const center = originResult.center;

    const spatial = this.registries.spatialQuery;
    if (!spatial) {
      throw new Error(
        "TargetSpec.kind === 'Radius' requires a spatial query. " +
          'Call AbilitySystemFacade.registerSpatialQuery(...) at world bootstrap.'
      );
    }

    const raw = spatial.queryRadius(center.x, center.z, spec.radius);

    // Deduplicate, then sort by entityId ASC. We dedupe BEFORE sorting so
    // misbehaving spatial implementations that return the same entity
    // twice (e.g. multi-cell membership in a hash grid) cannot corrupt
    // the deterministic ordering or burn a maxTargets slot per duplicate.
    const seen = new Set<number>();
    const buf: number[] = [];
    for (const id of raw) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      buf.push(id);
    }
    buf.sort((a, b) => a - b);

    // Apply self filtering. `includeSelf` defaults to false so that an
    // ability that says "deal damage to enemies in a radius" does not
    // accidentally hit the caster when the caster sits inside its own
    // query disc. Set to `true` for buffs / heals that the caster wants
    // to benefit from.
    const includeSelf = spec.includeSelf === true;
    const casterId = input.casterEntityId;

    // Apply tag filter. This is done AFTER the spatial query so the
    // physics package never has to know about gameplay tags — its
    // contract stays purely geometric.
    const filter = spec.filter;

    // `maxTargets === 0` and negative values are treated as "resolve no
    // targets at all". Guarding up front keeps the main loop simple and
    // avoids the `>= limit` pre-decrement edge case where we'd otherwise
    // push one entity before breaking on `1 >= 0`.
    const limit = spec.maxTargets;
    if (limit !== undefined && limit <= 0) {
      return { dropped: false, targets: [] };
    }

    const out: number[] = [];
    for (let i = 0; i < buf.length; i++) {
      const id = buf[i];
      if (!includeSelf && id === casterId) {
        continue;
      }
      // Drop stale ids unconditionally — even when no filter is set, the
      // resolver's contract is to return real entities only. Without this
      // check, callers like `applyEffectAoE` would see ghost ids in the
      // returned list and enqueue logic would have to dedupe per-call.
      if (!this.entityManager.getEntity(id)) {
        continue;
      }
      if (filter && !this.passesFilter(id, filter)) {
        continue;
      }
      out.push(id);
      if (limit !== undefined && out.length >= limit) {
        break;
      }
    }
    return { dropped: false, targets: out };
  }

  // ---------------------------------------------------------------------------
  // Origin resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolve an `Entity`-shape origin to a single target entity id, or a
   * drop signal if the caller forgot to supply required input.
   *
   * `entityId: undefined` (with `dropped: false`) is a legitimate "target
   * resolved but to nothing" outcome — currently unreachable here, but
   * preserved so the call site can distinguish the empty case from the
   * drop case in future origin kinds.
   */
  private resolveEntityOrigin(
    casterId: number,
    origin: TargetOrigin,
    providedTarget: ProvidedTarget | undefined
  ): { dropped: false; entityId: number | undefined } | { dropped: true } {
    switch (origin.kind) {
      case 'Caster':
        return { dropped: false, entityId: casterId };
      case 'TargetEntity':
        return { dropped: false, entityId: origin.entityId };
      case 'Caller':
        if (providedTarget?.entityId === undefined) {
          // Caller forgot to supply a target entity — drop the activation.
          return { dropped: true };
        }
        return { dropped: false, entityId: providedTarget.entityId };
      case 'Point':
        // `Point` origin is meaningful only for `Radius`/`Point` target
        // shapes; using it as an `Entity` origin is a programming
        // error, not a runtime miss.
        throw new Error(
          "TargetOrigin.kind === 'Point' is not valid for TargetSpec.kind === 'Entity'."
        );
    }
  }

  /**
   * Resolve a `Radius`-shape origin to a center point, or signal a drop.
   *
   * The `dropped: true` outcome corresponds to a Caller origin without a
   * point provided. All other failure modes (missing spatial query, no
   * position for an entity) throw rather than drop — they are
   * misconfigurations, not legitimate runtime states.
   */
  private resolveRadiusOrigin(
    input: TargetResolutionInput,
    origin: TargetOrigin
  ):
    | { dropped: false; center: { x: FixedPoint; z: FixedPoint } }
    | { dropped: true } {
    switch (origin.kind) {
      case 'Caster': {
        const pos = this.tryGetEntityPosition(input.casterEntityId);
        if (!pos) {
          throw new Error(
            `TargetSpec.kind === 'Radius' with origin 'Caster' requires the caster ` +
              `(entity ${input.casterEntityId}) to have a position. The registered ` +
              `ISpatialQuery must implement getEntityPosition(entityId) and return a ` +
              `position for this entity, or the ability must use TargetOrigin.kind === 'Point'.`
          );
        }
        return { dropped: false, center: pos };
      }
      case 'TargetEntity': {
        const pos = this.tryGetEntityPosition(origin.entityId);
        if (!pos) {
          throw new Error(
            `TargetSpec.kind === 'Radius' with origin 'TargetEntity' requires the target ` +
              `(entity ${origin.entityId}) to have a position. The registered ` +
              `ISpatialQuery must implement getEntityPosition(entityId) and return a ` +
              `position for this entity.`
          );
        }
        return { dropped: false, center: pos };
      }
      case 'Point':
        return { dropped: false, center: { x: origin.x, z: origin.z } };
      case 'Caller': {
        const providedTarget = input.providedTarget;
        if (!providedTarget || providedTarget.x === undefined || providedTarget.z === undefined) {
          return { dropped: true };
        }
        return { dropped: false, center: { x: providedTarget.x, z: providedTarget.z } };
      }
    }
  }

  /**
   * Best-effort lookup of an entity's position. `ISpatialQuery` does not
   * expose a per-entity position read in MVP — the implementation may or
   * may not have one. We therefore consult the optional
   * `getEntityPosition` extension method (duck-typed) before giving up.
   *
   * Returning `undefined` here causes the resolver to throw an actionable
   * error pointing the user at `ISpatialQuery.getEntityPosition`, instead
   * of silently dropping the activation.
   */
  private tryGetEntityPosition(
    entityId: number
  ): { x: FixedPoint; z: FixedPoint } | undefined {
    const spatial = this.registries.spatialQuery;
    if (!spatial) {
      throw new Error(
        "TargetSpec.kind === 'Radius' requires a spatial query. " +
          'Call AbilitySystemFacade.registerSpatialQuery(...) at world bootstrap.'
      );
    }
    if (typeof spatial.getEntityPosition === 'function') {
      const pos = spatial.getEntityPosition(entityId);
      return pos ?? undefined;
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Filter
  // ---------------------------------------------------------------------------

  private passesFilter(entityId: number, filter: TargetFilter): boolean {
    // No tag predicates → trivially passes. Avoid touching the entity.
    if (
      (!filter.tagsRequired || filter.tagsRequired.length === 0) &&
      (!filter.tagsBlocked || filter.tagsBlocked.length === 0)
    ) {
      return true;
    }
    const entity = this.entityManager.getEntity(entityId);
    if (!entity) {
      // Spatial query returned a stale id (entity removed between the
      // query and our consumption). Treat as not-passing — the entity
      // can't satisfy any predicate that needs to read its tags.
      return false;
    }
    const tagsComponent = entity.getComponent<GameplayTagsComponent>(
      AbilitiesComponentType.GameplayTags
    );
    if (filter.tagsRequired && filter.tagsRequired.length > 0) {
      if (!tagsComponent) {
        // No tag component at all → cannot satisfy a `required` filter.
        return false;
      }
      for (const tag of filter.tagsRequired) {
        if (!tagsComponent.tags.has(tag)) {
          return false;
        }
      }
    }
    if (filter.tagsBlocked && filter.tagsBlocked.length > 0) {
      if (tagsComponent) {
        for (const tag of filter.tagsBlocked) {
          if (tagsComponent.tags.has(tag)) {
            return false;
          }
        }
      }
      // No tag component → trivially passes the blocked check.
    }
    return true;
  }
}

