import { FP, type FixedPoint } from '@phalanx-engine/math';

/** A 3D point / direction in fixed-point. Structurally compatible with `FPVector3`. */
interface Vec3 {
  x: FixedPoint;
  y: FixedPoint;
  z: FixedPoint;
}

/** Axis-aligned 3D bounding box in fixed-point. */
export interface AABB3 {
  minX: FixedPoint;
  minY: FixedPoint;
  minZ: FixedPoint;
  maxX: FixedPoint;
  maxY: FixedPoint;
  maxZ: FixedPoint;
}

/**
 * Result of a swept-segment (raycast) query against an AABB.
 *
 * - `t` — parametric position of the impact along the segment, in `[0, 1]`
 *   (`0` at `prev`, `1` at `cur`).
 * - `point` — the impact point in 3D space (`lerp(prev, cur, t)`).
 * - `normal` — outward face normal of the box at the entry point (one of ±X/±Y/±Z).
 */
export interface RayHit {
  t: FixedPoint;
  point: Vec3;
  normal: Vec3;
}

/**
 * WORKAROUND for 3D collision detection.
 *
 * The physics engine's body-vs-body narrow phase is 2D/XZ only (circles on the
 * ground plane). For 3D collision — e.g. a fast-moving ordnance (artillery
 * shrapnel, shell, projectile) hitting a static obstacle such as a building —
 * use this swept-segment query as a workaround until a full 3D body-body
 * collision system is implemented (planned v2: `BoxColliderComponent` as ECS
 * entities + grid-accelerated raycast + 3D sphere/box vs sphere/box resolution).
 *
 * Casts a segment `prev -> cur` against an axis-aligned 3D box and returns the
 * first impact (`t`, `point`, outward `normal`), or `null` if the segment never
 * enters the box. Using the swept segment (rather than point-in-box per tick)
 * prevents tunneling: a fast shard cannot skip through a thin wall between ticks.
 *
 * Pure, deterministic, fixed-point only. Uses the slab method.
 *
 * @param prev  Segment start (previous tick position of the ordnance).
 * @param cur   Segment end (current tick position of the ordnance).
 * @param box   Axis-aligned 3D box to test against.
 * @returns The nearest impact along the segment, or `null` if no intersection.
 */
export function segmentVsAABB(prev: Vec3, cur: Vec3, box: AABB3): RayHit | null {
  const pPrev: readonly FixedPoint[] = [prev.x, prev.y, prev.z];
  const pCur: readonly FixedPoint[] = [cur.x, cur.y, cur.z];
  const pMin: readonly FixedPoint[] = [box.minX, box.minY, box.minZ];
  const pMax: readonly FixedPoint[] = [box.maxX, box.maxY, box.maxZ];

  // Segment starts inside the box -> impact at the start with the nearest face
  // normal (covers both stationary points and moving segments that begin inside).
  const startsInside =
    FP.Gte(prev.x, box.minX) && FP.Lte(prev.x, box.maxX) &&
    FP.Gte(prev.y, box.minY) && FP.Lte(prev.y, box.maxY) &&
    FP.Gte(prev.z, box.minZ) && FP.Lte(prev.z, box.maxZ);
  if (startsInside) {
    return {
      t: FP._0,
      point: { x: prev.x, y: prev.y, z: prev.z },
      normal: nearestFaceNormal(pPrev, pMin, pMax),
    };
  }

  let tEnter: FixedPoint = FP._0;
  let tExit: FixedPoint = FP._0;
  let entrySet = false;
  let exitSet = false;
  let entryAxis = 0;
  let entryFromMin = true;

  for (let a = 0; a < 3; a++) {
    const d = FP.Sub(pCur[a], pPrev[a]);

    if (FP.Eq(d, FP._0)) {
      // Segment is parallel to this slab. It lies within the slab for the
      // whole [0,1] interval iff `prev` is inside [min, max] on this axis.
      if (FP.Lt(pPrev[a], pMin[a]) || FP.Gt(pPrev[a], pMax[a])) {
        return null;
      }
      continue; // no constraint on this axis
    }

    // Crossing times of the two slab planes.
    let tMin = FP.Div(FP.Sub(pMin[a], pPrev[a]), d);
    let tMax = FP.Div(FP.Sub(pMax[a], pPrev[a]), d);
    // d > 0  -> enters through the min face (outward normal = -axis)
    // d < 0  -> enters through the max face (outward normal = +axis)
    const fromMin = FP.Gt(d, FP._0);
    if (FP.Gt(tMin, tMax)) {
      const tmp = tMin;
      tMin = tMax;
      tMax = tmp;
    }

    // Overall entry = max of per-axis entry times; exit = min of per-axis exits.
    if (!entrySet || FP.Gt(tMin, tEnter)) {
      tEnter = tMin;
      entryAxis = a;
      entryFromMin = fromMin;
    }
    if (!exitSet || FP.Lt(tMax, tExit)) {
      tExit = tMax;
    }
    entrySet = true;
    exitSet = true;
  }

  // No overlap of the per-axis intervals -> segment misses the box.
  if (FP.Gt(tEnter, tExit)) return null;
  // Box lies entirely before the segment start or beyond its end.
  if (FP.Lt(tExit, FP._0)) return null;
  if (FP.Gt(tEnter, FP._1)) return null;

  const t = FP.Clamp(tEnter, FP._0, FP._1);
  const point: Vec3 = {
    x: FP.Lerp(prev.x, cur.x, t),
    y: FP.Lerp(prev.y, cur.y, t),
    z: FP.Lerp(prev.z, cur.z, t),
  };
  return { t, point, normal: axisNormal(entryAxis, entryFromMin) };
}

/** Outward unit normal for the entry face of a given axis. */
function axisNormal(axis: number, fromMin: boolean): Vec3 {
  const s = fromMin ? FP.Neg(FP._1) : FP._1;
  if (axis === 0) return { x: s, y: FP._0, z: FP._0 };
  if (axis === 1) return { x: FP._0, y: s, z: FP._0 };
  return { x: FP._0, y: FP._0, z: s };
}

/** Outward normal of the box face nearest to a point (used when starting inside). */
function nearestFaceNormal(
  p: readonly FixedPoint[],
  pMin: readonly FixedPoint[],
  pMax: readonly FixedPoint[],
): Vec3 {
  let bestAxis = 0;
  let bestFromMin = true;
  let bestDist = FP.Sub(p[0], pMin[0]); // distance to minX face

  for (let a = 0; a < 3; a++) {
    const distMin = FP.Sub(p[a], pMin[a]); // to min face (>=0 inside)
    const distMax = FP.Sub(pMax[a], p[a]); // to max face (>=0 inside)
    if (FP.Lt(distMin, bestDist)) {
      bestDist = distMin;
      bestAxis = a;
      bestFromMin = true;
    }
    if (FP.Lt(distMax, bestDist)) {
      bestDist = distMax;
      bestAxis = a;
      bestFromMin = false;
    }
  }
  return axisNormal(bestAxis, bestFromMin);
}
