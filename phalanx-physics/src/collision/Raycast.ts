import { FP, type FixedPoint } from '@phalanx-engine/math';

/** A 3D point / vector in fixed-point space. */
export interface Vec3FP {
  x: FixedPoint;
  y: FixedPoint;
  z: FixedPoint;
}

/** An axis-aligned bounding box in fixed-point space. */
export interface AABB {
  minX: FixedPoint;
  minY: FixedPoint;
  minZ: FixedPoint;
  maxX: FixedPoint;
  maxY: FixedPoint;
  maxZ: FixedPoint;
}

/**
 * Result of a swept-segment (raycast) query against an AABB.
 */
export interface RayHit {
  /** Parametric hit position along the segment, in [0, 1] (0 at `prev`, 1 at `cur`). */
  t: FixedPoint;
  /** World-space impact point = lerp(prev, cur, t). */
  point: Vec3FP;
  /** Outward face normal at the impact point (one of ±X / ±Y / ±Z unit vectors). */
  normal: Vec3FP;
}

const NEG_1 = FP.Neg(FP._1);

/** Unit outward normals per face. */
const NORMAL_NEG_X: Vec3FP = { x: NEG_1, y: FP._0, z: FP._0 };
const NORMAL_POS_X: Vec3FP = { x: FP._1, y: FP._0, z: FP._0 };
const NORMAL_NEG_Y: Vec3FP = { x: FP._0, y: NEG_1, z: FP._0 };
const NORMAL_POS_Y: Vec3FP = { x: FP._0, y: FP._1, z: FP._0 };
const NORMAL_NEG_Z: Vec3FP = { x: FP._0, y: FP._0, z: NEG_1 };
const NORMAL_POS_Z: Vec3FP = { x: FP._0, y: FP._0, z: FP._1 };

/** Linear interpolation of a point along the segment. */
function lerpPoint(prev: Vec3FP, cur: Vec3FP, t: FixedPoint): Vec3FP {
  return {
    x: FP.Lerp(prev.x, cur.x, t),
    y: FP.Lerp(prev.y, cur.y, t),
    z: FP.Lerp(prev.z, cur.z, t),
  };
}

/** Per-axis slab intersection result. */
interface SlabResult {
  low: FixedPoint;
  high: FixedPoint;
  /** Outward normal of the face crossed at `low` (the entry face for this axis). */
  lowNormal: Vec3FP;
}

/**
 * Intersect the segment against a single slab [min, max] on one axis.
 *
 * Returns the [low, high] parametric interval plus the outward normal of the
 * entry face, or `null` if the segment is parallel to the slab and lies outside
 * it (never enters). A `null` return means "no intersection" for the whole box.
 *
 * `negNormal` / `posNormal` are the outward normals of the min-face and max-face.
 */
function intersectSlab(
  origin: FixedPoint,
  delta: FixedPoint,
  min: FixedPoint,
  max: FixedPoint,
  negNormal: Vec3FP,
  posNormal: Vec3FP
): SlabResult | 'parallel-inside' | null {
  if (FP.Eq(delta, FP._0)) {
    // Segment is parallel to this slab: it can only intersect the box if its
    // origin already lies within the slab. Otherwise there is no intersection.
    if (FP.Lt(origin, min) || FP.Gt(origin, max)) {
      return null;
    }
    return 'parallel-inside';
  }

  // Guard against division by zero handled above; safe to divide here.
  const tAtMin = FP.Div(FP.Sub(min, origin), delta);
  const tAtMax = FP.Div(FP.Sub(max, origin), delta);

  if (FP.Gt(delta, FP._0)) {
    // Moving in +axis: enters through the min face, exits through the max face.
    return { low: tAtMin, high: tAtMax, lowNormal: negNormal };
  }
  // Moving in -axis: enters through the max face, exits through the min face.
  return { low: tAtMax, high: tAtMin, lowNormal: posNormal };
}

