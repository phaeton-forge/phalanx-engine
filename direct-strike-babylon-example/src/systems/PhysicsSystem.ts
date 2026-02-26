import type { SystemContext } from 'phalanx-ecs';
import { GameSystem } from 'phalanx-ecs';
import type { Unit } from '../entities/Unit';
import { ComponentType, MovementComponent, TeamComponent, PhysicsBodyComponent } from '../components';
import { networkConfig } from '../config/constants';
import {
  FP,
  type FixedPoint,
  type FPVector3 as FPVector3Type,
} from 'phalanx-math';

/**
 * Physics configuration for deterministic simulation
 * All values are in fixed-point for deterministic calculations
 */
export interface PhysicsConfig {
  fixedTimestep: FixedPoint; // Fixed delta time for deterministic updates
  unitRadius: FixedPoint; // Collision radius for units (default for entities without custom radius)
  pushStrength: FixedPoint; // How strongly units push each other
  maxVelocity: FixedPoint; // Maximum velocity magnitude
  friction: FixedPoint; // Friction coefficient (0-1)
  cellSize: number; // Spatial grid cell size (kept as number for grid indexing)
}

// Pre-computed fixed-point constants for physics calculations
const FP_ARRIVAL_THRESHOLD_SQ = FP.FromFloat(0.25); // 0.5^2
const FP_MIN_DIST_SQ_EPSILON = FP.FromFloat(0.0001);
const FP_SEPARATION_HALF = FP.FromFloat(0.5);
const FP_VELOCITY_EPSILON = FP.FromFloat(0.01);

const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  fixedTimestep: FP.FromFloat(networkConfig.tickTimestep / networkConfig.physicsSubsteps), // Physics substeps per tick
  unitRadius: FP.FromFloat(1.0), // Units have radius of 1 (diameter 2 matches sphere mesh)
  pushStrength: FP.FromFloat(15.0), // Push force multiplier
  maxVelocity: FP.FromFloat(15.0), // Max speed
  friction: FP.FromFloat(0.92), // Velocity damping per frame
  cellSize: 8.0, // Should be >= 2 * max(unitRadius)
};

/**
 * Spatial hash grid for O(n) average-case collision detection
 * Divides the world into cells and only checks collisions between entities in nearby cells
 */
class SpatialGrid {
  private cellSize: number;
  private cells: Map<string, number[]> = new Map();

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  public clear(): void {
    this.cells.clear();
  }

  /**
   * Insert an entity into all cells it overlaps
   */
  public insert(entityId: number, x: number, z: number, radius: number): void {
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCz = Math.floor((z - radius) / this.cellSize);
    const maxCz = Math.floor((z + radius) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = `${cx},${cz}`;
        let cell = this.cells.get(key);
        if (!cell) {
          cell = [];
          this.cells.set(key, cell);
        }
        cell.push(entityId);
      }
    }
  }

  /**
   * Get all entity IDs that might collide with a circle at (x, z) with given radius
   *
   * IMPORTANT: Returns entity IDs in sorted order for deterministic collision
   * processing across all clients.
   */
  public getPotentialCollisions(
    x: number,
    z: number,
    radius: number
  ): number[] {
    const result: number[] = [];
    const seen = new Set<number>();

    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCz = Math.floor((z - radius) / this.cellSize);
    const maxCz = Math.floor((z + radius) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = `${cx},${cz}`;
        const cell = this.cells.get(key);
        if (cell) {
          for (const id of cell) {
            if (!seen.has(id)) {
              seen.add(id);
              result.push(id);
            }
          }
        }
      }
    }

    // Sort by entity ID for deterministic ordering across all clients
    result.sort((a, b) => a - b);

    return result;
  }
}

/**
 * PhysicsSystem - Optimized deterministic physics simulation
 * Uses fixed-point arithmetic for reproducible results across clients
 * Uses spatial hashing for O(n) average-case collision detection
 * Minimizes allocations for mobile performance
 * Extends GameSystem for consistent lifecycle management
 *
 * Following ECS principles: queries entities with PhysicsBodyComponent
 * instead of maintaining internal state.
 */
export class PhysicsSystem extends GameSystem {
  private config: PhysicsConfig;
  private spatialGrid: SpatialGrid;

  // Collision pair tracking to avoid duplicate checks
  private readonly checkedPairs: Set<string> = new Set();

  // Cached number values from fixed-point config (for spatial grid operations)
  private readonly unitRadiusNum: number;

  constructor(config?: Partial<PhysicsConfig>) {
    super();
    this.config = { ...DEFAULT_PHYSICS_CONFIG, ...config };
    this.spatialGrid = new SpatialGrid(this.config.cellSize);
    // Cache number value for spatial grid operations
    this.unitRadiusNum = FP.ToFloat(this.config.unitRadius);
  }

