import { SoAComponent, defineSoASchema } from 'phalanx-ecs';
import { ComponentType } from './Component';
import { FP, type FixedPoint, type FPVector3 as FPVector3Type } from 'phalanx-math';

/**
 * PhysicsBody SoA Schema
 *
 * Stores physics simulation data using fixed-point math.
 * Optimized for the physics system's hot loops.
 */
export const PhysicsSoASchema = defineSoASchema({
  velocityX: 'i64',
  velocityY: 'i64',
  velocityZ: 'i64',
  radius: 'i64',
  mass: 'i64',
  isStatic: 'u8',
  ignorePhysics: 'u8',
  lastX: 'f64',
  lastZ: 'f64',
}, 'PhysicsBody');

/**
 * PhysicsBodyComponent - Stores physics state for an entity
 *
 * Uses SoA (Structure-of-Arrays) storage for cache-friendly iteration in hot paths.
 * This component provides a façade API over the underlying typed arrays while
 * maintaining the same interface as before.
 *
 * For maximum performance in hot loops, systems can access the SoA store directly:
 * ```typescript
 * const store = entityManager.getSoAStore(PhysicsSoASchema);
 * const idx = store.indexOf(entityId);
 * store.arrays.velocityX[idx] = FP.ToRaw(newVelocity);
 * ```
 */
export class PhysicsBodyComponent extends SoAComponent<typeof PhysicsSoASchema.definition> {
  public readonly type = ComponentType.PhysicsBody;
  static readonly soaSchema = PhysicsSoASchema;

  /** Reusable velocity object to avoid allocation */
  private readonly _velocity: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };

  constructor(
    entityId: number,
    options: {
      radius?: number;
      mass?: number;
      isStatic?: boolean;
    } = {}
  ) {
    const radius = options.radius !== undefined ? FP.FromFloat(options.radius) : FP._1;
    const mass = options.mass !== undefined ? FP.FromFloat(options.mass) : FP._1;
    const isStatic = options.isStatic ?? false;

    super(PhysicsSoASchema, entityId, {
      velocityX: FP.ToRaw(FP._0),
      velocityY: FP.ToRaw(FP._0),
      velocityZ: FP.ToRaw(FP._0),
      radius: FP.ToRaw(radius),
      mass: FP.ToRaw(mass),
      isStatic: isStatic ? 1 : 0,
      ignorePhysics: 0,
      lastX: 0,
      lastZ: 0,
    });
  }

  // ============ Velocity ============

  /**
   * Get velocity as FPVector3 (creates FixedPoint objects)
   * Returns cached object - do not mutate directly
   */
  public get velocity(): FPVector3Type {
    const idx = this.getIndex();
    if (idx === -1) return this._velocity;

    this._velocity.x = FP.FromRaw(this.store.arrays.velocityX[idx]);
    this._velocity.y = FP.FromRaw(this.store.arrays.velocityY[idx]);
    this._velocity.z = FP.FromRaw(this.store.arrays.velocityZ[idx]);
    return this._velocity;
  }

  public set velocity(value: FPVector3Type) {
    const idx = this.getIndex();
    if (idx === -1) return;

    this.store.arrays.velocityX[idx] = FP.ToRaw(value.x);
    this.store.arrays.velocityY[idx] = FP.ToRaw(value.y);
    this.store.arrays.velocityZ[idx] = FP.ToRaw(value.z);
  }

  public setVelocity(x: FixedPoint, y: FixedPoint, z: FixedPoint): void {
    const idx = this.getIndex();
    if (idx === -1) return;

    this.store.arrays.velocityX[idx] = FP.ToRaw(x);
    this.store.arrays.velocityY[idx] = FP.ToRaw(y);
    this.store.arrays.velocityZ[idx] = FP.ToRaw(z);
  }

  public addVelocity(velocity: FPVector3Type): void {
    const idx = this.getIndex();
    if (idx === -1) return;

    const currentX = FP.FromRaw(this.store.arrays.velocityX[idx]);
    const currentY = FP.FromRaw(this.store.arrays.velocityY[idx]);
    const currentZ = FP.FromRaw(this.store.arrays.velocityZ[idx]);

    this.store.arrays.velocityX[idx] = FP.ToRaw(FP.Add(currentX, velocity.x));
    this.store.arrays.velocityY[idx] = FP.ToRaw(FP.Add(currentY, velocity.y));
    this.store.arrays.velocityZ[idx] = FP.ToRaw(FP.Add(currentZ, velocity.z));
  }

  public stopVelocity(): void {
    const idx = this.getIndex();
    if (idx === -1) return;

    const zero = FP.ToRaw(FP._0);
    this.store.arrays.velocityX[idx] = zero;
    this.store.arrays.velocityY[idx] = zero;
    this.store.arrays.velocityZ[idx] = zero;
  }

  // ============ Radius ============

  public get radius(): FixedPoint {
    const idx = this.getIndex();
    if (idx === -1) return FP._1;
    return FP.FromRaw(this.store.arrays.radius[idx]);
  }

  public get radiusFloat(): number {
    const idx = this.getIndex();
    if (idx === -1) return 1;
    return FP.ToFloat(FP.FromRaw(this.store.arrays.radius[idx]));
  }

  // ============ Mass ============

  public get mass(): FixedPoint {
    const idx = this.getIndex();
    if (idx === -1) return FP._1;
    return FP.FromRaw(this.store.arrays.mass[idx]);
  }

  // ============ Static Flag ============

  public get isStatic(): boolean {
    const idx = this.getIndex();
    if (idx === -1) return false;
    return this.store.arrays.isStatic[idx] === 1;
  }

  // ============ Ignore Physics Flag ============

  public get ignorePhysics(): boolean {
    const idx = this.getIndex();
    if (idx === -1) return false;
    return this.store.arrays.ignorePhysics[idx] === 1;
  }

  public set ignorePhysics(value: boolean) {
    const idx = this.getIndex();
    if (idx === -1) return;
    this.store.arrays.ignorePhysics[idx] = value ? 1 : 0;
  }

  // ============ Cached Position (for spatial grid) ============

  public get lastX(): number {
    const idx = this.getIndex();
    if (idx === -1) return 0;
    return this.store.arrays.lastX[idx];
  }

  public set lastX(value: number) {
    const idx = this.getIndex();
    if (idx === -1) return;
    this.store.arrays.lastX[idx] = value;
  }

  public get lastZ(): number {
    const idx = this.getIndex();
    if (idx === -1) return 0;
    return this.store.arrays.lastZ[idx];
  }

  public set lastZ(value: number) {
    const idx = this.getIndex();
    if (idx === -1) return;
    this.store.arrays.lastZ[idx] = value;
  }
}

