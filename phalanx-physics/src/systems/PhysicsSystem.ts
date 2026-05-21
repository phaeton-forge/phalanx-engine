import { GameSystem, type EventBus, type SoAComponentStore, type SystemContext } from 'phalanx-ecs';
import { FP, type FixedPoint } from 'phalanx-math';
import { PhysicsSoASchema } from '../components/PhysicsBodyComponent';
import { SpatialHashGrid } from '../collision/SpatialHashGrid';
import { NarrowPhase } from '../collision/NarrowPhase';
import type { CollisionManifold } from '../collision/CollisionManifold';
import { PhysicsEvents } from '../events';
import type { PhysicsConfig, TransformFieldMapping, CollisionEvent, BoundsExitEvent } from '../types';
import type { IPhysicsTickProvider } from '../tick/IPhysicsTickProvider';
import type { SoASchemaDefinition } from 'phalanx-ecs';

const SEPARATION_HALF = FP.FromFloat(0.5);

/**
 * PhysicsSystem — deterministic physics pipeline with sub-stepping.
 *
 * Each sub-step runs the full pipeline:
 *   1. applyVelocities(subDt)  — integrate velocities into positions
 *   2. rebuildSpatialGrid()    — broad-phase spatial hashing
 *   3. detectAndResolve()      — narrow-phase collision + resolution
 *   4. applyFriction()         — per-entity friction damping
 *
 * Reads velocities from PhysicsBodyComponent SoA store and reads/writes
 * positions from the consumer's TransformComponent SoA store. The consumer
 * must call `setTransformStore()` before the first tick to link their
 * transform store.
 *
 * Does NOT own TransformComponent — accepts a reference via setTransformStore().
 */
export class PhysicsSystem extends GameSystem {
  private physicsStore!: SoAComponentStore<typeof PhysicsSoASchema.definition>;
  private transformStore: SoAComponentStore<SoASchemaDefinition> | null = null;
  private fieldMapping: TransformFieldMapping | null = null;
  private config: PhysicsConfig;
  private readonly spatialGrid: SpatialHashGrid;
  private collisionFilter: ((entityA: number, entityB: number) => boolean) | null = null;
  private externalTickProvider: IPhysicsTickProvider | null = null;
  private providerStarted = false;

  constructor(config: PhysicsConfig) {
    super();
    this.config = config;
    this.spatialGrid = new SpatialHashGrid(config.gridCellSize);
  }

  public override init(context: SystemContext): void {
    super.init(context);
    this.physicsStore = this.entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    this.tryStartProvider();
  }

  /**
   * Start the external tick provider only when ALL required state is ready.
   * Called from init(), setTransformStore(), and setTickProvider().
   */
  private tryStartProvider(): void {
    if (
      this.providerStarted ||
      !this.physicsStore ||
      !this.transformStore ||
      !this.fieldMapping ||
      !this.externalTickProvider
    ) return;
    this.providerStarted = true;
    this.externalTickProvider.start(() => this.step());
  }

  /**
   * Link the consumer's TransformComponent SoA store.
   * Must be called before the first processTick().
   */
  public setTransformStore(
    store: SoAComponentStore<SoASchemaDefinition>,
    fieldMapping: TransformFieldMapping
  ): void {
    this.transformStore = store;
    this.fieldMapping = fieldMapping;
    this.tryStartProvider();
  }

  /**
   * Set an optional collision filter. Return false to skip a pair.
   * Useful for game-specific rules like team-based collision filtering.
   */
  public setCollisionFilter(filter: (entityA: number, entityB: number) => boolean): void {
    this.collisionFilter = filter;
  }

  /**
   * Advance the simulation by one tick (all sub-steps).
   * Called by processTick() in default mode, or directly by a custom IPhysicsTickProvider.
   */
  public step(): void {
    if (!this.transformStore || !this.fieldMapping) return;
    const subDt = FP.Div(this.config.tickDt, FP.FromFloat(this.config.subSteps));
    for (let i = 0; i < this.config.subSteps; i++) {
      this.applyVelocities(subDt);
      this.rebuildSpatialGrid();
      this.detectAndResolve();
      this.applyFriction();
    }
  }

