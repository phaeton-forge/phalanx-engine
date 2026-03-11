import type { SystemContext } from 'phalanx-ecs';
import { GameSystem, SoAComponentStore } from 'phalanx-ecs';
import type { Unit } from '../entities/Unit';
import { ComponentType, MovementComponent, TeamComponent, PhysicsSoASchema, TransformSoASchema } from '../components';
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

  // Direct SoA store references for hot-path access (bypasses facade overhead)
  private physicsStore!: SoAComponentStore<typeof PhysicsSoASchema.definition>;
  private transformStore!: SoAComponentStore<typeof TransformSoASchema.definition>;

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

    // Eagerly resolve SoA stores for direct array access in hot paths.
    // getOrCreateSoAStore ensures stores exist even if no entities have been created yet.
    this.physicsStore = this.entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    this.transformStore = this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  /**
   * Set velocity for an entity (using fixed-point)
   */
  public setVelocity(entityId: number, velocity: FPVector3Type): void {
    const physIndex = this.physicsStore.indexOf(entityId);
    if (physIndex === -1) return;
    if (this.physicsStore.arrays.isStatic[physIndex] === 1) return;

    this.physicsStore.arrays.velocityX[physIndex] = FP.ToRaw(velocity.x);
    this.physicsStore.arrays.velocityY[physIndex] = FP.ToRaw(velocity.y);
    this.physicsStore.arrays.velocityZ[physIndex] = FP.ToRaw(velocity.z);
  }

  /**
   * Add velocity to an entity (using fixed-point)
   */
  public addVelocity(entityId: number, velocity: FPVector3Type): void {
    const physIndex = this.physicsStore.indexOf(entityId);
    if (physIndex === -1) return;
    if (this.physicsStore.arrays.isStatic[physIndex] === 1) return;

    const currentX = FP.FromRaw(this.physicsStore.arrays.velocityX[physIndex]);
    const currentY = FP.FromRaw(this.physicsStore.arrays.velocityY[physIndex]);
    const currentZ = FP.FromRaw(this.physicsStore.arrays.velocityZ[physIndex]);

    this.physicsStore.arrays.velocityX[physIndex] = FP.ToRaw(FP.Add(currentX, velocity.x));
    this.physicsStore.arrays.velocityY[physIndex] = FP.ToRaw(FP.Add(currentY, velocity.y));
    this.physicsStore.arrays.velocityZ[physIndex] = FP.ToRaw(FP.Add(currentZ, velocity.z));
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
   * Uses direct SoA array access + AoS MovementComponent for mixed hot-path.
   * Uses fixed-point math to avoid floating-point determinism issues.
   *
   * IMPORTANT: Iterates in deterministic entity ID order via physicsStore.entityIds().
   */
  private updateMovementVelocities(): void {
    const physVelocityX = this.physicsStore.arrays.velocityX;
    const physVelocityY = this.physicsStore.arrays.velocityY;
    const physVelocityZ = this.physicsStore.arrays.velocityZ;
    const physIsStatic = this.physicsStore.arrays.isStatic;
    const physIgnorePhysics = this.physicsStore.arrays.ignorePhysics;

    const txFpPositionX = this.transformStore.arrays.fpPositionX;
    const txFpPositionZ = this.transformStore.arrays.fpPositionZ;

    const zeroRaw = FP.ToRaw(FP._0);

    for (const entityId of this.physicsStore.entityIds()) {
      const physIndex = this.physicsStore.indexOf(entityId);

      // Skip static bodies
      if (physIsStatic[physIndex] === 1) continue;

      // Skip entities that should be ignored by physics (e.g., dying units)
      if (physIgnorePhysics[physIndex] === 1) {
        physVelocityX[physIndex] = zeroRaw;
        physVelocityY[physIndex] = zeroRaw;
        physVelocityZ[physIndex] = zeroRaw;
        continue;
      }

      // MovementComponent is AoS — need entity lookup
      const entity = this.entityManager.getEntity(entityId);
      if (!entity) continue;

      const movement = entity.getComponent<MovementComponent>(ComponentType.Movement);
      if (!movement) continue;

      if (movement.isMoving) {
        const transformIndex = this.transformStore.indexOf(entityId);
        if (transformIndex === -1) continue;

        const target = movement.targetPosition;
        const posX = FP.FromRaw(txFpPositionX[transformIndex]);
        const posZ = FP.FromRaw(txFpPositionZ[transformIndex]);

        // Calculate direction using fixed-point math
        const dx = FP.Sub(FP.FromFloat(target.x), posX);
        const dz = FP.Sub(FP.FromFloat(target.z), posZ);
        const distSq = FP.Add(
          FP.Mul(dx, dx),
          FP.Mul(dz, dz)
        );

        if (FP.Lt(distSq, FP_ARRIVAL_THRESHOLD_SQ)) {
          // Arrived at destination
          movement.stop();
          physVelocityX[physIndex] = zeroRaw;
          physVelocityY[physIndex] = zeroRaw;
          physVelocityZ[physIndex] = zeroRaw;
        } else {
          // Set velocity towards target using fixed-point
          const dist = FP.Sqrt(distSq);
          const speed = FP.FromFloat(movement.speed);
          physVelocityX[physIndex] = FP.ToRaw(FP.Mul(FP.Div(dx, dist), speed));
          physVelocityY[physIndex] = zeroRaw;
          physVelocityZ[physIndex] = FP.ToRaw(FP.Mul(FP.Div(dz, dist), speed));
        }
      } else {
        // Unit is not moving - stop any residual velocity
        physVelocityX[physIndex] = zeroRaw;
        physVelocityY[physIndex] = zeroRaw;
        physVelocityZ[physIndex] = zeroRaw;
      }
    }
  }

  /**
   * Rebuild spatial grid each physics tick
   * Uses direct SoA array access — pure store iteration, no entity lookups.
   *
   * IMPORTANT: Iterates in deterministic entity ID order via physicsStore.entityIds().
   */
  private rebuildSpatialGrid(): void {
    this.spatialGrid.clear();

    const physLastX = this.physicsStore.arrays.lastX;
    const physLastZ = this.physicsStore.arrays.lastZ;
    const physRadius = this.physicsStore.arrays.radius;

    const txFpPositionX = this.transformStore.arrays.fpPositionX;
    const txFpPositionZ = this.transformStore.arrays.fpPositionZ;

    for (const entityId of this.physicsStore.entityIds()) {
      const physIndex = this.physicsStore.indexOf(entityId);
      const transformIndex = this.transformStore.indexOf(entityId);
      if (transformIndex === -1) continue;

      // Convert fixed-point position to numbers for spatial grid indexing
      const posXFloat = FP.ToFloat(FP.FromRaw(txFpPositionX[transformIndex]));
      const posZFloat = FP.ToFloat(FP.FromRaw(txFpPositionZ[transformIndex]));
      physLastX[physIndex] = posXFloat;
      physLastZ[physIndex] = posZFloat;

      const radiusFloat = FP.ToFloat(FP.FromRaw(physRadius[physIndex]));
      this.spatialGrid.insert(entityId, posXFloat, posZFloat, radiusFloat);
    }
  }

  /**
   * Resolve collisions using spatial hashing
   * Average case O(n) instead of O(n²)
   * Uses direct SoA array access for all physics/transform data.
   * Entity lookups only for TeamComponent (AoS) in shouldSkipCollision.
   *
   * IMPORTANT: Iterates in deterministic entity ID order via physicsStore.entityIds().
   */
  private resolveCollisions(): void {
    this.checkedPairs.clear();

    const physVelocityX = this.physicsStore.arrays.velocityX;
    const physVelocityY = this.physicsStore.arrays.velocityY;
    const physVelocityZ = this.physicsStore.arrays.velocityZ;
    const physRadius = this.physicsStore.arrays.radius;
    const physMass = this.physicsStore.arrays.mass;
    const physIsStatic = this.physicsStore.arrays.isStatic;
    const physIgnorePhysics = this.physicsStore.arrays.ignorePhysics;
    const physLastX = this.physicsStore.arrays.lastX;
    const physLastZ = this.physicsStore.arrays.lastZ;

    const txFpPositionX = this.transformStore.arrays.fpPositionX;
    const txFpPositionY = this.transformStore.arrays.fpPositionY;
    const txFpPositionZ = this.transformStore.arrays.fpPositionZ;
    const txVisualPositionX = this.transformStore.arrays.visualPositionX;
    const txVisualPositionY = this.transformStore.arrays.visualPositionY;
    const txVisualPositionZ = this.transformStore.arrays.visualPositionZ;

    for (const entityIdA of this.physicsStore.entityIds()) {
      const physIndexA = this.physicsStore.indexOf(entityIdA);

      const posAx = physLastX[physIndexA];
      const posAz = physLastZ[physIndexA];
      const radiusAFloat = FP.ToFloat(FP.FromRaw(physRadius[physIndexA]));

      // Get only nearby bodies from spatial grid
      const nearby = this.spatialGrid.getPotentialCollisions(
        posAx,
        posAz,
        radiusAFloat + this.unitRadiusNum * 2
      );

      for (const entityIdB of nearby) {
        // Skip self and ensure we only check each pair once (lower ID first)
        if (entityIdB <= entityIdA) continue;

        const pairKey = `${entityIdA},${entityIdB}`;
        if (this.checkedPairs.has(pairKey)) continue;
        this.checkedPairs.add(pairKey);

        const physIndexB = this.physicsStore.indexOf(entityIdB);
        if (physIndexB === -1) continue;

        // Skip collisions with entities that should be ignored (dying, phasing, etc.)
        if (physIgnorePhysics[physIndexA] === 1 || physIgnorePhysics[physIndexB] === 1) {
          continue;
        }

        const isStaticA = physIsStatic[physIndexA] === 1;
        const isStaticB = physIsStatic[physIndexB] === 1;

        // Skip collision between units and friendly buildings — needs TeamComponent (AoS)
        if (isStaticA || isStaticB) {
          const entityA = this.entityManager.getEntity(entityIdA) as Unit | undefined;
          const entityB = this.entityManager.getEntity(entityIdB) as Unit | undefined;
          if (!entityA || !entityB) continue;

          const teamA = entityA.getComponent<TeamComponent>(ComponentType.Team);
          const teamB = entityB.getComponent<TeamComponent>(ComponentType.Team);
          if (teamA && teamB && teamA.team === teamB.team) {
            continue;
          }
        }

        const transformIndexA = this.transformStore.indexOf(entityIdA);
        const transformIndexB = this.transformStore.indexOf(entityIdB);
        if (transformIndexA === -1 || transformIndexB === -1) continue;

        // Use fixed-point positions for deterministic collision calculation
        const fpPosAx = FP.FromRaw(txFpPositionX[transformIndexA]);
        const fpPosAz = FP.FromRaw(txFpPositionZ[transformIndexA]);
        const fpPosBx = FP.FromRaw(txFpPositionX[transformIndexB]);
        const fpPosBz = FP.FromRaw(txFpPositionZ[transformIndexB]);

        // Calculate distance in XZ plane using fixed-point
        const dx = FP.Sub(fpPosBx, fpPosAx);
        const dz = FP.Sub(fpPosBz, fpPosAz);
        const distSq = FP.Add(
          FP.Mul(dx, dx),
          FP.Mul(dz, dz)
        );

        const radiusA = FP.FromRaw(physRadius[physIndexA]);
        const radiusB = FP.FromRaw(physRadius[physIndexB]);
        const minDist = FP.Add(radiusA, radiusB);
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
          const massA = FP.FromRaw(physMass[physIndexA]);
          const massB = FP.FromRaw(physMass[physIndexB]);
          const totalMass = FP.Add(massA, massB);
          const ratioA = FP.Div(massB, totalMass);
          const ratioB = FP.Div(massA, totalMass);

          // Apply push velocities (fixed-point) — direct array writes
          if (!isStaticA) {
            const pushA = FP.Mul(pushForce, ratioA);
            const velAx = FP.FromRaw(physVelocityX[physIndexA]);
            const velAy = FP.FromRaw(physVelocityY[physIndexA]);
            const velAz = FP.FromRaw(physVelocityZ[physIndexA]);
            physVelocityX[physIndexA] = FP.ToRaw(FP.Sub(velAx, FP.Mul(nx, pushA)));
            physVelocityY[physIndexA] = FP.ToRaw(velAy);
            physVelocityZ[physIndexA] = FP.ToRaw(FP.Sub(velAz, FP.Mul(nz, pushA)));
          }

          if (!isStaticB) {
            const pushB = FP.Mul(pushForce, ratioB);
            const velBx = FP.FromRaw(physVelocityX[physIndexB]);
            const velBy = FP.FromRaw(physVelocityY[physIndexB]);
            const velBz = FP.FromRaw(physVelocityZ[physIndexB]);
            physVelocityX[physIndexB] = FP.ToRaw(FP.Add(velBx, FP.Mul(nx, pushB)));
            physVelocityY[physIndexB] = FP.ToRaw(velBy);
            physVelocityZ[physIndexB] = FP.ToRaw(FP.Add(velBz, FP.Mul(nz, pushB)));
          }

          // Separate positions to prevent overlap (fixed-point)
          const separation = FP.Mul(overlap, FP_SEPARATION_HALF);
          if (!isStaticA) {
            const sepA = FP.Mul(separation, ratioA);
            const fpPosAy = FP.FromRaw(txFpPositionY[transformIndexA]);
            const newPosAx = FP.Sub(fpPosAx, FP.Mul(nx, sepA));
            const newPosAz = FP.Sub(fpPosAz, FP.Mul(nz, sepA));
            txFpPositionX[transformIndexA] = FP.ToRaw(newPosAx);
            txFpPositionZ[transformIndexA] = FP.ToRaw(newPosAz);
            // Sync visual positions
            txVisualPositionX[transformIndexA] = FP.ToFloat(newPosAx);
            txVisualPositionY[transformIndexA] = FP.ToFloat(fpPosAy);
            txVisualPositionZ[transformIndexA] = FP.ToFloat(newPosAz);
          }
          if (!isStaticB) {
            const sepB = FP.Mul(separation, ratioB);
            const fpPosBy = FP.FromRaw(txFpPositionY[transformIndexB]);
            const newPosBx = FP.Add(fpPosBx, FP.Mul(nx, sepB));
            const newPosBz = FP.Add(fpPosBz, FP.Mul(nz, sepB));
            txFpPositionX[transformIndexB] = FP.ToRaw(newPosBx);
            txFpPositionZ[transformIndexB] = FP.ToRaw(newPosBz);
            // Sync visual positions
            txVisualPositionX[transformIndexB] = FP.ToFloat(newPosBx);
            txVisualPositionY[transformIndexB] = FP.ToFloat(fpPosBy);
            txVisualPositionZ[transformIndexB] = FP.ToFloat(newPosBz);
          }
        }
      }
    }
  }

  /**
   * Apply velocities to entity positions using fixed-point arithmetic.
   * Uses direct SoA array access — pure store iteration, no entity lookups.
   *
   * IMPORTANT: Iterates in deterministic entity ID order via physicsStore.entityIds().
   */
  private applyVelocities(dt: FixedPoint): void {
    // Pre-compute max velocity squared for clamping
    const maxVelSq = FP.Mul(this.config.maxVelocity, this.config.maxVelocity);

    const physVelocityX = this.physicsStore.arrays.velocityX;
    const physVelocityZ = this.physicsStore.arrays.velocityZ;
    const physIsStatic = this.physicsStore.arrays.isStatic;

    const txFpPositionX = this.transformStore.arrays.fpPositionX;
    const txFpPositionZ = this.transformStore.arrays.fpPositionZ;
    const txVisualPositionX = this.transformStore.arrays.visualPositionX;
    const txVisualPositionZ = this.transformStore.arrays.visualPositionZ;

    for (const entityId of this.physicsStore.entityIds()) {
      const physIndex = this.physicsStore.indexOf(entityId);

      // Skip static bodies
      if (physIsStatic[physIndex] === 1) continue;

      const transformIndex = this.transformStore.indexOf(entityId);
      if (transformIndex === -1) continue;

      // Read velocity directly from typed arrays
      let velX = FP.FromRaw(physVelocityX[physIndex]);
      let velZ = FP.FromRaw(physVelocityZ[physIndex]);

      // Clamp velocity to max (using squared magnitude to avoid sqrt when possible)
      const velMagSq = FP.Add(
        FP.Mul(velX, velX),
        FP.Mul(velZ, velZ)
      );

      if (FP.Gt(velMagSq, maxVelSq)) {
        const scale = FP.Div(this.config.maxVelocity, FP.Sqrt(velMagSq));
        velX = FP.Mul(velX, scale);
        velZ = FP.Mul(velZ, scale);
        physVelocityX[physIndex] = FP.ToRaw(velX);
        physVelocityZ[physIndex] = FP.ToRaw(velZ);
      }

      // Apply velocity to position using fixed-point
      const posX = FP.FromRaw(txFpPositionX[transformIndex]);
      const posZ = FP.FromRaw(txFpPositionZ[transformIndex]);

      const newPosX = FP.Add(posX, FP.Mul(velX, dt));
      const newPosZ = FP.Add(posZ, FP.Mul(velZ, dt));

      // Write back fp positions
      txFpPositionX[transformIndex] = FP.ToRaw(newPosX);
      txFpPositionZ[transformIndex] = FP.ToRaw(newPosZ);

      // Sync visual positions
      txVisualPositionX[transformIndex] = FP.ToFloat(newPosX);
      txVisualPositionZ[transformIndex] = FP.ToFloat(newPosZ);
    }
  }

  /**
   * Apply friction to slow down units using fixed-point arithmetic.
   * Uses direct SoA array access + AoS MovementComponent check.
   *
   * IMPORTANT: Iterates in deterministic entity ID order via physicsStore.entityIds().
   */
  private applyFriction(): void {
    const physVelocityX = this.physicsStore.arrays.velocityX;
    const physVelocityY = this.physicsStore.arrays.velocityY;
    const physVelocityZ = this.physicsStore.arrays.velocityZ;
    const physIsStatic = this.physicsStore.arrays.isStatic;

    for (const entityId of this.physicsStore.entityIds()) {
      const physIndex = this.physicsStore.indexOf(entityId);

      // Skip static bodies
      if (physIsStatic[physIndex] === 1) continue;

      // MovementComponent is AoS — need entity lookup
      const entity = this.entityManager.getEntity(entityId);
      const movement = entity?.getComponent<MovementComponent>(ComponentType.Movement);

      // Only apply friction if not actively moving to a target
      if (!movement || !movement.isMoving) {
        const velX = FP.FromRaw(physVelocityX[physIndex]);
        const velY = FP.FromRaw(physVelocityY[physIndex]);
        const velZ = FP.FromRaw(physVelocityZ[physIndex]);

        let newVelX = FP.Mul(velX, this.config.friction);
        let newVelZ = FP.Mul(velZ, this.config.friction);

        // Stop very small velocities (using fixed-point comparison)
        if (FP.Lt(FP.Abs(newVelX), FP_VELOCITY_EPSILON)) {
          newVelX = FP._0;
        }
        if (FP.Lt(FP.Abs(newVelZ), FP_VELOCITY_EPSILON)) {
          newVelZ = FP._0;
        }

        physVelocityX[physIndex] = FP.ToRaw(newVelX);
        physVelocityY[physIndex] = FP.ToRaw(velY);
        physVelocityZ[physIndex] = FP.ToRaw(newVelZ);
      }
    }
  }

  // shouldSkipCollision logic is now inlined in resolveCollisions for direct SoA access

  /**
   * Dispose the physics system
   */
  public override dispose(): void {
    super.dispose(); // Clean up subscriptions from base class
    this.spatialGrid.clear();
    this.checkedPairs.clear();
  }
}
