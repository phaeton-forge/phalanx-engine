import type { SystemContext } from '../core/SystemContext';
import { GameSystem } from './GameSystem';
import { ComponentType, MovementComponent, TeamComponent } from '../components';
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
  unitRadius: FixedPoint; // Collision radius for units
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
 * PhysicsBody - Stores physics state for an entity
 * Uses fixed-point arithmetic for deterministic simulation
 */
export interface PhysicsBody {
  entityId: number;
  velocity: FPVector3Type; // Fixed-point velocity for deterministic physics
  radius: FixedPoint; // Fixed-point radius
  mass: FixedPoint; // Fixed-point mass
  isStatic: boolean; // Static bodies don't move (towers, bases)
  // Cached position for spatial hashing (kept as numbers for grid indexing)
  lastX: number;
  lastZ: number;
}

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
 */
export class PhysicsSystem extends GameSystem {
  private config: PhysicsConfig;
  private bodies: Map<number, PhysicsBody> = new Map();
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
   * Register an entity with the physics system
   * @param entityId - The entity ID to register
   * @param options - Optional physics body configuration (accepts numbers for convenience)
   */
  public registerBody(
    entityId: number,
    options: { radius?: number; mass?: number; isStatic?: boolean } = {}
  ): void {
    this.bodies.set(entityId, {
      entityId,
      velocity: { x: FP._0, y: FP._0, z: FP._0 },
      radius: options.radius !== undefined ? FP.FromFloat(options.radius) : this.config.unitRadius,
      mass: options.mass !== undefined ? FP.FromFloat(options.mass) : FP._1,
      isStatic: options.isStatic ?? false,
      lastX: 0,
      lastZ: 0,
    });
  }

  /**
   * Unregister an entity from the physics system
   */
  public unregisterBody(entityId: number): void {
    this.bodies.delete(entityId);
  }

  /**
   * Get physics body for an entity
   */
  public getBody(entityId: number): PhysicsBody | undefined {
    return this.bodies.get(entityId);
  }

  /**
   * Set velocity for an entity (using fixed-point)
   */
  public setVelocity(entityId: number, velocity: FPVector3Type): void {
    const body = this.bodies.get(entityId);
    if (body && !body.isStatic) {
      body.velocity.x = velocity.x;
      body.velocity.y = velocity.y;
      body.velocity.z = velocity.z;
    }
  }


  /**
   * Add velocity to an entity (using fixed-point)
   */
  public addVelocity(entityId: number, velocity: FPVector3Type): void {
    const body = this.bodies.get(entityId);
    if (body && !body.isStatic) {
      body.velocity.x = FP.Add(body.velocity.x, velocity.x);
      body.velocity.y = FP.Add(body.velocity.y, velocity.y);
      body.velocity.z = FP.Add(body.velocity.z, velocity.z);
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
   * Update velocities for entities with movement targets
   * Uses fixed-point math to avoid floating-point determinism issues
   */
  private updateMovementVelocities(): void {
    // Use sorted entity list for deterministic ordering
    const movableEntities = this.entityManager.queryEntities(
      ComponentType.Movement
    );

    for (const entity of movableEntities) {
      const movement = entity.getComponent<MovementComponent>(
        ComponentType.Movement
      );
      const body = this.bodies.get(entity.id);

      if (!movement || !body || body.isStatic) continue;

      // Skip entities that should be ignored by physics (e.g., dying units)
      if (entity.ignorePhysics) {
        body.velocity.x = FP._0;
        body.velocity.z = FP._0;
        continue;
      }

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
          body.velocity.x = FP._0;
          body.velocity.z = FP._0;
        } else {
          // Set velocity towards target using fixed-point
          const dist = FP.Sqrt(distSq);
          const speed = FP.FromFloat(movement.speed);
          body.velocity.x = FP.Mul(FP.Div(dx, dist), speed);
          body.velocity.z = FP.Mul(FP.Div(dz, dist), speed);
        }
      } else {
        // Unit is not moving - stop any residual velocity
        // This handles cases where combat system stopped the unit
        body.velocity.x = FP._0;
        body.velocity.z = FP._0;
      }
    }
  }

  /**
   * Rebuild spatial grid each physics tick
   * Caches entity positions for collision detection
   *
   * IMPORTANT: Processes bodies in deterministic order (sorted by entity ID)
   * for network synchronization.
   */
  private rebuildSpatialGrid(): void {
    this.spatialGrid.clear();

    // Sort bodies by entity ID for deterministic iteration order
    const sortedBodies = Array.from(this.bodies.values()).sort(
      (a, b) => a.entityId - b.entityId
    );

    for (const body of sortedBodies) {
      const entity = this.entityManager.getEntity(body.entityId);
      if (!entity) continue;

      // Convert fixed-point position to numbers for spatial grid indexing
      const fpPos = entity.fpPosition;
      body.lastX = FP.ToFloat(fpPos.x);
      body.lastZ = FP.ToFloat(fpPos.z);
      const radiusNum = FP.ToFloat(body.radius);
      this.spatialGrid.insert(body.entityId, body.lastX, body.lastZ, radiusNum);
    }
  }

