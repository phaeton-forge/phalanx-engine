import { SoAComponent, defineSoASchema } from '@phalanx-engine/ecs';
import {
  FP,
  FPVector3,
  FPQuaternion,
  type FixedPoint,
  type FPVector3 as FPVector3Type,
  type FPQuaternion as FPQuaternionType,
} from '@phalanx-engine/math';

/**
 * Transform SoA Schema
 *
 * Stores authoritative spatial state using fixed-point math for determinism.
 * Rotation is stored as a quaternion (qx/qy/qz/qw); the identity rotation has
 * qw = FP._1 and the other components zero. All i64 fields store raw FixedPoint
 * base values (BigInt64Array).
 */
export const TransformSoASchema = defineSoASchema(
  {
    fpPositionX: 'i64',
    fpPositionY: 'i64',
    fpPositionZ: 'i64',
    fpRotationX: 'i64',
    fpRotationY: 'i64',
    fpRotationZ: 'i64',
    fpRotationW: 'i64',
  },
  'Transform',
);

/**
 * Unique symbol identifying Transform components.
 * Consumers register this into their own ComponentType registry.
 */
export const TRANSFORM_COMPONENT_TYPE: symbol = Symbol('Transform');

/**
 * TransformComponent — SoA-backed deterministic spatial state for an entity.
 *
 * Renderer-neutral: exposes only fixed-point position and rotation. Rotation is
 * authoritatively a quaternion (`fpRotation`); Euler angles (`fpRotationEuler`)
 * and yaw (`fpRotationY`) are computed views over it, mirroring Unity's
 * `Transform.rotation` / `Transform.eulerAngles`.
 *
 * For hot-path access in systems, use the SoA store directly:
 * ```typescript
 * const store = entityManager.getOrCreateSoAStore(TransformSoASchema);
 * const idx = store.indexOf(entityId);
 * store.arrays.fpPositionX[idx] = FP.ToRaw(newX);
 * ```
 */
export class TransformComponent extends SoAComponent<typeof TransformSoASchema.definition> {
  public readonly type = TRANSFORM_COMPONENT_TYPE;
  public static readonly soaSchema = TransformSoASchema;

  private readonly _fpPosition: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };
  private readonly _fpRotation: FPQuaternionType = { x: FP._0, y: FP._0, z: FP._0, w: FP._1 };

  constructor(
    entityId: number,
    initialPosition?: FPVector3Type,
    initialRotation?: FPQuaternionType,
  ) {
    const position = initialPosition ?? FPVector3.Zero;
    const rotation = initialRotation ?? FPQuaternion.Identity();

    super(TransformSoASchema, entityId, {
      fpPositionX: FP.ToRaw(position.x),
      fpPositionY: FP.ToRaw(position.y),
      fpPositionZ: FP.ToRaw(position.z),
      fpRotationX: FP.ToRaw(rotation.x),
      fpRotationY: FP.ToRaw(rotation.y),
      fpRotationZ: FP.ToRaw(rotation.z),
      fpRotationW: FP.ToRaw(rotation.w),
    });
  }

  public get fpPosition(): FPVector3Type {
    const idx = this.getIndex();
    if (idx === -1) return this._fpPosition;

    this._fpPosition.x = FP.FromRaw(this.store.arrays.fpPositionX[idx]);
    this._fpPosition.y = FP.FromRaw(this.store.arrays.fpPositionY[idx]);
    this._fpPosition.z = FP.FromRaw(this.store.arrays.fpPositionZ[idx]);

    return this._fpPosition;
  }

  public set fpPosition(value: FPVector3Type) {
    const idx = this.getIndex();

    if (idx === -1) return;

    this.store.arrays.fpPositionX[idx] = FP.ToRaw(value.x);
    this.store.arrays.fpPositionY[idx] = FP.ToRaw(value.y);
    this.store.arrays.fpPositionZ[idx] = FP.ToRaw(value.z);
  }

  /** Authoritative rotation quaternion, read/written directly to SoA storage. */
  public get fpRotation(): FPQuaternionType {
    const idx = this.getIndex();
    if (idx === -1) return this._fpRotation;

    this._fpRotation.x = FP.FromRaw(this.store.arrays.fpRotationX[idx]);
    this._fpRotation.y = FP.FromRaw(this.store.arrays.fpRotationY[idx]);
    this._fpRotation.z = FP.FromRaw(this.store.arrays.fpRotationZ[idx]);
    this._fpRotation.w = FP.FromRaw(this.store.arrays.fpRotationW[idx]);
    return this._fpRotation;
  }

  public set fpRotation(value: FPQuaternionType) {
    const idx = this.getIndex();
    if (idx === -1) return;

    this.store.arrays.fpRotationX[idx] = FP.ToRaw(value.x);
    this.store.arrays.fpRotationY[idx] = FP.ToRaw(value.y);
    this.store.arrays.fpRotationZ[idx] = FP.ToRaw(value.z);
    this.store.arrays.fpRotationW[idx] = FP.ToRaw(value.w);
  }

  /**
   * Computed Euler-angle view (radians, XYZ order) of the authoritative
   * quaternion. Not cached — recomputed on every access, like Unity's
   * `Transform.eulerAngles`.
   */
  public get fpRotationEuler(): FPVector3Type {
    return FPQuaternion.ToEulerXYZ(this.fpRotation);
  }

  public set fpRotationEuler(value: FPVector3Type) {
    this.fpRotation = FPQuaternion.FromEulerXYZ(value);
  }

  /** Convenience yaw (rotation around the Y/up axis), in radians. */
  public get fpRotationY(): FixedPoint {
    return this.fpRotationEuler.y;
  }

  public set fpRotationY(value: FixedPoint) {
    this.fpRotation = FPQuaternion.FromAxisAngle(FPVector3.Up, value);
  }
}