  public override processTick(_tick: number): void {
    if (this.externalTickProvider) return; // provider drives step() directly
    this.step();
  }

  /** Hand off tick control to a custom provider. */
  public setTickProvider(provider: IPhysicsTickProvider): void {
    this.externalTickProvider?.stop();
    this.providerStarted = false;
    this.externalTickProvider = provider;
    this.tryStartProvider();
  }

  /**
   * Set the velocity of a physics body ("flick" impulse).
   * Replaces any existing velocity.
   *
   * @param entityId  Target entity
   * @param vx        New velocity along X axis (FixedPoint)
   * @param vz        New velocity along Z axis (FixedPoint)
   */
  public applyImpulse(entityId: number, vx: FixedPoint, vz: FixedPoint): void {
    const physIndex = this.physicsStore.indexOf(entityId);
    if (physIndex === -1) return;
    this.physicsStore.arrays.ignorePhysics[physIndex] = 0; // re-enable if previously ejected
    this.physicsStore.arrays.velocityX[physIndex] = FP.ToRaw(vx);
    this.physicsStore.arrays.velocityZ[physIndex] = FP.ToRaw(vz);
  }

  /**
   * Returns true when all non-static, non-ignored bodies have velocity magnitude
   * below the given threshold.
   *
   * This is a pure query with no side effects. Game code is responsible for
   * interpreting what "settled" means in gameplay terms.
   *
   * @param threshold  Velocity magnitude threshold. Default: FP.FromFloat(0.01)
   */
  public isSettled(threshold?: FixedPoint): boolean {
    const thresh = threshold ?? FP.FromFloat(0.01);
    const threshSq = FP.Mul(thresh, thresh);
    const velX = this.physicsStore.arrays.velocityX;
    const velZ = this.physicsStore.arrays.velocityZ;
    const isStatic = this.physicsStore.arrays.isStatic;
    const ignore = this.physicsStore.arrays.ignorePhysics;

    for (const entityId of this.physicsStore.entityIds()) {
      const i = this.physicsStore.indexOf(entityId);
      if (isStatic[i] === 1 || ignore[i] === 1) continue;
      const vx = FP.FromRaw(velX[i]);
      const vz = FP.FromRaw(velZ[i]);
      if (FP.Gt(FP.Add(FP.Mul(vx, vx), FP.Mul(vz, vz)), threshSq)) return false;
    }
    return true;
  }

