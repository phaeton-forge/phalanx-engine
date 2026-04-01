import { SoAComponent, defineSoASchema } from 'phalanx-ecs';
import { ComponentType } from './ComponentType.ts';
import { FP, FPVector3, type FPVector3 as FPVector3Type } from 'phalanx-math';
import { Vector3 } from '@babylonjs/core';

export const TransformSoASchema = defineSoASchema({
  fpPositionX: 'i64',
  fpPositionY: 'i64',
  fpPositionZ: 'i64',
  fpRotationY: 'i64',
  visualPositionX: 'f64',
  visualPositionY: 'f64',
  visualPositionZ: 'f64',
  visualRotationY: 'f64',
}, 'Transform');

export class TransformComponent extends SoAComponent<typeof TransformSoASchema.definition> {
  public readonly type = ComponentType.Transform;
  static readonly soaSchema = TransformSoASchema;

  private readonly _visualPosition: Vector3 = new Vector3();
  private readonly _fpPosition: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };

  constructor(entityId: number, initialPosition?: FPVector3Type) {
    const pos = initialPosition ?? FPVector3.Zero;
    const visualPos = FPVector3.ToFloat(pos);

    super(TransformSoASchema, entityId, {
      fpPositionX: FP.ToRaw(pos.x),
      fpPositionY: FP.ToRaw(pos.y),
      fpPositionZ: FP.ToRaw(pos.z),
      fpRotationY: 0n,
      visualPositionX: visualPos.x,
      visualPositionY: visualPos.y,
      visualPositionZ: visualPos.z,
      visualRotationY: 0,
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
    const fx = FP.ToFloat(value.x);
    const fy = FP.ToFloat(value.y);
    const fz = FP.ToFloat(value.z);
    this.store.arrays.visualPositionX[idx] = fx;
    this.store.arrays.visualPositionY[idx] = fy;
    this.store.arrays.visualPositionZ[idx] = fz;
  }

  public get fpRotationY(): bigint {
    const idx = this.getIndex();
    if (idx === -1) return 0n;
    return this.store.arrays.fpRotationY[idx];
  }

  public set fpRotationY(raw: bigint) {
    const idx = this.getIndex();
    if (idx === -1) return;
    this.store.arrays.fpRotationY[idx] = raw;
    this.store.arrays.visualRotationY[idx] = FP.ToFloat(FP.FromRaw(raw));
  }

  public get visualRotationY(): number {
    const idx = this.getIndex();
    if (idx === -1) return 0;
    return this.store.arrays.visualRotationY[idx];
  }

  public get visualPosition(): Vector3 {
    const idx = this.getIndex();
    if (idx === -1) return this._visualPosition;
    this._visualPosition.set(
      this.store.arrays.visualPositionX[idx],
      this.store.arrays.visualPositionY[idx],
      this.store.arrays.visualPositionZ[idx]
    );
    return this._visualPosition;
  }

  public setVisualPosition(x: number, y: number, z: number): void {
    const idx = this.getIndex();
    if (idx === -1) return;
    this.store.arrays.visualPositionX[idx] = x;
    this.store.arrays.visualPositionY[idx] = y;
    this.store.arrays.visualPositionZ[idx] = z;
  }

  public setVisualRotationY(r: number): void {
    const idx = this.getIndex();
    if (idx === -1) return;
    this.store.arrays.visualRotationY[idx] = r;
  }

  public syncVisualFromFp(): void {
    const idx = this.getIndex();
    if (idx === -1) return;
    this.store.arrays.visualPositionX[idx] = FP.ToFloat(FP.FromRaw(this.store.arrays.fpPositionX[idx]));
    this.store.arrays.visualPositionY[idx] = FP.ToFloat(FP.FromRaw(this.store.arrays.fpPositionY[idx]));
    this.store.arrays.visualPositionZ[idx] = FP.ToFloat(FP.FromRaw(this.store.arrays.fpPositionZ[idx]));
    this.store.arrays.visualRotationY[idx] = FP.ToFloat(FP.FromRaw(this.store.arrays.fpRotationY[idx]));
  }
}
