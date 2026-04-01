import { GameSystem, type SoAComponentStore, type SystemContext } from 'phalanx-ecs';
import { FP, type FixedPoint } from 'phalanx-math';
import { PhysicsSoASchema } from '../components/PhysicsBodyComponent';
import type { PhysicsConfig, TransformFieldMapping } from '../types';
import type { SoASchemaDefinition } from 'phalanx-ecs';

/**
 * PhysicsSystem — deterministic velocity integration with sub-stepping.
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

  constructor(config: PhysicsConfig) {
    super();
    this.config = config;
  }

  public override init(context: SystemContext): void {
    super.init(context);
    this.physicsStore = this.entityManager.getOrCreateSoAStore(PhysicsSoASchema);
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
  }

  public override processTick(_tick: number): void {
    if (!this.transformStore || !this.fieldMapping) return;

    const subDt = FP.Div(this.config.tickDt, FP.FromFloat(this.config.subSteps));
    for (let i = 0; i < this.config.subSteps; i++) {
      this.applyVelocities(subDt);
    }
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
        newPosX = FP.Clamp(newPosX, bounds.minX, bounds.maxX);
        newPosZ = FP.Clamp(newPosZ, bounds.minZ, bounds.maxZ);
      }

      fpPosXArr[transformIndex] = FP.ToRaw(newPosX);
      fpPosZArr[transformIndex] = FP.ToRaw(newPosZ);

      // Sync optional visual position cache
      if (visPosXArr) visPosXArr[transformIndex] = FP.ToFloat(newPosX);
      if (visPosZArr) visPosZArr[transformIndex] = FP.ToFloat(newPosZ);
    }
  }

  /** Expose the physics SoA store for external use (e.g. CollisionSystem) */
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

  /** Expose config for CollisionSystem */
  public getConfig(): PhysicsConfig {
    return this.config;
  }

  public override dispose(): void {
    super.dispose();
  }
}
