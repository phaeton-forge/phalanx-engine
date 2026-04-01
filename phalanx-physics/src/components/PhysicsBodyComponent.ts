import { SoAComponent, defineSoASchema } from 'phalanx-ecs';
import { FP, type FixedPoint, type FPVector3 as FPVector3Type } from 'phalanx-math';
import type { PhysicsBodyConfig } from '../types';

/**
 * PhysicsBody SoA Schema
 *
 * Stores physics simulation data using fixed-point math for determinism.
 * All i64 fields store raw FixedPoint base values (BigInt64Array).
 */
export const PhysicsSoASchema = defineSoASchema({
  velocityX: 'i64',
  velocityY: 'i64',
  velocityZ: 'i64',
  radius: 'i64',
  mass: 'i64',
  restitution: 'i64',
  friction: 'i64',
  isStatic: 'u8',
  ignorePhysics: 'u8',
  lastX: 'f64',
  lastZ: 'f64',
}, 'PhysicsBody');

/**
 * Unique symbol identifying PhysicsBody components.
 * Consumers register this into their own ComponentType registry.
 */
export const PHYSICS_BODY_COMPONENT_TYPE: symbol = Symbol('PhysicsBody');

/**
 * PhysicsBodyComponent — SoA-backed physics state for an entity.
 *
 * Stores velocity, radius, mass, restitution, friction, and flags
 * in cache-friendly typed arrays. Provides a convenience façade for
 * reading/writing individual entity values.
 *
 * For hot-path access in systems, use the SoA store directly:
 * ```typescript
 * const store = entityManager.getOrCreateSoAStore(PhysicsSoASchema);
 * const idx = store.indexOf(entityId);
 * store.arrays.velocityX[idx] = FP.ToRaw(newVel);
 * ```
 */
export class PhysicsBodyComponent extends SoAComponent<typeof PhysicsSoASchema.definition> {
  public readonly type = PHYSICS_BODY_COMPONENT_TYPE;
  static readonly soaSchema = PhysicsSoASchema;

  /** Reusable velocity object to avoid allocation */
  private readonly _velocity: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };

  constructor(entityId: number, config: PhysicsBodyConfig) {
    const mass = config.mass ?? FP._1;
    const restitution = config.restitution ?? FP.FromFloat(0.5);
    const friction = config.friction ?? FP.FromFloat(0.3);
    const isStatic = config.isStatic ?? false;

    super(PhysicsSoASchema, entityId, {
      velocityX: FP.ToRaw(FP._0),
      velocityY: FP.ToRaw(FP._0),
      velocityZ: FP.ToRaw(FP._0),
      radius: FP.ToRaw(config.radius),
      mass: FP.ToRaw(mass),
      restitution: FP.ToRaw(restitution),
      friction: FP.ToRaw(friction),
      isStatic: isStatic ? 1 : 0,
      ignorePhysics: 0,
      lastX: 0,
      lastZ: 0,
    });
  }

  // ============ Velocity ============

  /**
   * Get velocity as FPVector3. Returns a cached object — do not mutate directly.
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

  /** Set velocity by components */
  public setVelocity(x: FixedPoint, y: FixedPoint, z: FixedPoint): void {
    const idx = this.getIndex();
    if (idx === -1) return;
    this.store.arrays.velocityX[idx] = FP.ToRaw(x);
    this.store.arrays.velocityY[idx] = FP.ToRaw(y);
    this.store.arrays.velocityZ[idx] = FP.ToRaw(z);
  }

  /** Add to current velocity */
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

  /** Zero out velocity */
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

  // ============ Restitution ============

  public get restitution(): FixedPoint {
    const idx = this.getIndex();
    if (idx === -1) return FP.FromFloat(0.5);
    return FP.FromRaw(this.store.arrays.restitution[idx]);
  }

  // ============ Friction ============

  public get friction(): FixedPoint {
    const idx = this.getIndex();
    if (idx === -1) return FP.FromFloat(0.3);
    return FP.FromRaw(this.store.arrays.friction[idx]);
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
