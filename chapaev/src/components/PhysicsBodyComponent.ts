import { SoAComponent, defineSoASchema } from 'phalanx-ecs';
import { ComponentType } from './Component.ts';
import { FP } from 'phalanx-math';
import type { FixedPoint } from 'phalanx-math';

/**
 * PhysicsBody SoA Schema
 *
 * All velocity, radius, mass, and friction fields are stored as i64 (raw FixedPoint)
 * for deterministic physics. Flags use u8 for compact storage.
 */
export const PhysicsBodySoASchema = defineSoASchema({
  velocityX: 'i64',
  velocityZ: 'i64',
  radius: 'i64',
  mass: 'i64',
  friction: 'i64',
  isMoving: 'u8',
  isAlive: 'u8',
}, 'PhysicsBody');

/**
 * Constructor options for PhysicsBodyComponent.
 */
export interface PhysicsBodyOptions {
  readonly radius: FixedPoint;
  readonly mass: FixedPoint;
  readonly friction: FixedPoint;
}

/**
 * PhysicsBodyComponent — SoA-backed 2D physics body for checker pieces.
 *
 * Stores velocity (XZ plane), radius, mass, friction, and alive/moving flags.
 * Used by PhysicsSystem for deterministic fixed-point simulation.
 */
export class PhysicsBodyComponent extends SoAComponent<typeof PhysicsBodySoASchema.definition> {
  public readonly type = ComponentType.PhysicsBody;
  static readonly soaSchema = PhysicsBodySoASchema;

  constructor(entityId: number, options: PhysicsBodyOptions) {
    super(PhysicsBodySoASchema, entityId, {
      velocityX: FP.ToRaw(FP._0),
      velocityZ: FP.ToRaw(FP._0),
      radius: FP.ToRaw(options.radius),
      mass: FP.ToRaw(options.mass),
      friction: FP.ToRaw(options.friction),
      isMoving: 0,
      isAlive: 1,
    });
  }

  // ─── Velocity ──────────────────────────────────────────────────

  public get velocityX(): FixedPoint {
    return FP.FromRaw(this.getField('velocityX'));
  }

  public set velocityX(value: FixedPoint) {
    this.setField('velocityX', FP.ToRaw(value));
  }

  public get velocityZ(): FixedPoint {
    return FP.FromRaw(this.getField('velocityZ'));
  }

  public set velocityZ(value: FixedPoint) {
    this.setField('velocityZ', FP.ToRaw(value));
  }

  // ─── Properties ────────────────────────────────────────────────

  public get radius(): FixedPoint {
    return FP.FromRaw(this.getField('radius'));
  }

  public get mass(): FixedPoint {
    return FP.FromRaw(this.getField('mass'));
  }

  public get friction(): FixedPoint {
    return FP.FromRaw(this.getField('friction'));
  }

  // ─── Flags ─────────────────────────────────────────────────────

  public get isMoving(): boolean {
    return this.getField('isMoving') === 1;
  }

  public set isMoving(value: boolean) {
    this.setField('isMoving', value ? 1 : 0);
  }

  public get isAlive(): boolean {
    return this.getField('isAlive') === 1;
  }

  public set isAlive(value: boolean) {
    this.setField('isAlive', value ? 1 : 0);
  }
}

