import { describe, it, expect } from 'vitest';
import { FP } from '@phalanx-engine/math';
import { segmentVsAABB } from '../src/collision/Raycast';
import type { AABB3 } from '../src/collision/Raycast';
import { PhysicsWorld } from '../src/PhysicsWorld';

const F = (n: number) => FP.FromFloat(n);
const box = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): AABB3 => ({
  minX: F(minX), minY: F(minY), minZ: F(minZ),
  maxX: F(maxX), maxY: F(maxY), maxZ: F(maxZ),
});

describe('segmentVsAABB', () => {
  describe('hits', () => {
    it('hits the -X face when moving in +X', () => {
      // Box occupies x in [2,4], y in [0,2], z in [0,2].
      // Segment from (0,1,1) to (6,1,1): enters through minX face.
      const hit = segmentVsAABB(
        { x: F(0), y: F(1), z: F(1) },
        { x: F(6), y: F(1), z: F(1) },
        box(2, 0, 0, 4, 2, 2),
      );
      expect(hit).not.toBeNull();
      expect(FP.ToFloat(hit!.t)).toBeCloseTo(2 / 6, 5); // t = (2-0)/6
      // Entry through minX face -> outward normal (-1,0,0).
      expect(FP.ToFloat(hit!.normal.x)).toBeCloseTo(-1, 5);
      expect(FP.ToFloat(hit!.normal.y)).toBeCloseTo(0, 5);
      expect(FP.ToFloat(hit!.normal.z)).toBeCloseTo(0, 5);
      // Point lies on the entry face: x = 2, y = z = 1 (4-decimal FP tolerance).
      expect(FP.ToFloat(hit!.point.x)).toBeCloseTo(2, 4);
      expect(FP.ToFloat(hit!.point.y)).toBeCloseTo(1, 4);
      expect(FP.ToFloat(hit!.point.z)).toBeCloseTo(1, 4);
    });

    it('hits the +Y face when falling from above', () => {
      // Box y in [0,2]; segment from (1,5,1) to (1,-1,1) falls through top.
      const hit = segmentVsAABB(
        { x: F(1), y: F(5), z: F(1) },
        { x: F(1), y: F(-1), z: F(1) },
        box(0, 0, 0, 2, 2, 2),
      );
      expect(hit).not.toBeNull();
      // d_y < 0 -> enters through maxY face -> outward normal (0,1,0).
      expect(FP.ToFloat(hit!.normal.x)).toBeCloseTo(0, 5);
      expect(FP.ToFloat(hit!.normal.y)).toBeCloseTo(1, 5);
      expect(FP.ToFloat(hit!.normal.z)).toBeCloseTo(0, 5);
      expect(FP.ToFloat(hit!.point.y)).toBeCloseTo(2, 5); // on top face
    });

    it('point equals lerp(prev, cur, t)', () => {
      const prev = { x: F(-3), y: F(1), z: F(7) };
      const cur = { x: F(5), y: F(1), z: F(-1) };
      const hit = segmentVsAABB(prev, cur, box(0, 0, 0, 2, 2, 2));
      expect(hit).not.toBeNull();
      const t = FP.ToFloat(hit!.t);
      const px = FP.ToFloat(prev.x) + t * (FP.ToFloat(cur.x) - FP.ToFloat(prev.x));
      const pz = FP.ToFloat(prev.z) + t * (FP.ToFloat(cur.z) - FP.ToFloat(prev.z));
      expect(FP.ToFloat(hit!.point.x)).toBeCloseTo(px, 4);
      expect(FP.ToFloat(hit!.point.z)).toBeCloseTo(pz, 4);
    });
  });

  describe('misses', () => {
    it('returns null when the segment passes outside the box', () => {
      const hit = segmentVsAABB(
        { x: F(0), y: F(0), z: F(5) },
        { x: F(10), y: F(0), z: F(5) },
        box(2, 0, 0, 4, 2, 2), // box z in [0,2], segment at z=5
      );
      expect(hit).toBeNull();
    });

    it('returns null when the box is entirely before the segment start', () => {
      // Box x in [-10,-5]; segment from (0,1,1) to (6,1,1) moving +x.
      const hit = segmentVsAABB(
        { x: F(0), y: F(1), z: F(1) },
        { x: F(6), y: F(1), z: F(1) },
        box(-10, 0, 0, -5, 2, 2),
      );
      expect(hit).toBeNull();
    });

    it('returns null when the box is entirely beyond the segment end', () => {
      const hit = segmentVsAABB(
        { x: F(0), y: F(1), z: F(1) },
        { x: F(1), y: F(1), z: F(1) }, // ends before reaching box at x=2
        box(2, 0, 0, 4, 2, 2),
      );
      expect(hit).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('reports t=0 at prev when the segment starts inside the box', () => {
      const prev = { x: F(1), y: F(1), z: F(1) };
      const cur = { x: F(1.5), y: F(1), z: F(1) };
      const hit = segmentVsAABB(prev, cur, box(0, 0, 0, 2, 2, 2));
      expect(hit).not.toBeNull();
      expect(FP.ToFloat(hit!.t)).toBeCloseTo(0, 5);
      expect(FP.ToFloat(hit!.point.x)).toBeCloseTo(1, 5);
    });

    it('returns the nearest face normal for a moving segment that starts inside', () => {
      // prev=(1.5,1,1) is closest to the maxX face (dist 0.5) -> normal (1,0,0).
      const hit = segmentVsAABB(
        { x: F(1.5), y: F(1), z: F(1) },
        { x: F(1.9), y: F(1), z: F(1) },
        box(0, 0, 0, 2, 2, 2),
      );
      expect(hit).not.toBeNull();
      expect(FP.ToFloat(hit!.t)).toBeCloseTo(0, 5);
      expect(FP.ToFloat(hit!.normal.x)).toBeCloseTo(1, 5);
      expect(FP.ToFloat(hit!.normal.y)).toBeCloseTo(0, 5);
      expect(FP.ToFloat(hit!.normal.z)).toBeCloseTo(0, 5);
    });

    it('returns a face normal when the segment is a point inside the box', () => {
      const p = { x: F(1), y: F(1), z: F(1) };
      const hit = segmentVsAABB(p, p, box(0, 0, 0, 2, 2, 2));
      expect(hit).not.toBeNull();
      expect(FP.ToFloat(hit!.t)).toBeCloseTo(0, 5);
      // Normal must be a unit axis vector (one component ±1, others 0).
      const nx = FP.ToFloat(hit!.normal.x);
      const ny = FP.ToFloat(hit!.normal.y);
      const nz = FP.ToFloat(hit!.normal.z);
      const mag = Math.sqrt(nx * nx + ny * ny + nz * nz);
      expect(mag).toBeCloseTo(1, 5);
    });

    it('returns null for a zero-length segment outside the box', () => {
      const p = { x: F(5), y: F(5), z: F(5) };
      expect(segmentVsAABB(p, p, box(0, 0, 0, 2, 2, 2))).toBeNull();
    });

    it('handles a segment parallel to a slab without NaN', () => {
      // Movement only along X (y,z constant and inside the slab) -> hit on X face.
      const hit = segmentVsAABB(
        { x: F(0), y: F(1), z: F(1) },
        { x: F(6), y: F(1), z: F(1) },
        box(2, 0, 0, 4, 2, 2),
      );
      expect(hit).not.toBeNull();
      expect(Number.isNaN(FP.ToFloat(hit!.point.x))).toBe(false);
    });
  });

  describe('determinism', () => {
    it('produces identical results for identical inputs across runs', () => {
      const prev = { x: F(0), y: F(1), z: F(1) };
      const cur = { x: F(6), y: F(1), z: F(1) };
      const b = box(2, 0, 0, 4, 2, 2);
      const a = segmentVsAABB(prev, cur, b);
      const bb = segmentVsAABB(prev, cur, b);
      expect(a).not.toBeNull();
      expect(bb).not.toBeNull();
      expect(FP.ToRaw(a!.t)).toBe(FP.ToRaw(bb!.t));
      expect(FP.ToRaw(a!.point.x)).toBe(FP.ToRaw(bb!.point.x));
      expect(FP.ToRaw(a!.normal.x)).toBe(FP.ToRaw(bb!.normal.x));
    });
  });
});

describe('PhysicsWorld.raycastSegment', () => {
  it('returns null for an empty box list', () => {
    const world = new PhysicsWorld();
    const hit = world.raycastSegment(
      { x: F(0), y: F(0), z: F(0) },
      { x: F(10), y: F(0), z: F(0) },
      [],
    );
    expect(hit).toBeNull();
  });

  it('returns the nearest of multiple hits', () => {
    const world = new PhysicsWorld();
    const boxes: AABB3[] = [
      box(4, 0, 0, 6, 2, 2),  // farther along +X
      box(2, 0, 0, 3, 2, 2),  // nearer
    ];
    const hit = world.raycastSegment(
      { x: F(0), y: F(1), z: F(1) },
      { x: F(10), y: F(1), z: F(1) },
      boxes,
    );
    expect(hit).not.toBeNull();
    // Nearest box enters at x=2 -> t = 2/10 = 0.2.
    expect(FP.ToFloat(hit!.t)).toBeCloseTo(0.2, 5);
    expect(FP.ToFloat(hit!.point.x)).toBeCloseTo(2, 5);
  });

  it('returns null when no box is hit', () => {
    const world = new PhysicsWorld();
    const hit = world.raycastSegment(
      { x: F(0), y: F(0), z: F(5) },
      { x: F(10), y: F(0), z: F(5) },
      [box(2, 0, 0, 4, 2, 2)],
    );
    expect(hit).toBeNull();
  });
});
