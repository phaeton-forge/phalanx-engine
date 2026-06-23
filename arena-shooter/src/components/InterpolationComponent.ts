import { Vector3 } from '@babylonjs/core';
import type { IComponent } from '@phalanx-engine/ecs';
import { ComponentType } from './ComponentType.ts';
import { FP, type FPVector3 as FPVector3Type } from '@phalanx-engine/math';

export class InterpolationComponent implements IComponent {
  public readonly type = ComponentType.Interpolation;

  public readonly previousFpPosition: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };
  public readonly currentFpPosition: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };
  public readonly visualPosition: Vector3 = new Vector3();
  public previousRotationY: number = 0;
  public currentRotationY: number = 0;
  public visualRotationY: number = 0;
  public active: boolean = false;

  constructor(initialPosition?: FPVector3Type, isStatic: boolean = false) {
    if (initialPosition) {
      this.snapToPosition(initialPosition);
    }
    this.active = !isStatic;
  }

  public snapshotPosition(): void {
    this.previousFpPosition.x = this.currentFpPosition.x;
    this.previousFpPosition.y = this.currentFpPosition.y;
    this.previousFpPosition.z = this.currentFpPosition.z;
    this.previousRotationY = this.currentRotationY;
  }

  public capturePosition(fpPosition: FPVector3Type, rotationY: number): void {
    this.currentFpPosition.x = fpPosition.x;
    this.currentFpPosition.y = fpPosition.y;
    this.currentFpPosition.z = fpPosition.z;
    this.currentRotationY = rotationY;
  }

  public snapToPosition(fpPosition: FPVector3Type): void {
    this.previousFpPosition.x = fpPosition.x;
    this.previousFpPosition.y = fpPosition.y;
    this.previousFpPosition.z = fpPosition.z;
    this.currentFpPosition.x = fpPosition.x;
    this.currentFpPosition.y = fpPosition.y;
    this.currentFpPosition.z = fpPosition.z;
    this.visualPosition.x = FP.ToFloat(fpPosition.x);
    this.visualPosition.y = FP.ToFloat(fpPosition.y);
    this.visualPosition.z = FP.ToFloat(fpPosition.z);
  }
}
