import type { IComponent } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import type { FPVector3 as FPVector3Type } from '@phalanx-engine/math';

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
 * InterpolationSystem can lerp between tick states each frame.
 */
export class InterpolationComponent implements IComponent {
  public readonly type = INTERPOLATION_COMPONENT_TYPE;

  public readonly previousFpPosition: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };
  public readonly currentFpPosition: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };
  public readonly previousFpRotation: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };
  public readonly currentFpRotation: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };

  constructor(initialPosition?: FPVector3Type, initialRotation?: FPVector3Type) {
    if (initialPosition) {
      this.copyFpVector3(this.previousFpPosition, initialPosition);
      this.copyFpVector3(this.currentFpPosition, initialPosition);
    }
    if (initialRotation) {
      this.copyFpVector3(this.previousFpRotation, initialRotation);
      this.copyFpVector3(this.currentFpRotation, initialRotation);
    }
  }

  /** Copy current samples into previous before a simulation tick. */
  public snapshot(): void {
    this.copyFpVector3(this.previousFpPosition, this.currentFpPosition);
    this.copyFpVector3(this.previousFpRotation, this.currentFpRotation);
  }

  /** Capture authoritative transform state after a simulation tick. */
  public capture(fpPosition: FPVector3Type, fpRotation: FPVector3Type): void {
    this.copyFpVector3(this.currentFpPosition, fpPosition);
    this.copyFpVector3(this.currentFpRotation, fpRotation);
  }

  private copyFpVector3(target: FPVector3Type, source: FPVector3Type): void {
    target.x = source.x;
    target.y = source.y;
    target.z = source.z;
  }
}
