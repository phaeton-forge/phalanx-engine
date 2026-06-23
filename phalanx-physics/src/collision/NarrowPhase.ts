import { FP, type FixedPoint } from '@phalanx-engine/math';
import type { CollisionManifold } from './CollisionManifold';

/** Small epsilon to avoid division by zero in collision normals */
const EPSILON = FP.FromFloat(0.0001);

/**
 * Deterministic narrow-phase collision detection algorithms.
 *
 * All methods are static, pure functions using only `FP.*` operations
 * from phalanx-math. No native Math.* or floating-point arithmetic.
 */
export class NarrowPhase {
  /**
   * Circle vs Circle collision test (XZ plane).
   * Returns a manifold if the circles overlap, or null if separated.
   */
  static circleVsCircle(
    posAX: FixedPoint, posAZ: FixedPoint, radiusA: FixedPoint,
    posBX: FixedPoint, posBZ: FixedPoint, radiusB: FixedPoint,
    entityA: number, entityB: number
  ): CollisionManifold | null {
    const dx = FP.Sub(posBX, posAX);
    const dz = FP.Sub(posBZ, posAZ);
    const distSq = FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz));

    const minDist = FP.Add(radiusA, radiusB);
    const minDistSq = FP.Mul(minDist, minDist);

    if (FP.Gte(distSq, minDistSq)) {
      return null;
    }

    // Check for nearly-coincident positions
    if (FP.Lte(distSq, FP.Mul(EPSILON, EPSILON))) {
      // Default separation direction when objects are on top of each other
      return {
        entityA,
        entityB,
        normalX: FP._1,
        normalZ: FP._0,
        penetration: minDist,
      };
    }

    const dist = FP.Sqrt(distSq);
    const penetration = FP.Sub(minDist, dist);
    const normalX = FP.Div(dx, dist);
    const normalZ = FP.Div(dz, dist);

    return { entityA, entityB, normalX, normalZ, penetration };
  }

  /**
   * Circle vs AABB collision test (XZ plane).
   * The normal points from the circle to the AABB.
   *
   * @remarks Implemented and tested but not yet wired into collision dispatch.
   * AABB collision requires a `shapeType` field on PhysicsBodyComponent to determine
   * which narrow-phase algorithm to use. Planned for v2.
   */
  static circleVsAABB(
    circlePosX: FixedPoint, circlePosZ: FixedPoint, circleRadius: FixedPoint,
    aabbMinX: FixedPoint, aabbMinZ: FixedPoint,
    aabbMaxX: FixedPoint, aabbMaxZ: FixedPoint,
    entityCircle: number, entityAABB: number
  ): CollisionManifold | null {
    // Find the closest point on the AABB to the circle center
    const closestX = FP.Clamp(circlePosX, aabbMinX, aabbMaxX);
    const closestZ = FP.Clamp(circlePosZ, aabbMinZ, aabbMaxZ);

    const dx = FP.Sub(circlePosX, closestX);
    const dz = FP.Sub(circlePosZ, closestZ);
    const distSq = FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz));
    const radiusSq = FP.Mul(circleRadius, circleRadius);

    if (FP.Gte(distSq, radiusSq)) {
      return null;
    }

    // Coincident check
    if (FP.Lte(distSq, FP.Mul(EPSILON, EPSILON))) {
      // Circle center is inside AABB — push along shortest axis
      const halfW = FP.Mul(FP.Sub(aabbMaxX, aabbMinX), FP.FromFloat(0.5));
      const halfH = FP.Mul(FP.Sub(aabbMaxZ, aabbMinZ), FP.FromFloat(0.5));
      const centerX = FP.Add(aabbMinX, halfW);
      const centerZ = FP.Add(aabbMinZ, halfH);
      const ox = FP.Sub(circlePosX, centerX);
      const oz = FP.Sub(circlePosZ, centerZ);
      const overlapX = FP.Sub(FP.Add(halfW, circleRadius), FP.Abs(ox));
      const overlapZ = FP.Sub(FP.Add(halfH, circleRadius), FP.Abs(oz));

      if (FP.Lt(overlapX, overlapZ)) {
        const sign = FP.Gte(ox, FP._0) ? FP._1 : FP.Neg(FP._1);
        return {
          entityA: entityCircle,
          entityB: entityAABB,
          normalX: sign,
          normalZ: FP._0,
          penetration: overlapX,
        };
      } else {
        const sign = FP.Gte(oz, FP._0) ? FP._1 : FP.Neg(FP._1);
        return {
          entityA: entityCircle,
          entityB: entityAABB,
          normalX: FP._0,
          normalZ: sign,
          penetration: overlapZ,
        };
      }
    }

    const dist = FP.Sqrt(distSq);
    const penetration = FP.Sub(circleRadius, dist);
    // Normal points from AABB toward circle center
    const normalX = FP.Div(dx, dist);
    const normalZ = FP.Div(dz, dist);

    return {
      entityA: entityCircle,
      entityB: entityAABB,
      normalX,
      normalZ,
      penetration,
    };
  }

  /**
   * AABB vs AABB collision test (XZ plane).
   * Returns a manifold with the minimum penetration axis.
   *
   * @remarks Implemented and tested but not yet wired into collision dispatch.
   * AABB collision requires a `shapeType` field on PhysicsBodyComponent to determine
   * which narrow-phase algorithm to use. Planned for v2.
   */
  static aabbVsAABB(
    aMinX: FixedPoint, aMinZ: FixedPoint, aMaxX: FixedPoint, aMaxZ: FixedPoint,
    bMinX: FixedPoint, bMinZ: FixedPoint, bMaxX: FixedPoint, bMaxZ: FixedPoint,
    entityA: number, entityB: number
  ): CollisionManifold | null {
    // Check overlap on each axis
    const overlapX1 = FP.Sub(aMaxX, bMinX); // A right - B left
    const overlapX2 = FP.Sub(bMaxX, aMinX); // B right - A left
    const overlapZ1 = FP.Sub(aMaxZ, bMinZ); // A bottom - B top
    const overlapZ2 = FP.Sub(bMaxZ, aMinZ); // B bottom - A top

    // If any axis has no overlap, no collision
    if (FP.Lte(overlapX1, FP._0) || FP.Lte(overlapX2, FP._0) ||
        FP.Lte(overlapZ1, FP._0) || FP.Lte(overlapZ2, FP._0)) {
      return null;
    }

    // Find minimum overlap axis
    const minOverlapX = FP.Min(overlapX1, overlapX2);
    const minOverlapZ = FP.Min(overlapZ1, overlapZ2);

    if (FP.Lt(minOverlapX, minOverlapZ)) {
      // Resolve on X axis
      const sign = FP.Lt(overlapX1, overlapX2) ? FP._1 : FP.Neg(FP._1);
      return {
        entityA,
        entityB,
        normalX: sign,
        normalZ: FP._0,
        penetration: minOverlapX,
      };
    } else {
      // Resolve on Z axis
      const sign = FP.Lt(overlapZ1, overlapZ2) ? FP._1 : FP.Neg(FP._1);
      return {
        entityA,
        entityB,
        normalX: FP._0,
        normalZ: sign,
        penetration: minOverlapZ,
      };
    }
  }
}
