import type { FixedPoint } from 'phalanx-math';
import type { CollisionManifold } from './collision/CollisionManifold';

/**
 * Maps consumer's TransformComponent SoA field names to physics expectations.
 * Tells PhysicsSystem which fields in the consumer's transform store
 * correspond to fpPositionX, fpPositionY, fpPositionZ.
 *
 * Optional `visualPositionX/Y/Z` fields: when provided, the systems will
 * also sync float visual positions whenever fp positions are written.
 * This is useful when game systems read a cached float position during ticks.
 */
export interface TransformFieldMapping {
  fpPositionX: string;
  fpPositionY: string;
  fpPositionZ: string;
  /** Optional f64 visual position field name for X. Written as FP.ToFloat(fpX). */
  visualPositionX?: string;
  /** Optional f64 visual position field name for Y. Written as FP.ToFloat(fpY). */
  visualPositionY?: string;
  /** Optional f64 visual position field name for Z. Written as FP.ToFloat(fpZ). */
  visualPositionZ?: string;
}

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
