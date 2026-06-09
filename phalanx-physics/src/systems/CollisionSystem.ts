import { GameSystem, type SoAComponentStore, type SystemContext } from 'phalanx-ecs';
import { FP, type FixedPoint } from 'phalanx-math';
import { PhysicsSoASchema } from '../components/PhysicsBodyComponent';
import { TransformSoASchema } from '../components/TransformComponent';
import { SpatialHashGrid } from '../collision/SpatialHashGrid';
import { NarrowPhase } from '../collision/NarrowPhase';
import type { CollisionManifold } from '../collision/CollisionManifold';
import { PhysicsEvents } from '../events';
import type { CollisionEvent } from '../types';

const SEPARATION_HALF = FP.FromFloat(0.5);

/**
 * CollisionSystem — broad-phase → narrow-phase → resolution pipeline.
 *
 * Rebuilds the SpatialHashGrid each tick, runs narrow-phase on candidate
 * pairs, resolves overlaps via impulse-based push, and emits collision
 * events via EventBus.
 */
export class CollisionSystem extends GameSystem {
  private physicsStore!: SoAComponentStore<typeof PhysicsSoASchema.definition>;
  private transformStore!: SoAComponentStore<typeof TransformSoASchema.definition>;
  private readonly spatialGrid: SpatialHashGrid;
  private pushStrength: FixedPoint;
  private collisionFilter: ((entityA: number, entityB: number) => boolean) | null = null;

  constructor(gridCellSize: FixedPoint, pushStrength?: FixedPoint) {
    super();
    this.spatialGrid = new SpatialHashGrid(gridCellSize);
    this.pushStrength = pushStrength ?? FP.FromFloat(15.0);
  }

  /**
   * Set an optional collision filter. Return false to skip a pair.
   * Useful for game-specific rules like team-based collision filtering.
   */
  public setCollisionFilter(filter: (entityA: number, entityB: number) => boolean): void {
    this.collisionFilter = filter;
  }

  public override init(context: SystemContext): void {
    super.init(context);
    this.physicsStore = this.entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    this.transformStore = this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  /** Expose the spatial grid for external queries (e.g. range queries) */
  public getSpatialGrid(): SpatialHashGrid {
    return this.spatialGrid;
  }

  public override processTick(_tick: number): void {
    this.rebuildSpatialGrid();
    this.detectAndResolve();
  }

  /**
   * Rebuild the spatial grid with current entity positions.
   */
  private rebuildSpatialGrid(): void {
    this.spatialGrid.clear();

    const physLastX = this.physicsStore.arrays.lastX;
    const physLastZ = this.physicsStore.arrays.lastZ;
    const physRadius = this.physicsStore.arrays.radius;

    const fpPosXArr = this.transformStore.arrays.fpPositionX;
    const fpPosZArr = this.transformStore.arrays.fpPositionZ;

    for (const entityId of this.physicsStore.entityIds()) {
      const physIndex = this.physicsStore.indexOf(entityId);
      const transformIndex = this.transformStore.indexOf(entityId);
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

    const fpPosXArr = this.transformStore.arrays.fpPositionX;
    const fpPosZArr = this.transformStore.arrays.fpPositionZ;

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

      const transformIndexA = this.transformStore.indexOf(entityIdA);
      const transformIndexB = this.transformStore.indexOf(entityIdB);
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

      // Resolve collision
      this.resolveCollision(
        manifold,
        physIndexA, physIndexB,
        transformIndexA, transformIndexB,
        physVelocityX, physVelocityZ,
        physMass, physIsStatic,
        fpPosXArr, fpPosZArr,
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
    physIndexA: number, physIndexB: number,
    transformIndexA: number, transformIndexB: number,
    physVelocityX: BigInt64Array, physVelocityZ: BigInt64Array,
    physMass: BigInt64Array, physIsStatic: Uint8Array,
    fpPosXArr: BigInt64Array, fpPosZArr: BigInt64Array,
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
    const pushForce = FP.Mul(overlap, this.pushStrength);

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
    }
    if (!isStaticB) {
      const sepB = FP.Mul(separation, ratioB);
      const posBX = FP.FromRaw(fpPosXArr[transformIndexB]);
      const posBZ = FP.FromRaw(fpPosZArr[transformIndexB]);
      const newBX = FP.Add(posBX, FP.Mul(nx, sepB));
      const newBZ = FP.Add(posBZ, FP.Mul(nz, sepB));
      fpPosXArr[transformIndexB] = FP.ToRaw(newBX);
      fpPosZArr[transformIndexB] = FP.ToRaw(newBZ);
    }
  }

  public override dispose(): void {
    super.dispose();
    this.spatialGrid.clear();
  }
}