  /**
   * Resolve collisions using spatial hashing
   * Average case O(n) instead of O(n²)
   * Uses fixed-point arithmetic for deterministic collision resolution
   *
   * IMPORTANT: Processes bodies in deterministic order (sorted by entity ID)
   * for network synchronization.
   */
  private resolveCollisions(): void {
    this.checkedPairs.clear();

    // Sort bodies by entity ID for deterministic iteration order
    const sortedBodies = Array.from(this.bodies.values()).sort(
      (a, b) => a.entityId - b.entityId
    );

    for (const bodyA of sortedBodies) {
      const entityA = this.entityManager.getEntity(bodyA.entityId);
      if (!entityA) continue;

      const posAx = bodyA.lastX;
      const posAz = bodyA.lastZ;
      const radiusANum = FP.ToFloat(bodyA.radius);

      // Get only nearby bodies from spatial grid
      // Search radius includes own radius plus max possible other radius
      const nearby = this.spatialGrid.getPotentialCollisions(
        posAx,
        posAz,
        radiusANum + this.unitRadiusNum * 2
      );

      for (const otherEntityId of nearby) {
        // Skip self and ensure we only check each pair once (lower ID first)
        if (otherEntityId <= bodyA.entityId) continue;

        const pairKey = `${bodyA.entityId},${otherEntityId}`;
        if (this.checkedPairs.has(pairKey)) continue;
        this.checkedPairs.add(pairKey);

        const bodyB = this.bodies.get(otherEntityId);
        if (!bodyB) continue;

        const entityB = this.entityManager.getEntity(bodyB.entityId);
        if (!entityB) continue;

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
            bodyA.velocity.x = FP.Sub(bodyA.velocity.x, FP.Mul(nx, pushA));
            bodyA.velocity.z = FP.Sub(bodyA.velocity.z, FP.Mul(nz, pushA));
          }

          if (!bodyB.isStatic) {
            const pushB = FP.Mul(pushForce, ratioB);
            bodyB.velocity.x = FP.Add(bodyB.velocity.x, FP.Mul(nx, pushB));
            bodyB.velocity.z = FP.Add(bodyB.velocity.z, FP.Mul(nz, pushB));
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
   * IMPORTANT: Processes bodies in deterministic order (sorted by entity ID)
   * for network synchronization.
   */
  private applyVelocities(dt: FixedPoint): void {
    // Pre-compute max velocity squared for clamping
    const maxVelSq = FP.Mul(this.config.maxVelocity, this.config.maxVelocity);

    // Sort bodies by entity ID for deterministic iteration order
    const sortedBodies = Array.from(this.bodies.values()).sort(
      (a, b) => a.entityId - b.entityId
    );

    for (const body of sortedBodies) {
      if (body.isStatic) continue;

      const entity = this.entityManager.getEntity(body.entityId);
      if (!entity) continue;

      // Clamp velocity to max (using squared magnitude to avoid sqrt when possible)
      const velMagSq = FP.Add(
        FP.Mul(body.velocity.x, body.velocity.x),
        FP.Mul(body.velocity.z, body.velocity.z)
      );

      if (FP.Gt(velMagSq, maxVelSq)) {
        const scale = FP.Div(this.config.maxVelocity, FP.Sqrt(velMagSq));
        body.velocity.x = FP.Mul(body.velocity.x, scale);
        body.velocity.z = FP.Mul(body.velocity.z, scale);
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
   * IMPORTANT: Processes bodies in deterministic order (sorted by entity ID)
   * for network synchronization.
   */
  private applyFriction(): void {
    // Sort bodies by entity ID for deterministic iteration order
    const sortedBodies = Array.from(this.bodies.values()).sort(
      (a, b) => a.entityId - b.entityId
    );

    for (const body of sortedBodies) {
      if (body.isStatic) continue;

      // Check if entity is actively moving to a target
      const entity = this.entityManager.getEntity(body.entityId);
      if (!entity) continue;

      const movement = entity.getComponent<MovementComponent>(
        ComponentType.Movement
      );

      // Only apply friction if not actively moving to a target
      // This allows pushing to have an effect while still allowing controlled movement
      if (!movement || !movement.isMoving) {
        body.velocity.x = FP.Mul(body.velocity.x, this.config.friction);
        body.velocity.z = FP.Mul(body.velocity.z, this.config.friction);

        // Stop very small velocities (using fixed-point comparison)
        if (FP.Lt(FP.Abs(body.velocity.x), FP_VELOCITY_EPSILON)) {
          body.velocity.x = FP._0;
        }
        if (FP.Lt(FP.Abs(body.velocity.z), FP_VELOCITY_EPSILON)) {
          body.velocity.z = FP._0;
        }
      }
    }
  }

  /**
   * Check if collision should be skipped between two entities
   * - Entities with ignorePhysics flag set should not participate in collisions
   * - Units don't collide with friendly buildings (bases, towers)
   */
  private shouldSkipCollision(
    entityA: import('../entities/Entity').Entity,
    entityB: import('../entities/Entity').Entity,
    bodyA: PhysicsBody,
    bodyB: PhysicsBody
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
    this.bodies.clear();
    this.spatialGrid.clear();
    this.checkedPairs.clear();
  }
}