  /**
   * Initialize the system with context
   */
  public override init(context: SystemContext): void {
    super.init(context);
  }

  /**
   * Set velocity for an entity (using fixed-point)
   */
  public setVelocity(entityId: number, velocity: FPVector3Type): void {
    const entity = this.entityManager.getEntity(entityId);
    const body = entity?.getComponent<PhysicsBodyComponent>(ComponentType.PhysicsBody);
    if (body && !body.isStatic) {
      body.velocity = velocity;
    }
  }

  /**
   * Add velocity to an entity (using fixed-point)
   */
  public addVelocity(entityId: number, velocity: FPVector3Type): void {
    const entity = this.entityManager.getEntity(entityId);
    const body = entity?.getComponent<PhysicsBodyComponent>(ComponentType.PhysicsBody);
    if (body && !body.isStatic) {
      body.addVelocity(velocity);
    }
  }

  /**
   * Process one network tick worth of physics
   * Called exactly once per network tick for deterministic lockstep simulation
   * Runs multiple physics substeps per tick for accuracy
   */
  public override processTick(_tick: number): void {
    const substepDt = this.config.fixedTimestep;
    const substeps = networkConfig.physicsSubsteps;

    for (let i = 0; i < substeps; i++) {
      this.fixedUpdate(substepDt);
    }
  }

  /**
   * Fixed timestep physics update - deterministic using fixed-point arithmetic
   */
  private fixedUpdate(dt: FixedPoint): void {
    // Update velocities based on movement targets
    this.updateMovementVelocities();

    // Rebuild spatial grid for collision detection
    this.rebuildSpatialGrid();

    // Resolve collisions between nearby bodies
    this.resolveCollisions();

    // Apply velocities to positions
    this.applyVelocities(dt);

    // Apply friction
    this.applyFriction();
  }

  /**
   * Query physics entities, cast to Unit[] for access to fpPosition/ignorePhysics
   */
  private queryPhysicsEntities(): Unit[] {
    return this.entityManager.queryEntities(ComponentType.PhysicsBody) as Unit[];
  }

  /**
   * Update velocities for entities with movement targets
   * Uses fixed-point math to avoid floating-point determinism issues
   */
  private updateMovementVelocities(): void {
    // Query entities that have both Movement and PhysicsBody components
    // entityManager.queryEntities returns sorted list for deterministic ordering
    const physicsEntities = this.queryPhysicsEntities();

    for (const entity of physicsEntities) {
      const body = entity.getComponent<PhysicsBodyComponent>(ComponentType.PhysicsBody);
      const movement = entity.getComponent<MovementComponent>(ComponentType.Movement);

      if (!body || body.isStatic) continue;

      // Skip entities that should be ignored by physics (e.g., dying units)
      if (entity.ignorePhysics) {
        body.stopVelocity();
        continue;
      }

      // If no movement component, entity doesn't move by itself
      if (!movement) continue;

      if (movement.isMoving) {
        const target = movement.targetPosition;
        const pos = entity.fpPosition;

        // Calculate direction using fixed-point math
        const dx = FP.Sub(FP.FromFloat(target.x), pos.x);
        const dz = FP.Sub(FP.FromFloat(target.z), pos.z);
        const distSq = FP.Add(
          FP.Mul(dx, dx),
          FP.Mul(dz, dz)
        );

        if (FP.Lt(distSq, FP_ARRIVAL_THRESHOLD_SQ)) {
          // Arrived at destination
          movement.stop();
          body.stopVelocity();
        } else {
          // Set velocity towards target using fixed-point
          const dist = FP.Sqrt(distSq);
          const speed = FP.FromFloat(movement.speed);
          body.setVelocity(
            FP.Mul(FP.Div(dx, dist), speed),
            FP._0,
            FP.Mul(FP.Div(dz, dist), speed)
          );
        }
      } else {
        // Unit is not moving - stop any residual velocity
        // This handles cases where combat system stopped the unit
        body.stopVelocity();
      }
    }
  }

  /**
   * Rebuild spatial grid each physics tick
   * Caches entity positions for collision detection
   *
   * IMPORTANT: Processes entities in deterministic order (sorted by entity ID)
   * for network synchronization.
   */
  private rebuildSpatialGrid(): void {
    this.spatialGrid.clear();

    // Query entities with PhysicsBody component (already sorted by ID)
    const physicsEntities = this.queryPhysicsEntities();

    for (const entity of physicsEntities) {
      const body = entity.getComponent<PhysicsBodyComponent>(ComponentType.PhysicsBody);
      if (!body) continue;

      // Convert fixed-point position to numbers for spatial grid indexing
      const fpPos = entity.fpPosition;
      body.lastX = FP.ToFloat(fpPos.x);
      body.lastZ = FP.ToFloat(fpPos.z);
      this.spatialGrid.insert(entity.id, body.lastX, body.lastZ, body.radiusFloat);
    }
  }

