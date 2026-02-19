import type { IComponent } from './Component';
import { ComponentType } from './Component';
import { FP, type FixedPoint, type FPVector3 as FPVector3Type } from 'phalanx-math';

/**
 * PhysicsBodyComponent - Stores physics state for an entity
 * Uses fixed-point arithmetic for deterministic simulation
 *
 * This component replaces the internal PhysicsBody tracking in PhysicsSystem,
 * following proper ECS architecture where all entity state lives in components.
 */
export class PhysicsBodyComponent implements IComponent {
  public readonly type = ComponentType.PhysicsBody;

  // Fixed-point velocity for deterministic physics
  private _velocity: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };

  // Fixed-point radius and mass
  private _radius: FixedPoint;
  private _mass: FixedPoint;

  // Static bodies don't move (towers, bases)
  private _isStatic: boolean;

  // Cached position for spatial hashing (kept as numbers for grid indexing)
  public lastX: number = 0;
  public lastZ: number = 0;

  constructor(options: {
    radius?: number;
    mass?: number;
    isStatic?: boolean;
  } = {}) {
    this._radius = options.radius !== undefined ? FP.FromFloat(options.radius) : FP._1;
    this._mass = options.mass !== undefined ? FP.FromFloat(options.mass) : FP._1;
    this._isStatic = options.isStatic ?? false;
  }

  // Velocity accessors
  public get velocity(): FPVector3Type {
    return this._velocity;
  }

  public set velocity(value: FPVector3Type) {
    this._velocity.x = value.x;
    this._velocity.y = value.y;
    this._velocity.z = value.z;
  }

  public setVelocity(x: FixedPoint, y: FixedPoint, z: FixedPoint): void {
    this._velocity.x = x;
    this._velocity.y = y;
    this._velocity.z = z;
  }

  public addVelocity(velocity: FPVector3Type): void {
    this._velocity.x = FP.Add(this._velocity.x, velocity.x);
    this._velocity.y = FP.Add(this._velocity.y, velocity.y);
    this._velocity.z = FP.Add(this._velocity.z, velocity.z);
  }

  public stopVelocity(): void {
    this._velocity.x = FP._0;
    this._velocity.y = FP._0;
    this._velocity.z = FP._0;
  }

  // Radius accessor
  public get radius(): FixedPoint {
    return this._radius;
  }

  public get radiusFloat(): number {
    return FP.ToFloat(this._radius);
  }

  // Mass accessor
  public get mass(): FixedPoint {
    return this._mass;
  }

  // Static flag accessor
  public get isStatic(): boolean {
    return this._isStatic;
  }
}

