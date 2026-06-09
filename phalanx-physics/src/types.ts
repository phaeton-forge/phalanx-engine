import type { FixedPoint } from 'phalanx-math';
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
  /** Push strength for collision resolution */
  pushStrength: FixedPoint;
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
}
