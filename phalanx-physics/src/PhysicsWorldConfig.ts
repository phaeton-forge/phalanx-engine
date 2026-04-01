import type { FixedPoint } from 'phalanx-math';

/**
 * High-level configuration for PhysicsWorld facade.
 */
export interface PhysicsWorldConfig {
  /** Spatial hash grid cell size (default FP.FromFloat(4)) */
  gridCellSize?: FixedPoint;
  /** Number of physics sub-steps per tick (default 3) */
  subSteps?: number;
  /** Tick rate in Hz, used to compute tickDt (default 20) */
  tickRate?: number;
  /** Optional arena bounds for position clamping */
  worldBounds?: {
    minX: FixedPoint;
    minZ: FixedPoint;
    maxX: FixedPoint;
    maxZ: FixedPoint;
  };
  /** Default restitution for new physics bodies (default FP.FromFloat(0.5)) */
  defaultRestitution?: FixedPoint;
  /** Default friction for new physics bodies (default FP.FromFloat(0.3)) */
  defaultFriction?: FixedPoint;
  /** Maximum velocity magnitude */
  maxVelocity?: FixedPoint;
  /** Push strength for collision resolution */
  pushStrength?: FixedPoint;
}
