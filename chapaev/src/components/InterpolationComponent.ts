import type { IComponent } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import type { FPVector3 as FPVector3Type } from '@phalanx-engine/math';
import { ComponentType } from './Component.ts';

/**
 * InterpolationComponent — stores interpolation state for smooth rendering
 * between simulation ticks.
 *
 * Simulation runs at 20 ticks/sec, rendering at 60+ fps.
 * This component stores the previous and current tick positions so the
 * InterpolationSystem can lerp between them each render frame.
 *
 * All position objects are pre-allocated and mutated in-place
 * to avoid GC pressure on hot paths.
 */
export class InterpolationComponent implements IComponent {
  public readonly type = ComponentType.Interpolation;

  /** Fixed-point position from previous simulation tick */
  public readonly previousFpPosition: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };

  /** Fixed-point position from current simulation tick */
  public readonly currentFpPosition: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };

  /** Whether this entity should be interpolated (false for dead/static entities) */
  public active: boolean = true;

  constructor(initialPosition?: FPVector3Type) {
    if (initialPosition) {
      this.snapToPosition(initialPosition);
    }
  }

  /**
   * Copy current → previous before a simulation tick.
   */
  public snapshotPosition(): void {
    this.previousFpPosition.x = this.currentFpPosition.x;
    this.previousFpPosition.y = this.currentFpPosition.y;
    this.previousFpPosition.z = this.currentFpPosition.z;
  }

  /**
   * Capture new simulation position after a tick.
   */
  public capturePosition(fpPosition: FPVector3Type): void {
    this.currentFpPosition.x = fpPosition.x;
    this.currentFpPosition.y = fpPosition.y;
    this.currentFpPosition.z = fpPosition.z;
  }

  /**
   * Snap both previous and current to a position (for teleport / initial spawn).
   */
  public snapToPosition(fpPosition: FPVector3Type): void {
    this.previousFpPosition.x = fpPosition.x;
    this.previousFpPosition.y = fpPosition.y;
    this.previousFpPosition.z = fpPosition.z;
    this.currentFpPosition.x = fpPosition.x;
    this.currentFpPosition.y = fpPosition.y;
    this.currentFpPosition.z = fpPosition.z;
  }
}