  /**
   * Resolve collisions using spatial hashing
   * Average case O(n) instead of O(n²)
   * Uses fixed-point arithmetic for deterministic collision resolution
   *
   * IMPORTANT: Processes entities in deterministic order (sorted by entity ID)
   * for network synchronization.
   */
  private resolveCollisions(): void {
    this.checkedPairs.clear();

    // Query entities with PhysicsBody component (already sorted by ID)
    const physicsEntities = this.queryPhysicsEntities();

    for (const entityA of physicsEntities) {
      const bodyA = entityA.getComponent<PhysicsBodyComponent>(ComponentType.PhysicsBody);
      if (!bodyA) continue;

      const posAx = bodyA.lastX;
      const posAz = bodyA.lastZ;
      const radiusANum = bodyA.radiusFloat;

      // Get only nearby bodies from spatial grid
      // Search radius includes own radius plus max possible other radius
      const nearby = this.spatialGrid.getPotentialCollisions(
        posAx,
        posAz,
        radiusANum + this.unitRadiusNum * 2
      );

      for (const otherEntityId of nearby) {
        // Skip self and ensure we only check each pair once (lower ID first)
        if (otherEntityId <= entityA.id) continue;

        const pairKey = `${entityA.id},${otherEntityId}`;
        if (this.checkedPairs.has(pairKey)) continue;
        this.checkedPairs.add(pairKey);

        const entityB = this.entityManager.getEntity(otherEntityId) as Unit | undefined;
        if (!entityB) continue;

        const bodyB = entityB.getComponent<PhysicsBodyComponent>(ComponentType.PhysicsBody);
        if (!bodyB) continue;

        // Skip collision between units and friendly buildings (bases/towers)
        // Units should pass through their own team's structures
        if (this.shouldSkipCollision(entityA, entityB, bodyA, bodyB)) {
          continue;
        }

        // Use fixed-point positions for deterministic collision calculation
        const fpPosA = entityA.fpPosition;
        const fpPosB = entityB.fpPosition;

        // Calculate distance in XZ plane using fixed-point
        const dx = FP.Sub(fpPosB.x, fpPosA.x);
        const dz = FP.Sub(fpPosB.z, fpPosA.z);
        const distSq = FP.Add(
          FP.Mul(dx, dx),
          FP.Mul(dz, dz)
        );
        const minDist = FP.Add(bodyA.radius, bodyB.radius);
        const minDistSq = FP.Mul(minDist, minDist);

        if (FP.Lt(distSq, minDistSq) && FP.Gt(distSq, FP_MIN_DIST_SQ_EPSILON)) {
          // Collision detected - use fixed-point math for resolution
          const dist = FP.Sqrt(distSq);
          const overlap = FP.Sub(minDist, dist);

          // Normalize direction (fixed-point)
          const nx = FP.Div(dx, dist);
          const nz = FP.Div(dz, dist);

          // Calculate push force based on overlap
          const pushForce = FP.Mul(overlap, this.config.pushStrength);

          // Apply push based on mass ratio
          const totalMass = FP.Add(bodyA.mass, bodyB.mass);
          const ratioA = FP.Div(bodyB.mass, totalMass);
          const ratioB = FP.Div(bodyA.mass, totalMass);

          // Apply push velocities (fixed-point)
          if (!bodyA.isStatic) {
            const pushA = FP.Mul(pushForce, ratioA);
            const vel = bodyA.velocity;
            bodyA.setVelocity(
              FP.Sub(vel.x, FP.Mul(nx, pushA)),
              vel.y,
              FP.Sub(vel.z, FP.Mul(nz, pushA))
            );
          }

          if (!bodyB.isStatic) {
            const pushB = FP.Mul(pushForce, ratioB);
            const vel = bodyB.velocity;
            bodyB.setVelocity(
              FP.Add(vel.x, FP.Mul(nx, pushB)),
              vel.y,
              FP.Add(vel.z, FP.Mul(nz, pushB))
            );
          }

          // Separate positions to prevent overlap (fixed-point)
          const separation = FP.Mul(overlap, FP_SEPARATION_HALF);
          if (!bodyA.isStatic) {
            const sepA = FP.Mul(separation, ratioA);
            entityA.fpPosition = {
              x: FP.Sub(fpPosA.x, FP.Mul(nx, sepA)),
              y: fpPosA.y,
              z: FP.Sub(fpPosA.z, FP.Mul(nz, sepA)),
            };
          }
          if (!bodyB.isStatic) {
            const sepB = FP.Mul(separation, ratioB);
            entityB.fpPosition = {
              x: FP.Add(fpPosB.x, FP.Mul(nx, sepB)),
              y: fpPosB.y,
              z: FP.Add(fpPosB.z, FP.Mul(nz, sepB)),
            };
          }
        }
      }
    }
  }

