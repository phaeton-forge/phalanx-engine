import { describe, it, expect } from 'vitest';
import { FP } from '@phalanx-engine/math';
import { segmentVsAABB, type AABB, type Vec3FP } from '../src/collision/Raycast';
import { PhysicsWorld } from '../src/PhysicsWorld';

function vec(x: number, y: number, z: number): Vec3FP {
  return { x: FP.FromFloat(x), y: FP.FromFloat(y), z: FP.FromFloat(z) };
}

function box(
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): AABB {
  return {
    minX: FP.FromFloat(minX), minY: FP.FromFloat(minY), minZ: FP.FromFloat(minZ),
    maxX: FP.FromFloat(maxX), maxY: FP.FromFloat(maxY), maxZ: FP.FromFloat(maxZ),
  };
}

// Unit cube centered at origin: [-1,1]^3.
const UNIT = box(-1, -1, -1, 1, 1, 1);

describe('segmentVsAABB', () => {
  it('hits the min-X face when moving +X from outside (normal = -X)', () => {
    const hit = segmentVsAABB(vec(-5, 0, 0), vec(5, 0, 0), UNIT);
    expect(hit).not.toBeNull();
    // Enters at x = -1 → t = (-1 - (-5)) / 10 = 0.4
    expect(FP.ToFloat(hit!.t)).toBeCloseTo(0.4, 5);
    expect(FP.ToFloat(hit!.point.x)).toBeCloseTo(-1, 5);
    expect(FP.ToFloat(hit!.normal.x)).toBeCloseTo(-1, 5);
    expect(FP.ToFloat(hit!.normal.y)).toBeCloseTo(0, 5);
    expect(FP.ToFloat(hit!.normal.z)).toBeCloseTo(0, 5);
    // t strictly inside (0, 1)
    expect(FP.Gt(hit!.t, FP._0)).toBe(true);
    expect(FP.Lt(hit!.t, FP._1)).toBe(true);
  });

  it('hits the top (max-Y) face when descending from above (normal = +Y)', () => {
    const hit = segmentVsAABB(vec(0, 5, 0), vec(0, -5, 0), UNIT);
    expect(hit).not.toBeNull();
    // Enters at y = 1 → t = (1 - 5) / (-10) = 0.4
    expect(FP.ToFloat(hit!.t)).toBeCloseTo(0.4, 5);
    expect(FP.ToFloat(hit!.point.y)).toBeCloseTo(1, 5);
    expect(FP.ToFloat(hit!.normal.x)).toBeCloseTo(0, 5);
    expect(FP.ToFloat(hit!.normal.y)).toBeCloseTo(1, 5);
    expect(FP.ToFloat(hit!.normal.z)).toBeCloseTo(0, 5);
  });

  it('returns null when the segment misses the box', () => {
    // Parallel to X at y = 5, well above the box.
    const hit = segmentVsAABB(vec(-5, 5, 0), vec(5, 5, 0), UNIT);
    expect(hit).toBeNull();
  });

  it('starts inside the box → t = 0, point = prev, normal = nearest face', () => {
    // Closest to the +X face (0.6 from maxX vs 0.9 from others).
    const prev = vec(0.4, 0, 0);
    const hit = segmentVsAABB(prev, vec(5, 0, 0), UNIT);
    expect(hit).not.toBeNull();
    expect(FP.ToFloat(hit!.t)).toBeCloseTo(0, 5);
    expect(FP.ToFloat(hit!.point.x)).toBeCloseTo(0.4, 5);
    expect(FP.ToFloat(hit!.point.y)).toBeCloseTo(0, 5);
    expect(FP.ToFloat(hit!.point.z)).toBeCloseTo(0, 5);
    // Nearest face is +X.
    expect(FP.ToFloat(hit!.normal.x)).toBeCloseTo(1, 5);
  });

  it('point equals lerp(prev, cur, t)', () => {
    // Diagonal through the origin: varies on all three axes and clearly hits.
    const prev = vec(-3, -3, -3);
    const cur = vec(3, 3, 3);
    const hit = segmentVsAABB(prev, cur, UNIT);
    expect(hit).not.toBeNull();
    const t = hit!.t;
    expect(FP.ToFloat(hit!.point.x)).toBeCloseTo(FP.ToFloat(FP.Lerp(prev.x, cur.x, t)), 5);
    expect(FP.ToFloat(hit!.point.y)).toBeCloseTo(FP.ToFloat(FP.Lerp(prev.y, cur.y, t)), 5);
    expect(FP.ToFloat(hit!.point.z)).toBeCloseTo(FP.ToFloat(FP.Lerp(prev.z, cur.z, t)), 5);
  });

  it('zero-length segment outside the box → null', () => {
    const hit = segmentVsAABB(vec(5, 5, 5), vec(5, 5, 5), UNIT);
    expect(hit).toBeNull();
  });

  it('zero-length segment inside the box → t = 0', () => {
    const hit = segmentVsAABB(vec(0, 0, 0), vec(0, 0, 0), UNIT);
    expect(hit).not.toBeNull();
    expect(FP.ToFloat(hit!.t)).toBeCloseTo(0, 5);
    expect(FP.ToFloat(hit!.point.x)).toBeCloseTo(0, 5);
  });

  it('handles a segment parallel to a slab deterministically (no NaN)', () => {
    // Parallel to X, exactly at y = 1 (on the top face plane), passing through.
    const hit = segmentVsAABB(vec(-5, 1, 0), vec(5, 1, 0), UNIT);
    // Whatever the outcome, it must be well-defined (a hit here, entering at x=-1).
    expect(hit).not.toBeNull();
    expect(Number.isNaN(FP.ToFloat(hit!.t))).toBe(false);
    expect(FP.ToFloat(hit!.point.x)).toBeCloseTo(-1, 5);
  });

  it('parallel-and-outside slab → null (no divide-by-zero)', () => {
    // Parallel to X but z = 9 lies outside the box's z-slab.
    const hit = segmentVsAABB(vec(-5, 0, 9), vec(5, 0, 9), UNIT);
    expect(hit).toBeNull();
  });

  it('is deterministic: identical inputs → identical RayHit', () => {
    const prev = vec(-4, 2, 1);
    const cur = vec(6, -3, -2);
    const a = segmentVsAABB(prev, cur, UNIT);
    const b = segmentVsAABB(prev, cur, UNIT);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // Raw bigint equality — bit-for-bit determinism.
    expect(FP.ToRaw(a!.t)).toBe(FP.ToRaw(b!.t));
    expect(FP.ToRaw(a!.point.x)).toBe(FP.ToRaw(b!.point.x));
    expect(FP.ToRaw(a!.point.y)).toBe(FP.ToRaw(b!.point.y));
    expect(FP.ToRaw(a!.point.z)).toBe(FP.ToRaw(b!.point.z));
    expect(FP.ToRaw(a!.normal.x)).toBe(FP.ToRaw(b!.normal.x));
    expect(FP.ToRaw(a!.normal.y)).toBe(FP.ToRaw(b!.normal.y));
    expect(FP.ToRaw(a!.normal.z)).toBe(FP.ToRaw(b!.normal.z));
  });
});

