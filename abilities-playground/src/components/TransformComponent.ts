import { defineSoASchema, SoAComponent } from 'phalanx-ecs';
import { FP, FPVector3 } from 'phalanx-math';
import type { FPVector3 as FPVector3Type } from 'phalanx-math';
import { ComponentType } from './Component';

export const TransformSoASchema = defineSoASchema(
  {
    fpPositionX: 'i64',
    fpPositionY: 'i64',
    fpPositionZ: 'i64',
    visualPositionX: 'f64',
    visualPositionY: 'f64',
    visualPositionZ: 'f64',
    visualRotationY: 'f64',
    previousVisualRotationY: 'f64',
  },
  'Transform',
);

export class TransformComponent extends SoAComponent<
  typeof TransformSoASchema.definition
> {
  public readonly type = ComponentType.Transform;
  public static readonly soaSchema = TransformSoASchema;

  private readonly fpPositionRef: FPVector3Type = {
    x: FP._0,
    y: FP._0,
    z: FP._0,
  };

  constructor(
    entityId: number,
    initialPosition: FPVector3Type,
    initialRotationY = 0,
  ) {
    const visualPosition = FPVector3.ToFloat(initialPosition);

    super(TransformSoASchema, entityId, {
      fpPositionX: FP.ToRaw(initialPosition.x),
      fpPositionY: FP.ToRaw(initialPosition.y),
      fpPositionZ: FP.ToRaw(initialPosition.z),
      visualPositionX: visualPosition.x,
      visualPositionY: visualPosition.y,
      visualPositionZ: visualPosition.z,
      visualRotationY: initialRotationY,
      previousVisualRotationY: initialRotationY,
    });
  }

  get fpPosition(): FPVector3Type {
    const index = this.getIndex();
    this.fpPositionRef.x = FP.FromRaw(this.store.arrays.fpPositionX[index]);
    this.fpPositionRef.y = FP.FromRaw(this.store.arrays.fpPositionY[index]);
    this.fpPositionRef.z = FP.FromRaw(this.store.arrays.fpPositionZ[index]);
    return this.fpPositionRef;
  }

  set fpPosition(value: FPVector3Type) {
    const index = this.getIndex();
    this.store.arrays.fpPositionX[index] = FP.ToRaw(value.x);
    this.store.arrays.fpPositionY[index] = FP.ToRaw(value.y);
    this.store.arrays.fpPositionZ[index] = FP.ToRaw(value.z);
    this.store.arrays.visualPositionX[index] = FP.ToFloat(value.x);
    this.store.arrays.visualPositionY[index] = FP.ToFloat(value.y);
    this.store.arrays.visualPositionZ[index] = FP.ToFloat(value.z);
  }

  setVisualPosition(x: number, y: number, z: number): void {
    const index = this.getIndex();
    this.store.arrays.visualPositionX[index] = x;
    this.store.arrays.visualPositionY[index] = y;
    this.store.arrays.visualPositionZ[index] = z;
  }
}
