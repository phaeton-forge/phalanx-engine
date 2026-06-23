import { SoAComponent, defineSoASchema } from '@phalanx-engine/ecs';
import { FP, FPVector3, type FixedPoint, type FPVector3 as FPVector3Type } from '@phalanx-engine/math';

/**
 * Transform SoA Schema
 *
 * Stores authoritative spatial state using fixed-point math for determinism.
 * All i64 fields store raw FixedPoint base values (BigInt64Array).
 */
export const TransformSoASchema = defineSoASchema(
  {
    fpPositionX: 'i64',
    fpPositionY: 'i64',
    fpPositionZ: 'i64',
    fpRotationX: 'i64',
    fpRotationY: 'i64',
    fpRotationZ: 'i64',
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
 * Renderer-neutral: exposes only fixed-point position and rotation.
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
  private readonly _fpRotation: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };

  constructor(
    entityId: number,
    initialPosition?: FPVector3Type,
    initialRotation?: FPVector3Type,
  ) {
    const position = initialPosition ?? FPVector3.Zero;
    const rotation = initialRotation ?? FPVector3.Zero;

    super(TransformSoASchema, entityId, {
      fpPositionX: FP.ToRaw(position.x),
      fpPositionY: FP.ToRaw(position.y),
      fpPositionZ: FP.ToRaw(position.z),
      fpRotationX: FP.ToRaw(rotation.x),
      fpRotationY: FP.ToRaw(rotation.y),
      fpRotationZ: FP.ToRaw(rotation.z),
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

  public get fpRotation(): FPVector3Type {
    const idx = this.getIndex();
    if (idx === -1) return this._fpRotation;

    this._fpRotation.x = FP.FromRaw(this.store.arrays.fpRotationX[idx]);
    this._fpRotation.y = FP.FromRaw(this.store.arrays.fpRotationY[idx]);
    this._fpRotation.z = FP.FromRaw(this.store.arrays.fpRotationZ[idx]);
    return this._fpRotation;
  }

  public set fpRotation(value: FPVector3Type) {
    const idx = this.getIndex();
    if (idx === -1) return;

    this.store.arrays.fpRotationX[idx] = FP.ToRaw(value.x);
    this.store.arrays.fpRotationY[idx] = FP.ToRaw(value.y);
    this.store.arrays.fpRotationZ[idx] = FP.ToRaw(value.z);
  }

  public get fpRotationY(): FixedPoint {
    const idx = this.getIndex();
    if (idx === -1) return FP._0;
    return FP.FromRaw(this.store.arrays.fpRotationY[idx]);
  }

  public set fpRotationY(value: FixedPoint) {
    const idx = this.getIndex();
    if (idx === -1) return;
    this.store.arrays.fpRotationY[idx] = FP.ToRaw(value);
  }
}
