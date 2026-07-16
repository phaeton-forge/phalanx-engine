import type { FixedPoint } from '@phalanx-engine/math';
import type { CollisionManifold } from './collision/CollisionManifold';

/**
 * Bitmask-based collision filtering.
 * @remarks Defined for future use. Not yet integrated into PhysicsSystem.
 * The current per-pair callback filter (`setCollisionFilter`) is the active API.
 * Bitmask integration is planned for v2 as a performance optimization.
 */
export interface CollisionFilter {
  /** Bitmask: what layer this entity is on */
  category: number;
  /** Bitmask: what layers this entity collides with */
  mask: number;
}

/**
 * Collision event data emitted via EventBus.
 */
export interface CollisionEvent {
  entityA: number;
  entityB: number;
  manifold: CollisionManifold;
}

/**
 * Event emitted when a body exits worldBounds and ejectOnBoundsExit is true.
 */
export interface BoundsExitEvent {
  entityId: number;
}

/**
 * Configuration for PhysicsSystem velocity integration.
 */
export interface PhysicsConfig {
  /** Fixed-point delta time per sub-step */
  tickDt: FixedPoint;
  /** Number of sub-steps per tick */
  subSteps: number;
  /** Maximum velocity magnitude */
  maxVelocity: FixedPoint;
  /** Default friction applied per sub-step when entity friction field is 0 */
  defaultFriction: FixedPoint;
  /** Push strength for collision resolution (used by the 'push' response) */
  pushStrength: FixedPoint;
  /**
   * Collision response model.
   * - `'push'` (default): positional separation with a mass-weighted push
   *   velocity. Fast, stable, but does NOT conserve momentum — a fast body
   *   slides past a slower one instead of knocking it away.
   * - `'impulse'`: momentum-conserving elastic collision along the contact
   *   normal (restitution coefficient `e`). Restores the "click / knock-away"
   *   feel needed for games like Chapayev checkers.
   *
   * Default: `'push'`.
   */
  collisionResponse?: 'push' | 'impulse';
  /**
   * Coefficient of restitution `e` for the `'impulse'` response
   * (0 = perfectly inelastic, 1 = perfectly elastic). When omitted, the
   * impulse path falls back to the average of the two bodies' per-body
   * restitution. Ignored by the `'push'` response.
   */
  restitution?: FixedPoint;
  /** Spatial hash grid cell size */
  gridCellSize: FixedPoint;
  /** World bounds for position clamping (optional) */
  worldBounds?: {
    minX: FixedPoint;
    minZ: FixedPoint;
    maxX: FixedPoint;
    maxZ: FixedPoint;
  };
  /**
   * When true, bodies that exit worldBounds are ejected:
   * ignorePhysics is set to 1, velocity is zeroed, BOUNDS_EXIT is emitted.
   * When false (default), bodies are clamped to the boundary.
   */
  ejectOnBoundsExit?: boolean;
  /**
   * Gravitational acceleration magnitude applied by GravitySystem to bodies
   * with `useGravity=true`. Default 0 (no gravity → GravitySystem is a no-op).
   */
  gravity?: FixedPoint;
  /**
   * Axis along which gravity is applied. Default `'y'`. In v1 only `'y'` is
   * supported: X/Z are owned by PhysicsSystem's position integrator, so gravity
   * on those axes would double-integrate. `'x'`/`'z'` are reserved and cause
   * GravitySystem to throw.
   */
  gravityAxis?: 'x' | 'y' | 'z';
}

/**
 * Configuration for the PhysicsBodyComponent constructor.
 */
export interface PhysicsBodyConfig {
  radius: FixedPoint;
  mass?: FixedPoint;
  isStatic?: boolean;
  restitution?: FixedPoint;
  friction?: FixedPoint;
  /**
   * When true, GravitySystem applies gravitational acceleration to this body's
   * velocity each tick (default false). Existing bodies keep `useGravity=false`
   * and are unaffected. Integration of the resulting velocity into position is
   * still owned by PhysicsSystem.
   */
  useGravity?: boolean;
}