/** Find the outward normal of the box face nearest to a point known to be inside. */
function nearestFaceNormal(point: Vec3FP, box: AABB): Vec3FP {
  let bestDist = FP.Sub(point.x, box.minX);
  let bestNormal = NORMAL_NEG_X;

  const consider = (dist: FixedPoint, normal: Vec3FP): void => {
    if (FP.Lt(dist, bestDist)) {
      bestDist = dist;
      bestNormal = normal;
    }
  };

  consider(FP.Sub(box.maxX, point.x), NORMAL_POS_X);
  consider(FP.Sub(point.y, box.minY), NORMAL_NEG_Y);
  consider(FP.Sub(box.maxY, point.y), NORMAL_POS_Y);
  consider(FP.Sub(point.z, box.minZ), NORMAL_NEG_Z);
  consider(FP.Sub(box.maxZ, point.z), NORMAL_POS_Z);

  return bestNormal;
}

/**
 * Swept-segment (raycast) vs axis-aligned bounding box using the slab method,
 * evaluated entirely in fixed-point.
 *
 * The segment runs from `prev` (t = 0) to `cur` (t = 1). Returns the entry
 * `RayHit` with the smallest `t` in [0, 1], or `null` if the segment does not
 * intersect the box within that range.
 *
 * Conventions:
 * - `normal` is the outward face normal of the entry slab (a ±X/±Y/±Z unit vector).
 * - If the segment starts inside the box, returns `{ t: FP._0, point: prev,
 *   normal: <nearest face normal> }`.
 * - A zero-length segment (`prev == cur`) returns `null` when outside the box
 *   and the inside-convention hit (t = 0) when inside.
 * - Degenerate segments parallel to a slab are handled without division by zero
 *   and resolve deterministically (hit or `null`, never NaN).
 */
export function segmentVsAABB(prev: Vec3FP, cur: Vec3FP, box: AABB): RayHit | null {
  const dx = FP.Sub(cur.x, prev.x);
  const dy = FP.Sub(cur.y, prev.y);
  const dz = FP.Sub(cur.z, prev.z);

  const slabs = [
    intersectSlab(prev.x, dx, box.minX, box.maxX, NORMAL_NEG_X, NORMAL_POS_X),
    intersectSlab(prev.y, dy, box.minY, box.maxY, NORMAL_NEG_Y, NORMAL_POS_Y),
    intersectSlab(prev.z, dz, box.minZ, box.maxZ, NORMAL_NEG_Z, NORMAL_POS_Z),
  ];

  let tEnter: FixedPoint | null = null;
  let tExit: FixedPoint | null = null;
  let entryNormal: Vec3FP = NORMAL_POS_X;

  for (const slab of slabs) {
    if (slab === null) {
      // Parallel to a slab and outside it: no intersection.
      return null;
    }
    if (slab === 'parallel-inside') {
      // Axis imposes no parametric bound; only the outside check mattered.
      continue;
    }
    if (tEnter === null || FP.Gt(slab.low, tEnter)) {
      tEnter = slab.low;
      entryNormal = slab.lowNormal;
    }
    if (tExit === null || FP.Lt(slab.high, tExit)) {
      tExit = slab.high;
    }
  }

  // All three axes were parallel-inside: the (possibly zero-length) segment lies
  // within every slab, i.e. entirely inside the box. Report the inside hit.
  if (tEnter === null || tExit === null) {
    return { t: FP._0, point: prev, normal: nearestFaceNormal(prev, box) };
  }

  // Slabs do not overlap, or the overlap falls entirely outside the segment.
  if (FP.Gt(tEnter, tExit) || FP.Lt(tExit, FP._0) || FP.Gt(tEnter, FP._1)) {
    return null;
  }

  // Entry is behind `prev`: the segment starts inside the box.
  if (FP.Lt(tEnter, FP._0)) {
    return { t: FP._0, point: prev, normal: nearestFaceNormal(prev, box) };
  }

  return { t: tEnter, point: lerpPoint(prev, cur, tEnter), normal: entryNormal };
}
