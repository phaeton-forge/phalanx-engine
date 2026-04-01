import { describe, it, expect } from 'vitest';
import { FP } from 'phalanx-math';
import { NarrowPhase } from '../src/collision/NarrowPhase';

describe('NarrowPhase', () => {
  describe('circleVsCircle', () => {
    it('returns manifold for overlapping circles', () => {
      const result = NarrowPhase.circleVsCircle(
        FP.FromFloat(0), FP.FromFloat(0), FP.FromFloat(1),
        FP.FromFloat(1.5), FP.FromFloat(0), FP.FromFloat(1),
        1, 2
      );
      expect(result).not.toBeNull();
      expect(result!.entityA).toBe(1);
      expect(result!.entityB).toBe(2);
      expect(FP.Gt(result!.penetration, FP._0)).toBe(true);
    });

    it('returns null for separated circles', () => {
      const result = NarrowPhase.circleVsCircle(
        FP.FromFloat(0), FP.FromFloat(0), FP.FromFloat(1),
        FP.FromFloat(5), FP.FromFloat(0), FP.FromFloat(1),
        1, 2
      );
      expect(result).toBeNull();
    });

    it('returns null for touching circles (no overlap)', () => {
      const result = NarrowPhase.circleVsCircle(
        FP.FromFloat(0), FP.FromFloat(0), FP.FromFloat(1),
        FP.FromFloat(2), FP.FromFloat(0), FP.FromFloat(1),
        1, 2
      );
      expect(result).toBeNull();
    });

    it('collision normal points from A to B', () => {
      const result = NarrowPhase.circleVsCircle(
        FP.FromFloat(0), FP.FromFloat(0), FP.FromFloat(1),
        FP.FromFloat(1), FP.FromFloat(0), FP.FromFloat(1),
        1, 2
      );
      expect(result).not.toBeNull();
      // Normal should point in +X direction (from A toward B)
      expect(FP.Gt(result!.normalX, FP._0)).toBe(true);
    });

    it('handles coincident circles', () => {
      const result = NarrowPhase.circleVsCircle(
        FP.FromFloat(5), FP.FromFloat(5), FP.FromFloat(1),
        FP.FromFloat(5), FP.FromFloat(5), FP.FromFloat(1),
        1, 2
      );
      expect(result).not.toBeNull();
      // Default normal should be (1, 0) for coincident positions
      expect(FP.Eq(result!.normalX, FP._1)).toBe(true);
      expect(FP.Eq(result!.normalZ, FP._0)).toBe(true);
    });

    it('penetration depth is correct', () => {
      // Two circles of radius 1, centers 1 apart -> overlap 1
      const result = NarrowPhase.circleVsCircle(
        FP.FromFloat(0), FP.FromFloat(0), FP.FromFloat(1),
        FP.FromFloat(1), FP.FromFloat(0), FP.FromFloat(1),
        1, 2
      );
      expect(result).not.toBeNull();
      const pen = FP.ToFloat(result!.penetration);
      expect(pen).toBeCloseTo(1.0, 2);
    });
  });

  describe('circleVsAABB', () => {
    it('returns manifold for overlapping circle and AABB', () => {
      const result = NarrowPhase.circleVsAABB(
        FP.FromFloat(2.5), FP.FromFloat(0), FP.FromFloat(1),
        FP.FromFloat(0), FP.FromFloat(-1),
        FP.FromFloat(2), FP.FromFloat(1),
        1, 2
      );
      expect(result).not.toBeNull();
      expect(FP.Gt(result!.penetration, FP._0)).toBe(true);
    });

    it('returns null for separated circle and AABB', () => {
      const result = NarrowPhase.circleVsAABB(
        FP.FromFloat(10), FP.FromFloat(10), FP.FromFloat(1),
        FP.FromFloat(0), FP.FromFloat(0),
        FP.FromFloat(2), FP.FromFloat(2),
        1, 2
      );
      expect(result).toBeNull();
    });

    it('detects circle center inside AABB', () => {
      const result = NarrowPhase.circleVsAABB(
        FP.FromFloat(1), FP.FromFloat(1), FP.FromFloat(0.5),
        FP.FromFloat(0), FP.FromFloat(0),
        FP.FromFloat(3), FP.FromFloat(3),
        1, 2
      );
      expect(result).not.toBeNull();
    });
  });

  describe('aabbVsAABB', () => {
    it('returns manifold for overlapping AABBs', () => {
      const result = NarrowPhase.aabbVsAABB(
        FP.FromFloat(0), FP.FromFloat(0), FP.FromFloat(2), FP.FromFloat(2),
        FP.FromFloat(1), FP.FromFloat(1), FP.FromFloat(3), FP.FromFloat(3),
        1, 2
      );
      expect(result).not.toBeNull();
      expect(FP.Gt(result!.penetration, FP._0)).toBe(true);
    });

    it('returns null for separated AABBs', () => {
      const result = NarrowPhase.aabbVsAABB(
        FP.FromFloat(0), FP.FromFloat(0), FP.FromFloat(1), FP.FromFloat(1),
        FP.FromFloat(5), FP.FromFloat(5), FP.FromFloat(6), FP.FromFloat(6),
        1, 2
      );
      expect(result).toBeNull();
    });

    it('returns null for touching AABBs (no overlap)', () => {
      const result = NarrowPhase.aabbVsAABB(
        FP.FromFloat(0), FP.FromFloat(0), FP.FromFloat(1), FP.FromFloat(1),
        FP.FromFloat(1), FP.FromFloat(0), FP.FromFloat(2), FP.FromFloat(1),
        1, 2
      );
      expect(result).toBeNull();
    });

    it('resolves on minimum penetration axis', () => {
      // X overlap = 0.5, Z overlap = 1.0 -> should resolve on X
      const result = NarrowPhase.aabbVsAABB(
        FP.FromFloat(0), FP.FromFloat(0), FP.FromFloat(2), FP.FromFloat(3),
        FP.FromFloat(1.5), FP.FromFloat(0), FP.FromFloat(4), FP.FromFloat(2),
        1, 2
      );
      expect(result).not.toBeNull();
      // Should resolve on X axis (normalZ = 0)
      expect(FP.Eq(result!.normalZ, FP._0)).toBe(true);
    });
  });
});
