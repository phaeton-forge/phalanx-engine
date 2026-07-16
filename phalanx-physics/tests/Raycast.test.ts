import { describe, it, expect } from 'vitest';
import { FP } from '@phalanx-engine/math';
import { segmentVsAABB } from '../src/collision/Raycast';
import type { Vec3FP, AABB } from '../src/collision/Raycast';
import { PhysicsWorld } from '../src/PhysicsWorld';

const v = (x: number, y: number, z: number): Vec3FP => ({
  x: FP.FromFloat(x),
  y: FP.FromFloat(y),
  z: FP.FromFloat(z),
});

/** Unit box centered at the origin: [-1, 1] on every axis. */
const unitBox: AABB = {
  minX: FP.FromFloat(-1),
  minY: FP.FromFloat(-1),
  minZ: FP.FromFloat(-1),
  maxX: FP.FromFloat(1),
  maxY: FP.FromFloat(1),
  maxZ: FP.FromFloat(1),
};

const near = (a: number, b: number, tol = 1e-3): boolean => Math.abs(a - b) <= tol;

describe('segmentVsAABB', () => {
  it('hits the +X face from outside with normal (1,0,0)', () => {
    // Travelling in -X toward the box, entering through the +X (max-X) face.
    const hit = segmentVsAABB(v(3, 0, 0), v(-3, 0, 0), unitBox);
    expect(hit).not.toBeNull();
    expect(near(FP.ToFloat(hit!.normal.x), 1)).toBe(true);
    expect(near(FP.ToFloat(hit!.normal.y), 0)).toBe(true);
    expect(near(FP.ToFloat(hit!.normal.z), 0)).toBe(true);
    // Entry at x = 1 → t = (3 - 1) / 6 = 1/3.
    expect(near(FP.ToFloat(hit!.t), 1 / 3)).toBe(true);
    expect(FP.Gt(hit!.t, FP._0)).toBe(true);
    expect(FP.Lt(hit!.t, FP._1)).toBe(true);
    expect(near(FP.ToFloat(hit!.point.x), 1)).toBe(true);
  });

  it('hits the +Y (top) face when entering from above with normal (0,1,0)', () => {
    const hit = segmentVsAABB(v(0, 3, 0), v(0, -3, 0), unitBox);
    expect(hit).not.toBeNull();
    expect(near(FP.ToFloat(hit!.normal.x), 0)).toBe(true);
    expect(near(FP.ToFloat(hit!.normal.y), 1)).toBe(true);
    expect(near(FP.ToFloat(hit!.normal.z), 0)).toBe(true);
    // Impact point lies on the top face (y = 1).
    expect(near(FP.ToFloat(hit!.point.y), 1)).toBe(true);
    expect(near(FP.ToFloat(hit!.point.x), 0)).toBe(true);
    expect(near(FP.ToFloat(hit!.point.z), 0)).toBe(true);
  });

  it('returns null when the segment passes outside the box', () => {
    // Parallel to X at y = 5, well above the box.
    const hit = segmentVsAABB(v(-5, 5, 0), v(5, 5, 0), unitBox);
    expect(hit).toBeNull();
  });

  it('returns t=0 and point=prev when the segment starts inside the box', () => {
    const prev = v(0, 0, 0);
    const hit = segmentVsAABB(prev, v(5, 0, 0), unitBox);
    expect(hit).not.toBeNull();
    expect(FP.Eq(hit!.t, FP._0)).toBe(true);
    expect(FP.Eq(hit!.point.x, prev.x)).toBe(true);
    expect(FP.Eq(hit!.point.y, prev.y)).toBe(true);
    expect(FP.Eq(hit!.point.z, prev.z)).toBe(true);
  });

  it('produces point == lerp(prev, cur, t)', () => {
    const prev = v(4, 2, -3);
    const cur = v(-2, -1, 1);
    const hit = segmentVsAABB(prev, cur, unitBox);
    expect(hit).not.toBeNull();
    const t = FP.ToFloat(hit!.t);
    const expX = FP.ToFloat(FP.Lerp(prev.x, cur.x, hit!.t));
    const expY = FP.ToFloat(FP.Lerp(prev.y, cur.y, hit!.t));
    const expZ = FP.ToFloat(FP.Lerp(prev.z, cur.z, hit!.t));
    expect(near(FP.ToFloat(hit!.point.x), expX)).toBe(true);
    expect(near(FP.ToFloat(hit!.point.y), expY)).toBe(true);
    expect(near(FP.ToFloat(hit!.point.z), expZ)).toBe(true);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);
  });

  it('handles a zero-length segment outside the box (null)', () => {
    const hit = segmentVsAABB(v(5, 5, 5), v(5, 5, 5), unitBox);
    expect(hit).toBeNull();
  });

  it('handles a zero-length segment inside the box (t=0)', () => {
    const prev = v(0, 0, 0);
    const hit = segmentVsAABB(prev, prev, unitBox);
    expect(hit).not.toBeNull();
    expect(FP.Eq(hit!.t, FP._0)).toBe(true);
    expect(FP.Eq(hit!.point.x, prev.x)).toBe(true);
  });

  it('resolves a segment parallel to a slab deterministically (no NaN)', () => {
    // dy = 0, dz = 0; only X varies. Grazes at y = 1 (top plane), outside interior.
    const hit = segmentVsAABB(v(-5, 1, 0), v(5, 1, 0), unitBox);
    // Either a deterministic hit or null — never NaN.
    if (hit !== null) {
      expect(Number.isNaN(FP.ToFloat(hit.t))).toBe(false);
      expect(Number.isNaN(FP.ToFloat(hit.point.x))).toBe(false);
      expect(Number.isNaN(FP.ToFloat(hit.normal.x))).toBe(false);
    }
    // Clearly-outside parallel segment must miss.
    expect(segmentVsAABB(v(-5, 2, 0), v(5, 2, 0), unitBox)).toBeNull();
  });

  it('is deterministic: identical inputs yield identical results', () => {
    const a = segmentVsAABB(v(3, 0.25, -0.5), v(-3, 0.25, -0.5), unitBox);
    const b = segmentVsAABB(v(3, 0.25, -0.5), v(-3, 0.25, -0.5), unitBox);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(FP.Eq(a!.t, b!.t)).toBe(true);
    expect(FP.Eq(a!.point.x, b!.point.x)).toBe(true);
    expect(FP.Eq(a!.point.y, b!.point.y)).toBe(true);
    expect(FP.Eq(a!.point.z, b!.point.z)).toBe(true);
    expect(FP.Eq(a!.normal.x, b!.normal.x)).toBe(true);
    expect(FP.Eq(a!.normal.y, b!.normal.y)).toBe(true);
    expect(FP.Eq(a!.normal.z, b!.normal.z)).toBe(true);
  });
});