  /**
   * Apply velocities to entity positions using fixed-point arithmetic
   *
   * IMPORTANT: Processes entities in deterministic order (sorted by entity ID)
   * for network synchronization.
   */
  private applyVelocities(dt: FixedPoint): void {
    // Pre-compute max velocity squared for clamping
    const maxVelSq = FP.Mul(this.config.maxVelocity, this.config.maxVelocity);

    // Query entities with PhysicsBody component (already sorted by ID)
    const physicsEntities = this.queryPhysicsEntities();

    for (const entity of physicsEntities) {
      const body = entity.getComponent<PhysicsBodyComponent>(ComponentType.PhysicsBody);
      if (!body || body.isStatic) continue;

      const vel = body.velocity;

      // Clamp velocity to max (using squared magnitude to avoid sqrt when possible)
      const velMagSq = FP.Add(
        FP.Mul(vel.x, vel.x),
        FP.Mul(vel.z, vel.z)
      );

      if (FP.Gt(velMagSq, maxVelSq)) {
        const scale = FP.Div(this.config.maxVelocity, FP.Sqrt(velMagSq));
        body.setVelocity(
          FP.Mul(vel.x, scale),
          vel.y,
          FP.Mul(vel.z, scale)
        );
      }

      // Apply velocity to position using fixed-point
      const fpPos = entity.fpPosition;
      entity.fpPosition = {
        x: FP.Add(fpPos.x, FP.Mul(body.velocity.x, dt)),
        y: fpPos.y, // Keep Y constant
        z: FP.Add(fpPos.z, FP.Mul(body.velocity.z, dt)),
      };
    }
  }

  /**
   * Apply friction to slow down units using fixed-point arithmetic
   *
   * IMPORTANT: Processes entities in deterministic order (sorted by entity ID)
   * for network synchronization.
   */
  private applyFriction(): void {
    // Query entities with PhysicsBody component (already sorted by ID)
    const physicsEntities = this.queryPhysicsEntities();

    for (const entity of physicsEntities) {
      const body = entity.getComponent<PhysicsBodyComponent>(ComponentType.PhysicsBody);
      if (!body || body.isStatic) continue;

      const movement = entity.getComponent<MovementComponent>(
        ComponentType.Movement
      );

      // Only apply friction if not actively moving to a target
      // This allows pushing to have an effect while still allowing controlled movement
      if (!movement || !movement.isMoving) {
        const vel = body.velocity;
        let newVelX = FP.Mul(vel.x, this.config.friction);
        let newVelZ = FP.Mul(vel.z, this.config.friction);

        // Stop very small velocities (using fixed-point comparison)
        if (FP.Lt(FP.Abs(newVelX), FP_VELOCITY_EPSILON)) {
          newVelX = FP._0;
        }
        if (FP.Lt(FP.Abs(newVelZ), FP_VELOCITY_EPSILON)) {
          newVelZ = FP._0;
        }

        body.setVelocity(newVelX, vel.y, newVelZ);
      }
    }
  }

  /**
   * Check if collision should be skipped between two entities
   * - Entities with ignorePhysics flag set should not participate in collisions
   * - Units don't collide with friendly buildings (bases, towers)
   */
  private shouldSkipCollision(
    entityA: Unit,
    entityB: Unit,
    bodyA: PhysicsBodyComponent,
    bodyB: PhysicsBodyComponent
  ): boolean {
    // Skip collisions with entities that should be ignored (dying, phasing, etc.)
    if (entityA.ignorePhysics || entityB.ignorePhysics) {
      return true;
    }

    // If neither is static, they should collide (unit vs unit)
    if (!bodyA.isStatic && !bodyB.isStatic) {
      return false;
    }

    // Get team components
    const teamA = entityA.getComponent<TeamComponent>(ComponentType.Team);
    const teamB = entityB.getComponent<TeamComponent>(ComponentType.Team);

    // If either doesn't have a team, let them collide
    if (!teamA || !teamB) {
      return false;
    }

    // If they're on the same team and one is static (building),
    // skip the collision so units can pass through friendly buildings
    return teamA.team === teamB.team && (bodyA.isStatic || bodyB.isStatic);
  }

  /**
   * Dispose the physics system
   */
  public override dispose(): void {
    super.dispose(); // Clean up subscriptions from base class
    this.spatialGrid.clear();
    this.checkedPairs.clear();
  }
}