  /**
   * Integrate velocities into positions for one sub-step.
   * Uses direct SoA array access for performance.
   */
  private applyVelocities(dt: FixedPoint): void {
    const physVelocityX = this.physicsStore.arrays.velocityX;
    const physVelocityZ = this.physicsStore.arrays.velocityZ;
    const physIsStatic = this.physicsStore.arrays.isStatic;
    const physIgnorePhysics = this.physicsStore.arrays.ignorePhysics;

    const txArrays = this.transformStore!.arrays;
    const fpPosXArr = txArrays[this.fieldMapping!.fpPositionX] as BigInt64Array;
    const fpPosZArr = txArrays[this.fieldMapping!.fpPositionZ] as BigInt64Array;

    const visPosXArr = this.fieldMapping!.visualPositionX
      ? txArrays[this.fieldMapping!.visualPositionX] as Float64Array
      : null;
    const visPosZArr = this.fieldMapping!.visualPositionZ
      ? txArrays[this.fieldMapping!.visualPositionZ] as Float64Array
      : null;

    const maxVelSq = FP.Mul(this.config.maxVelocity, this.config.maxVelocity);
    const bounds = this.config.worldBounds;

    const pendingBoundsExits: BoundsExitEvent[] = [];

    for (const entityId of this.physicsStore.entityIds()) {
      const physIndex = this.physicsStore.indexOf(entityId);

      // Skip static and ignored bodies
      if (physIsStatic[physIndex] === 1) continue;
      if (physIgnorePhysics[physIndex] === 1) continue;

      const transformIndex = this.transformStore!.indexOf(entityId);
      if (transformIndex === -1) continue;

      // Read velocity
      let velX = FP.FromRaw(physVelocityX[physIndex]);
      let velZ = FP.FromRaw(physVelocityZ[physIndex]);

      // Clamp velocity to max
      const velMagSq = FP.Add(FP.Mul(velX, velX), FP.Mul(velZ, velZ));
      if (FP.Gt(velMagSq, maxVelSq)) {
        const scale = FP.Div(this.config.maxVelocity, FP.Sqrt(velMagSq));
        velX = FP.Mul(velX, scale);
        velZ = FP.Mul(velZ, scale);
        physVelocityX[physIndex] = FP.ToRaw(velX);
        physVelocityZ[physIndex] = FP.ToRaw(velZ);
      }

      // Integrate: pos += vel * dt
      const posX = FP.FromRaw(fpPosXArr[transformIndex]);
      const posZ = FP.FromRaw(fpPosZArr[transformIndex]);

      let newPosX = FP.Add(posX, FP.Mul(velX, dt));
      let newPosZ = FP.Add(posZ, FP.Mul(velZ, dt));

      // Clamp to world bounds if configured
      if (bounds) {
        const outOfBounds =
          FP.Lt(newPosX, bounds.minX) || FP.Gt(newPosX, bounds.maxX) ||
          FP.Lt(newPosZ, bounds.minZ) || FP.Gt(newPosZ, bounds.maxZ);

        if (outOfBounds && this.config.ejectOnBoundsExit) {
          this.physicsStore.arrays.ignorePhysics[physIndex] = 1;
          this.physicsStore.arrays.velocityX[physIndex] = FP.ToRaw(FP._0);
          this.physicsStore.arrays.velocityZ[physIndex] = FP.ToRaw(FP._0);
          // Clamp position to boundary to avoid spatial grid issues
          newPosX = FP.Clamp(newPosX, bounds.minX, bounds.maxX);
          newPosZ = FP.Clamp(newPosZ, bounds.minZ, bounds.maxZ);
          pendingBoundsExits.push({ entityId });
        } else {
          newPosX = FP.Clamp(newPosX, bounds.minX, bounds.maxX);
          newPosZ = FP.Clamp(newPosZ, bounds.minZ, bounds.maxZ);
        }
      }

      fpPosXArr[transformIndex] = FP.ToRaw(newPosX);
      fpPosZArr[transformIndex] = FP.ToRaw(newPosZ);

      // Sync optional visual position cache
      if (visPosXArr) visPosXArr[transformIndex] = FP.ToFloat(newPosX);
      if (visPosZArr) visPosZArr[transformIndex] = FP.ToFloat(newPosZ);
    }

    // Emit buffered BOUNDS_EXIT events after iteration completes
    for (const evt of pendingBoundsExits) {
      this.eventBus.emit(PhysicsEvents.BOUNDS_EXIT, evt);
    }
  }

  /**
   * Rebuild the spatial grid with current entity positions.
   */
  private rebuildSpatialGrid(): void {
    this.spatialGrid.clear();

    const physLastX = this.physicsStore.arrays.lastX;
    const physLastZ = this.physicsStore.arrays.lastZ;
    const physRadius = this.physicsStore.arrays.radius;

    const txArrays = this.transformStore!.arrays;
    const fpPosXArr = txArrays[this.fieldMapping!.fpPositionX] as BigInt64Array;
    const fpPosZArr = txArrays[this.fieldMapping!.fpPositionZ] as BigInt64Array;

    for (const entityId of this.physicsStore.entityIds()) {
      const physIndex = this.physicsStore.indexOf(entityId);
      const transformIndex = this.transformStore!.indexOf(entityId);
      if (transformIndex === -1) continue;

      const posX = FP.FromRaw(fpPosXArr[transformIndex]);
      const posZ = FP.FromRaw(fpPosZArr[transformIndex]);
      const radius = FP.FromRaw(physRadius[physIndex]);

      // Cache float positions for any game-side usage
      physLastX[physIndex] = FP.ToFloat(posX);
      physLastZ[physIndex] = FP.ToFloat(posZ);

      this.spatialGrid.insert(entityId, posX, posZ, radius);
    }
  }