describe('PhysicsWorld.raycastSegment', () => {
  const boxAt = (cx: number): AABB => ({
    minX: FP.FromFloat(cx - 1),
    minY: FP.FromFloat(-1),
    minZ: FP.FromFloat(-1),
    maxX: FP.FromFloat(cx + 1),
    maxY: FP.FromFloat(1),
    maxZ: FP.FromFloat(1),
  });

  it('returns the nearest box hit (smallest t)', () => {
    const world = new PhysicsWorld();
    const farBox = boxAt(10);
    const nearBox = boxAt(4);
    const prev = v(0, 0, 0);
    const cur = v(20, 0, 0);

    const hit = world.raycastSegment(prev, cur, [farBox, nearBox]);
    expect(hit).not.toBeNull();
    // Nearer box entry is at x = 3 → t = 3/20 = 0.15.
    expect(near(FP.ToFloat(hit!.t), 0.15)).toBe(true);
    expect(near(FP.ToFloat(hit!.point.x), 3)).toBe(true);
    world.dispose();
  });

  it('returns null for an empty box list', () => {
    const world = new PhysicsWorld();
    const hit = world.raycastSegment(v(0, 0, 0), v(10, 0, 0), []);
    expect(hit).toBeNull();
    world.dispose();
  });

  it('returns null when no box is intersected', () => {
    const world = new PhysicsWorld();
    const hit = world.raycastSegment(v(0, 5, 0), v(20, 5, 0), [boxAt(4), boxAt(10)]);
    expect(hit).toBeNull();
    world.dispose();
  });
});
