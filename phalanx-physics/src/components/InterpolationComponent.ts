import type { IComponent } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import type {
  FPVector3 as FPVector3Type,
  FPQuaternion as FPQuaternionType,
} from '@phalanx-engine/math';

/**
 * Unique symbol identifying Interpolation components.
 * Consumers register this into their own ComponentType registry.
 */
export const INTERPOLATION_COMPONENT_TYPE: symbol = Symbol('Interpolation');

/**
 * InterpolationComponent — stores tick-to-tick transform samples for render smoothing.
 *
 * Simulation runs at a fixed tick rate; rendering runs at display refresh rate.
 * This component holds previous and current fixed-point position and rotation so
 * InterpolationSystem can interpolate between tick states each frame. Rotation is
 * stored as a quaternion for slerp-based interpolation.
 */
export class InterpolationComponent implements IComponent {
  public readonly type = INTERPOLATION_COMPONENT_TYPE;

  public readonly previousFpPosition: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };
  public readonly currentFpPosition: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };
  public readonly previousFpRotation: FPQuaternionType = { x: FP._0, y: FP._0, z: FP._0, w: FP._1 };
  public readonly currentFpRotation: FPQuaternionType = { x: FP._0, y: FP._0, z: FP._0, w: FP._1 };

  constructor(initialPosition?: FPVector3Type, initialRotation?: FPQuaternionType) {
    if (initialPosition) {
      this.copyFpVector3(this.previousFpPosition, initialPosition);
      this.copyFpVector3(this.currentFpPosition, initialPosition);
    }
    if (initialRotation) {
      this.copyFpQuaternion(this.previousFpRotation, initialRotation);
      this.copyFpQuaternion(this.currentFpRotation, initialRotation);
    }
  }

  /** Copy current samples into previous before a simulation tick. */
  public snapshot(): void {
    this.copyFpVector3(this.previousFpPosition, this.currentFpPosition);
    this.copyFpQuaternion(this.previousFpRotation, this.currentFpRotation);
  }

  /** Capture authoritative transform state after a simulation tick. */
  public capture(fpPosition: FPVector3Type, fpRotation: FPQuaternionType): void {
    this.copyFpVector3(this.currentFpPosition, fpPosition);
    this.copyFpQuaternion(this.currentFpRotation, fpRotation);
  }

  private copyFpVector3(target: FPVector3Type, source: FPVector3Type): void {
    target.x = source.x;
    target.y = source.y;
    target.z = source.z;
  }

  private copyFpQuaternion(target: FPQuaternionType, source: FPQuaternionType): void {
    target.x = source.x;
    target.y = source.y;
    target.z = source.z;
    target.w = source.w;
  }
}