  /**
   * Run broad-phase → narrow-phase → resolution → event emission.
   */
  private detectAndResolve(): void {
    const pairs = this.spatialGrid.queryPairs();

    const physVelocityX = this.physicsStore.arrays.velocityX;
    const physVelocityZ = this.physicsStore.arrays.velocityZ;
    const physRadius = this.physicsStore.arrays.radius;
    const physMass = this.physicsStore.arrays.mass;
    const physIsStatic = this.physicsStore.arrays.isStatic;
    const physIgnorePhysics = this.physicsStore.arrays.ignorePhysics;
    const physRestitution = this.physicsStore.arrays.restitution;

    const txArrays = this.transformStore!.arrays;
    const fpPosXArr = txArrays[this.fieldMapping!.fpPositionX] as BigInt64Array;
    const fpPosZArr = txArrays[this.fieldMapping!.fpPositionZ] as BigInt64Array;

    const visPosXArr = this.fieldMapping!.visualPositionX
      ? txArrays[this.fieldMapping!.visualPositionX] as Float64Array
      : null;
    const visPosZArr = this.fieldMapping!.visualPositionZ
      ? txArrays[this.fieldMapping!.visualPositionZ] as Float64Array
      : null;

    for (const [entityIdA, entityIdB] of pairs) {
      const physIndexA = this.physicsStore.indexOf(entityIdA);
      const physIndexB = this.physicsStore.indexOf(entityIdB);
      if (physIndexA === -1 || physIndexB === -1) continue;

      // Skip entities with ignorePhysics flag
      if (physIgnorePhysics[physIndexA] === 1 || physIgnorePhysics[physIndexB] === 1) {
        continue;
      }

      // Apply optional game-specific collision filter
      if (this.collisionFilter && !this.collisionFilter(entityIdA, entityIdB)) {
        continue;
      }

      const transformIndexA = this.transformStore!.indexOf(entityIdA);
      const transformIndexB = this.transformStore!.indexOf(entityIdB);
      if (transformIndexA === -1 || transformIndexB === -1) continue;

      // Read positions
      const posAX = FP.FromRaw(fpPosXArr[transformIndexA]);
      const posAZ = FP.FromRaw(fpPosZArr[transformIndexA]);
      const posBX = FP.FromRaw(fpPosXArr[transformIndexB]);
      const posBZ = FP.FromRaw(fpPosZArr[transformIndexB]);

      const radiusA = FP.FromRaw(physRadius[physIndexA]);
      const radiusB = FP.FromRaw(physRadius[physIndexB]);

      // Narrow-phase: circle vs circle
      const manifold = NarrowPhase.circleVsCircle(
        posAX, posAZ, radiusA,
        posBX, posBZ, radiusB,
        entityIdA, entityIdB
      );

      if (!manifold) continue;

      // Compute restitution: average of both bodies, default to 1.0 if both unset
      const restitutionA = FP.FromRaw(physRestitution[physIndexA]);
      const restitutionB = FP.FromRaw(physRestitution[physIndexB]);
      const restitution = (restitutionA === FP._0 && restitutionB === FP._0)
        ? FP._1
        : FP.Div(FP.Add(restitutionA, restitutionB), FP.FromFloat(2));

      // Resolve collision
      this.resolveCollision(
        manifold,
        restitution,
        physIndexA, physIndexB,
        transformIndexA, transformIndexB,
        physVelocityX, physVelocityZ,
        physMass, physIsStatic,
        fpPosXArr, fpPosZArr,
        visPosXArr, visPosZArr
      );

      // Emit collision event
      const event: CollisionEvent = {
        entityA: entityIdA,
        entityB: entityIdB,
        manifold,
      };
      this.eventBus.emit(PhysicsEvents.COLLISION, event);
    }
  }

