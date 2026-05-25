import * as THREE from 'three';
import { FP } from 'phalanx-math';
import type { FPVector3 as FPVector3Type } from 'phalanx-math';
import type { IComponent } from './Component';
import { ComponentType } from './Component';

export class InterpolationComponent implements IComponent {
  public readonly type = ComponentType.Interpolation;
  public readonly previousFpPosition: FPVector3Type = {
    x: FP._0,
    y: FP._0,
    z: FP._0,
  };
  public readonly currentFpPosition: FPVector3Type = {
    x: FP._0,
    y: FP._0,
    z: FP._0,
  };
  public readonly visualPosition = new THREE.Vector3();
  public active: boolean;

  constructor(initialPosition: FPVector3Type, active = true) {
    this.active = active;
    this.snapToPosition(initialPosition);
  }

  snapshotPosition(): void {
    this.previousFpPosition.x = this.currentFpPosition.x;
    this.previousFpPosition.y = this.currentFpPosition.y;
    this.previousFpPosition.z = this.currentFpPosition.z;
  }

  capturePosition(fpPosition: FPVector3Type): void {
    this.currentFpPosition.x = fpPosition.x;
    this.currentFpPosition.y = fpPosition.y;
    this.currentFpPosition.z = fpPosition.z;
  }

  snapToPosition(fpPosition: FPVector3Type): void {
    this.previousFpPosition.x = fpPosition.x;
    this.previousFpPosition.y = fpPosition.y;
    this.previousFpPosition.z = fpPosition.z;
    this.currentFpPosition.x = fpPosition.x;
    this.currentFpPosition.y = fpPosition.y;
    this.currentFpPosition.z = fpPosition.z;
    this.visualPosition.set(
      FP.ToFloat(fpPosition.x),
      FP.ToFloat(fpPosition.y),
      FP.ToFloat(fpPosition.z),
    );
  }
}
