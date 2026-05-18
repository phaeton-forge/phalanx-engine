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
   * missing the activation is silently dropped — see
   * {@link resolveTargets} return value.
   */
  providedTarget?: ProvidedTarget;
}

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

  public resolve(input: TargetResolutionInput): number[] {
    const { spec } = input;
    switch (spec.kind) {
      case 'Self':
        return [input.casterEntityId];
      case 'Entity': {
        const entityId = this.resolveEntityOrigin(input.casterEntityId, spec.origin, input.providedTarget);
        if (entityId === undefined) {
          return [];
        }
        return [entityId];
      }
      case 'Point':
        // A Point target intentionally resolves to zero entities. The point
        // itself is consumed by ability hooks via providedTarget (or by
        // user code reading AbilityActivationContext). `targetEffectIds`
        // on a Point-targeted ability is therefore a no-op — that is
        // expected: damage/heal is applied by the rocket/projectile hook
        // on impact via `applyEffectAoE`, not by the ability's
        // target-effects pipeline.
        return [];
      case 'Radius':
        return this.resolveRadius(input);
    }
  }

  // ---------------------------------------------------------------------------
  // Radius (the heavy path)
  // ---------------------------------------------------------------------------

  private resolveRadius(input: TargetResolutionInput): number[] {
    const spec = input.spec as Extract<TargetSpec, { kind: 'Radius' }>;
    const center = this.resolveRadiusOrigin(input, spec.origin);
    if (!center) {
      return [];
    }

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

    const out: number[] = [];
    const limit = spec.maxTargets;
    for (let i = 0; i < buf.length; i++) {
      const id = buf[i];
      if (!includeSelf && id === casterId) {
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
    return out;
  }

  // ---------------------------------------------------------------------------
  // Origin resolution
  // ---------------------------------------------------------------------------

  /** Resolve an `Entity`-shape origin to a single target entity id. */
  private resolveEntityOrigin(
    casterId: number,
    origin: TargetOrigin,
    providedTarget: ProvidedTarget | undefined
  ): number | undefined {
    switch (origin.kind) {
      case 'Caster':
        return casterId;
      case 'TargetEntity':
        return origin.entityId;
      case 'Caller':
        // Missing entityId means the caller forgot to supply a target —
        // silently drop the activation. The facade-level
        // `activateAbility` already returned `true` for "request
        // accepted"; this matches the documented "verdict observed via
        // side effects, not return value" contract.
        return providedTarget?.entityId;
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
   * Resolve a `Radius`-shape origin to a center point. Returns `undefined`
   * for the silent-drop case (Caller origin with no point provided) —
   * the resolver hands an empty target list back to the caller without
   * reaching the spatial query at all.
   */
  private resolveRadiusOrigin(
    input: TargetResolutionInput,
    origin: TargetOrigin
  ): { x: FixedPoint; z: FixedPoint } | undefined {
    switch (origin.kind) {
      case 'Caster': {
        const pos = this.tryGetCasterPosition(input.casterEntityId);
        if (!pos) {
          throw new Error(
            `TargetSpec.kind === 'Radius' with origin 'Caster' requires the caster ` +
              `(entity ${input.casterEntityId}) to have a position. Provide a position ` +
              `via the spatial query implementation or use TargetOrigin.kind === 'Point'.`
          );
        }
        return pos;
      }
      case 'TargetEntity': {
        const pos = this.tryGetCasterPosition(origin.entityId);
        if (!pos) {
          throw new Error(
            `TargetSpec.kind === 'Radius' with origin 'TargetEntity' requires the target ` +
              `(entity ${origin.entityId}) to have a position resolvable by ISpatialQuery.`
          );
        }
        return pos;
      }
      case 'Point':
        return { x: origin.x, z: origin.z };
      case 'Caller': {
        const providedTarget = input.providedTarget;
        if (!providedTarget || providedTarget.x === undefined || providedTarget.z === undefined) {
          // Caller forgot to supply a point — silently drop.
          return undefined;
        }
        return { x: providedTarget.x, z: providedTarget.z };
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
   * error pointing the user at registerSpatialQuery, instead of silently
   * dropping the activation.
   */
  private tryGetCasterPosition(
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