  /**
   * Resolve a single collision: apply impulse + positional correction.
   */
  private resolveCollision(
    manifold: CollisionManifold,
    restitution: FixedPoint,
    physIndexA: number, physIndexB: number,
    transformIndexA: number, transformIndexB: number,
    physVelocityX: BigInt64Array, physVelocityZ: BigInt64Array,
    physMass: BigInt64Array, physIsStatic: Uint8Array,
    fpPosXArr: BigInt64Array, fpPosZArr: BigInt64Array,
    visPosXArr: Float64Array | null, visPosZArr: Float64Array | null
  ): void {
    const isStaticA = physIsStatic[physIndexA] === 1;
    const isStaticB = physIsStatic[physIndexB] === 1;

    // Both static — nothing to do
    if (isStaticA && isStaticB) return;

    const massA = FP.FromRaw(physMass[physIndexA]);
    const massB = FP.FromRaw(physMass[physIndexB]);
    const totalMass = FP.Add(massA, massB);

    const nx = manifold.normalX;
    const nz = manifold.normalZ;
    const overlap = manifold.penetration;
    const pushForce = FP.Mul(FP.Mul(overlap, this.config.pushStrength), restitution);

    // Mass ratios
    const ratioA = isStaticA ? FP._0 : (isStaticB ? FP._1 : FP.Div(massB, totalMass));
    const ratioB = isStaticB ? FP._0 : (isStaticA ? FP._1 : FP.Div(massA, totalMass));

    // Apply push velocities
    if (!isStaticA) {
      const pushA = FP.Mul(pushForce, ratioA);
      const velAx = FP.FromRaw(physVelocityX[physIndexA]);
      const velAz = FP.FromRaw(physVelocityZ[physIndexA]);
      physVelocityX[physIndexA] = FP.ToRaw(FP.Sub(velAx, FP.Mul(nx, pushA)));
      physVelocityZ[physIndexA] = FP.ToRaw(FP.Sub(velAz, FP.Mul(nz, pushA)));
    }

    if (!isStaticB) {
      const pushB = FP.Mul(pushForce, ratioB);
      const velBx = FP.FromRaw(physVelocityX[physIndexB]);
      const velBz = FP.FromRaw(physVelocityZ[physIndexB]);
      physVelocityX[physIndexB] = FP.ToRaw(FP.Add(velBx, FP.Mul(nx, pushB)));
      physVelocityZ[physIndexB] = FP.ToRaw(FP.Add(velBz, FP.Mul(nz, pushB)));
    }

    // Positional separation to prevent overlap
    const separation = FP.Mul(overlap, SEPARATION_HALF);
    if (!isStaticA) {
      const sepA = FP.Mul(separation, ratioA);
      const posAX = FP.FromRaw(fpPosXArr[transformIndexA]);
      const posAZ = FP.FromRaw(fpPosZArr[transformIndexA]);
      const newAX = FP.Sub(posAX, FP.Mul(nx, sepA));
      const newAZ = FP.Sub(posAZ, FP.Mul(nz, sepA));
      fpPosXArr[transformIndexA] = FP.ToRaw(newAX);
      fpPosZArr[transformIndexA] = FP.ToRaw(newAZ);
      if (visPosXArr) visPosXArr[transformIndexA] = FP.ToFloat(newAX);
      if (visPosZArr) visPosZArr[transformIndexA] = FP.ToFloat(newAZ);
    }
    if (!isStaticB) {
      const sepB = FP.Mul(separation, ratioB);
      const posBX = FP.FromRaw(fpPosXArr[transformIndexB]);
      const posBZ = FP.FromRaw(fpPosZArr[transformIndexB]);
      const newBX = FP.Add(posBX, FP.Mul(nx, sepB));
      const newBZ = FP.Add(posBZ, FP.Mul(nz, sepB));
      fpPosXArr[transformIndexB] = FP.ToRaw(newBX);
      fpPosZArr[transformIndexB] = FP.ToRaw(newBZ);
      if (visPosXArr) visPosXArr[transformIndexB] = FP.ToFloat(newBX);
      if (visPosZArr) visPosZArr[transformIndexB] = FP.ToFloat(newBZ);
    }
  }

