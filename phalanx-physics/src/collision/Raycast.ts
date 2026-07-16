import { FP, type FixedPoint } from '@phalanx-engine/math';

/**
 * Fixed-point 3D point/vector used by the raycast query.
 */
export interface Vec3FP {
  x: FixedPoint;
  y: FixedPoint;
  z: FixedPoint;
}

/**
 * Axis-aligned bounding box in fixed-point world space.
 */
export interface AABB {
  minX: FixedPoint;
  minY: FixedPoint;
  minZ: FixedPoint;
  maxX: FixedPoint;
  maxY: FixedPoint;
  maxZ: FixedPoint;
}

/**
 * Result of a swept-segment vs AABB query.
 */
export interface RayHit {
  /** Parametric hit distance along the segment, `t ∈ [0, 1]` (0 at `prev`, 1 at `cur`). */
  t: FixedPoint;
  /** World-space hit point, equal to `lerp(prev, cur, t)`. */
  point: Vec3FP;
  /** Outward unit normal of the entry face (one of ±X/±Y/±Z). */
  normal: Vec3FP;
}

/**
 * Swept-segment (raycast) vs axis-aligned box, using the deterministic slab
 * method entirely in `FP.*` fixed-point arithmetic.
 *
 * WORKAROUND FOR 3D COLLISIONS: the core physics pipeline is 2D/XZ
 * (circle-vs-circle) and does not detect collisions on the Y axis. For 3D
 * collisions — e.g. ordnance hitting a static obstacle like a building — use
 * this swept-segment raycast query as a workaround until full 3D body-body
 * collision is implemented (planned for v2). Call it with a moving body's
 * previous and current position to get the impact point and surface normal
 * against caller-supplied static boxes.
 *
 * Conventions:
 * - `t ∈ [0, 1]`: 0 at `prev`, 1 at `cur`; `point = lerp(prev, cur, t)`.
 * - `normal` is the OUTWARD normal of the face the segment enters through.
 *   Entering the min-X face while moving +X yields `(-1, 0, 0)`, etc.
 * - Segment starting inside the box → hit at `t = 0`, `point = prev`, and
 *   `normal` = the outward normal of the nearest face.
 * - Zero-length segment: outside the box → `null`; inside → `t = 0`.
 * - Axes parallel to a slab are handled without dividing by zero (guarded by an
 *   explicit `FP.Eq(delta, 0)` check — `FP.Div` throws on divide-by-zero).
 *
 * @returns the entry hit, or `null` when the segment never intersects the box.
 */
export function segmentVsAABB(prev: Vec3FP, cur: Vec3FP, box: AABB): RayHit | null {
  const dx = FP.Sub(cur.x, prev.x);
  const dy = FP.Sub(cur.y, prev.y);
  const dz = FP.Sub(cur.z, prev.z);

  // Clip the parameter range [0, 1] against each slab (Liang-Barsky style).
  let tEnter = FP._0;
  let tExit = FP._1;

  // Outward normal of the entry face; stays null while the entry is still at
  // t = 0 (which means the segment started inside the box).
  let entryNormal: Vec3FP | null = null;

  const clip = (
    p: FixedPoint,
    d: FixedPoint,
    lo: FixedPoint,
    hi: FixedPoint,
    negNormal: Vec3FP,
    posNormal: Vec3FP,
  ): boolean => {
    if (FP.Eq(d, FP._0)) {
      // Parallel to this slab: only possible to hit if the origin is inside it.
      return !(FP.Lt(p, lo) || FP.Gt(p, hi));
    }
    const t1 = FP.Div(FP.Sub(lo, p), d);
    const t2 = FP.Div(FP.Sub(hi, p), d);
    const tNear = FP.Min(t1, t2);
    const tFar = FP.Max(t1, t2);
    // Moving in +axis enters through the min face (outward normal -axis);
    // moving in -axis enters through the max face (outward normal +axis).
    const nearNormal = FP.Gt(d, FP._0) ? negNormal : posNormal;
    if (FP.Gt(tNear, tEnter)) {
      tEnter = tNear;
      entryNormal = nearNormal;
    }
    if (FP.Lt(tFar, tExit)) {
      tExit = tFar;
    }
    return !FP.Gt(tEnter, tExit);
  };

  if (!clip(prev.x, dx, box.minX, box.maxX, NEG_X, POS_X)) return null;
  if (!clip(prev.y, dy, box.minY, box.maxY, NEG_Y, POS_Y)) return null;
  if (!clip(prev.z, dz, box.minZ, box.maxZ, NEG_Z, POS_Z)) return null;

  // Entry never advanced past t = 0 → the segment started inside the box.
  if (entryNormal === null) {
    return { t: FP._0, point: { x: prev.x, y: prev.y, z: prev.z }, normal: nearestFaceNormal(prev, box) };
  }

  const t = tEnter;
  return {
    t,
    point: {
      x: FP.Lerp(prev.x, cur.x, t),
      y: FP.Lerp(prev.y, cur.y, t),
      z: FP.Lerp(prev.z, cur.z, t),
    },
    normal: entryNormal,
  };
}

/** Outward normal of the box face nearest to an interior point. */
function nearestFaceNormal(p: Vec3FP, box: AABB): Vec3FP {
  let best = FP.Sub(p.x, box.minX);
  let normal = NEG_X;

  const consider = (dist: FixedPoint, faceNormal: Vec3FP): void => {
    if (FP.Lt(dist, best)) {
      best = dist;
      normal = faceNormal;
    }
  };

  consider(FP.Sub(box.maxX, p.x), POS_X);
  consider(FP.Sub(p.y, box.minY), NEG_Y);
  consider(FP.Sub(box.maxY, p.y), POS_Y);
  consider(FP.Sub(p.z, box.minZ), NEG_Z);
  consider(FP.Sub(box.maxZ, p.z), POS_Z);

  return normal;
}

const NEG_X: Vec3FP = { x: FP.Neg(FP._1), y: FP._0, z: FP._0 };
const POS_X: Vec3FP = { x: FP._1, y: FP._0, z: FP._0 };
const NEG_Y: Vec3FP = { x: FP._0, y: FP.Neg(FP._1), z: FP._0 };
const POS_Y: Vec3FP = { x: FP._0, y: FP._1, z: FP._0 };
const NEG_Z: Vec3FP = { x: FP._0, y: FP._0, z: FP.Neg(FP._1) };
const POS_Z: Vec3FP = { x: FP._0, y: FP._0, z: FP._1 };
