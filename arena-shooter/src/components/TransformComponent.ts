import {
  TransformComponent as PhysicsTransformComponent,
  TransformSoASchema,
} from '@phalanx-engine/physics';
import { ComponentType } from './ComponentType.ts';
import { FP, type FPVector3 as FPVector3Type } from '@phalanx-engine/math';
import { Vector3 } from '@babylonjs/core';

export { TransformSoASchema };

/**
 * Arena transform backed by phalanx-physics TransformSoASchema so PhysicsSystem
 * reads/writes the same SoA store as gameplay code.
 *
 * Visual position/rotation for rendering live on InterpolationComponent; the
 * visual accessors here derive from authoritative fixed-point state.
 */
export class TransformComponent extends PhysicsTransformComponent {
  public override readonly type = ComponentType.Transform;

  private readonly _visualPosition: Vector3 = new Vector3();

  constructor(entityId: number, initialPosition?: FPVector3Type) {
    super(entityId, initialPosition);
  }

  public get visualRotationY(): number {
    return FP.ToFloat(this.fpRotationY);
  }

  public get visualPosition(): Vector3 {
    const pos = this.fpPosition;
    this._visualPosition.set(FP.ToFloat(pos.x), FP.ToFloat(pos.y), FP.ToFloat(pos.z));
    return this._visualPosition;
  }

  public setVisualPosition(x: number, y: number, z: number): void {
    this._visualPosition.set(x, y, z);
  }

  public setVisualRotationY(_r: number): void {
    // Authoritative rotation is fpRotationY on the shared physics transform store.
  }

  public syncVisualFromFp(): void {
    // Visual state is derived from fpPosition/fpRotationY or InterpolationComponent.
  }
}