  /**
   * Apply per-entity friction damping to velocities.
   * Reads the per-entity `friction` field from PhysicsBodyComponent SoA schema.
   */
  private applyFriction(): void {
    const physVelocityX = this.physicsStore.arrays.velocityX;
    const physVelocityZ = this.physicsStore.arrays.velocityZ;
    const physFriction = this.physicsStore.arrays.friction;
    const physIsStatic = this.physicsStore.arrays.isStatic;
    const physIgnore = this.physicsStore.arrays.ignorePhysics;

    for (const entityId of this.physicsStore.entityIds()) {
      const physIndex = this.physicsStore.indexOf(entityId);
      if (physIsStatic[physIndex] === 1) continue;
      if (physIgnore[physIndex] === 1) continue;

      // Read per-entity friction; fall back to default if zero/unset
      const frictionRaw = physFriction[physIndex];
      const friction = frictionRaw === 0n
        ? this.config.defaultFriction
        : FP.FromRaw(frictionRaw);

      physVelocityX[physIndex] = FP.ToRaw(FP.Mul(FP.FromRaw(physVelocityX[physIndex]), friction));
      physVelocityZ[physIndex] = FP.ToRaw(FP.Mul(FP.FromRaw(physVelocityZ[physIndex]), friction));
    }
  }

  /** Expose the physics SoA store for external use */
  public getPhysicsStore(): SoAComponentStore<typeof PhysicsSoASchema.definition> {
    return this.physicsStore;
  }

  /** Expose the transform store reference */
  public getTransformStore(): SoAComponentStore<SoASchemaDefinition> | null {
    return this.transformStore;
  }

  /** Expose the field mapping */
  public getFieldMapping(): TransformFieldMapping | null {
    return this.fieldMapping;
  }

  /** Expose config */
  public getConfig(): PhysicsConfig {
    return this.config;
  }

  /**
   * Fixed-point position of an entity with a linked transform, or `undefined`
   * when the entity has no physics body or transform row.
   */
  public getEntityPosition(
    entityId: number
  ): { x: FixedPoint; z: FixedPoint } | undefined {
    if (!this.transformStore || !this.fieldMapping) {
      return undefined;
    }
    const transformIndex = this.transformStore.indexOf(entityId);
    if (transformIndex === -1) {
      return undefined;
    }
    const physIndex = this.physicsStore.indexOf(entityId);
    if (physIndex === -1) {
      return undefined;
    }
    const txArrays = this.transformStore.arrays;
    const fpPosXArr = txArrays[this.fieldMapping.fpPositionX] as BigInt64Array;
    const fpPosZArr = txArrays[this.fieldMapping.fpPositionZ] as BigInt64Array;
    return {
      x: FP.FromRaw(fpPosXArr[transformIndex]),
      z: FP.FromRaw(fpPosZArr[transformIndex]),
    };
  }

  /** Direct access to the spatial grid for custom queries (e.g. range finding) */
  public getSpatialGrid(): SpatialHashGrid {
    return this.spatialGrid;
  }

  /** Expose the EventBus for external subscription (e.g. PhysicsWorld facade) */
  public getEventBus(): EventBus {
    return this.eventBus;
  }

  public override dispose(): void {
    this.externalTickProvider?.stop();
    this.providerStarted = false;
    super.dispose();
    this.spatialGrid.clear();
  }
}
