import type { FixedPoint } from '@phalanx-engine/math';

/**
 * Result of a narrow-phase collision test between two entities.
 */
export interface CollisionManifold {
  /** First entity ID */
  entityA: number;
  /** Second entity ID */
  entityB: number;
  /** Collision normal X (direction A → B) */
  normalX: FixedPoint;
  /** Collision normal Z (direction A → B) */
  normalZ: FixedPoint;
  /** Overlap depth */
  penetration: FixedPoint;
}