describe('PhysicsWorld.raycastSegment', () => {
  // raycastSegment is a pure query over the supplied boxes — no ECS context needed.
  it('returns the nearest hit (smallest t) among many boxes', () => {
    const world = new PhysicsWorld();
    const near = box(1, -1, -1, 2, 1, 1); // enters at x = 1
    const far = box(4, -1, -1, 5, 1, 1); // enters at x = 4
    const hit = world.raycastSegment(vec(-5, 0, 0), vec(10, 0, 0), [far, near]);
    expect(hit).not.toBeNull();
    // Nearest is the box entered at x = 1 → t = (1 - (-5)) / 15 = 0.4
    expect(FP.ToFloat(hit!.point.x)).toBeCloseTo(1, 5);
    expect(FP.ToFloat(hit!.t)).toBeCloseTo(0.4, 5);
  });

  it('returns null for an empty box list', () => {
    const world = new PhysicsWorld();
    const hit = world.raycastSegment(vec(-5, 0, 0), vec(5, 0, 0), []);
    expect(hit).toBeNull();
  });

  it('returns null when the segment hits none of the boxes', () => {
    const world = new PhysicsWorld();
    const b = box(10, 10, 10, 11, 11, 11);
    const hit = world.raycastSegment(vec(-5, 0, 0), vec(5, 0, 0), [b]);
    expect(hit).toBeNull();
  });
});
