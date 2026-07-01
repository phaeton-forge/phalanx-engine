import type { FixedPoint } from '@phalanx-engine/math';
import type { IPhysicsTickProvider } from './tick/IPhysicsTickProvider';

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
  /** Push strength for collision resolution (used by the 'push' response) */
  pushStrength?: FixedPoint;

  /**
   * Collision response model: `'push'` (default, positional separation only)
   * or `'impulse'` (momentum-conserving elastic collision along the normal).
   * See PhysicsConfig.collisionResponse for details.
   */
  collisionResponse?: 'push' | 'impulse';

  /**
   * Coefficient of restitution `e` for the `'impulse'` response.
   * Falls back to per-body restitution when omitted. Ignored by `'push'`.
   */
  restitution?: FixedPoint;

  /**
   * Optional custom tick provider.
   * When set, PhysicsSystem.processTick() becomes a no-op and the provider
   * drives the simulation via PhysicsSystem.step().
   * Omit to use default GameWorld-driven mode.
   */
  tickProvider?: IPhysicsTickProvider;

  /**
   * When true, bodies exiting worldBounds are ejected instead of clamped.
   * Default: false
   */
  ejectOnBoundsExit?: boolean;

  /**
   * Velocity magnitude threshold below which a body is considered settled.
   * Used by PhysicsSystem.isSettled().
   * Default: FP.FromFloat(0.01)
   */
  settleThreshold?: FixedPoint;
}
