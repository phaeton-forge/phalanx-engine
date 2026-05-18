import type { FixedPoint } from 'phalanx-math';

/**
 * Adapter that lets {@link TargetResolver} ask the surrounding world
 * "which entities are inside this disc?".
 *
 * The interface is intentionally tiny so `phalanx-abilities` stays free of
 * a hard `phalanx-physics` peer dependency. Implementations are expected
 * to be a thin wrapper over the project's existing spatial index (a hash
 * grid, a quadtree, or even an O(n) linear scan for prototype scenes).
 *
 * Contract for `queryRadius`:
 *   - Returns every entity whose position satisfies
 *     `dx*dx + dz*dz <= radius*radius`, with `dx = entity.x - center.x`
 *     and `dz = entity.z - center.z`, evaluated in `FixedPoint`.
 *   - Implementations MAY include the center entity if the center happens
 *     to coincide with one. `TargetResolver` handles self-inclusion via
 *     `TargetSpec.includeSelf` after the query, so implementations should
 *     err on the side of being inclusive.
 *   - Result order is NOT required to be stable. `TargetResolver` sorts
 *     by entity id ASC before applying `maxTargets` / `filter`, so any
 *     order is safe.
 *   - The method MUST be deterministic for a given world state — every
 *     lockstep peer at the same tick must produce the same multiset of
 *     entity ids.
 */
export interface ISpatialQuery {
  queryRadius(x: FixedPoint, z: FixedPoint, radius: FixedPoint): number[];

  /**
   * OPTIONAL: return the position of an entity. Required only for
   * `TargetSpec.kind === 'Radius'` with origin `Caster` or `TargetEntity`
   * — the resolver needs to know where the disc is centered. Abilities
   * that exclusively use `Point` or `Caller` (with `x`/`z` supplied)
   * origins do not need this method.
   *
   * Returns `undefined` for unknown / removed entities.
   */
  getEntityPosition?(entityId: number): { x: FixedPoint; z: FixedPoint } | undefined;
}
