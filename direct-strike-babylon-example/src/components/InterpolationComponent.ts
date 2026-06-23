import { Vector3 } from '@babylonjs/core';
import type { IResettableComponent } from '@phalanx-engine/ecs';
import { ComponentType } from './Component';
import { FP, type FPVector3 as FPVector3Type } from '@phalanx-engine/math';

/**
 * InterpolationComponent - Stores interpolation state for an entity
 *
 * This component enables smooth visual movement between network ticks.
 * Uses fixed-point positions as authoritative source and interpolates
 * to float Vector3 for smooth visual rendering.
 *
 * Implements IResettableComponent for pool support.
 * All position objects are pre-allocated once and mutated in-place
 * to avoid GC pressure on hot paths.
 *
 * ARCHITECTURE:
 * - Simulation runs at 20 ticks/sec (deterministic, synchronized)
 * - Rendering runs at 60 FPS (visual only, local)
 * - This component stores state needed to interpolate between simulation positions
 */
export class InterpolationComponent implements IResettableComponent {
  public readonly type = ComponentType.Interpolation;

  /** Fixed-point position from previous simulation tick (authoritative) */
  public readonly previousFpPosition: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };

  /** Fixed-point position from current simulation tick (authoritative) */
  public readonly currentFpPosition: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };

  /** Visual position applied to mesh (interpolated, for rendering) */
  public readonly visualPosition: Vector3 = new Vector3();

  /** Whether this entity needs interpolation (false for static entities) */
  public active: boolean = false;

  constructor(initialPosition?: FPVector3Type, isStatic: boolean = false) {
    if (initialPosition) {
      this._copyToAll(initialPosition);
    }
    this.active = !isStatic;
  }

  /** IPoolable: reset to zero, deactivate */
  public reset(): void {
    this.previousFpPosition.x = FP._0;
    this.previousFpPosition.y = FP._0;
    this.previousFpPosition.z = FP._0;
    this.currentFpPosition.x = FP._0;
    this.currentFpPosition.y = FP._0;
    this.currentFpPosition.z = FP._0;
    this.visualPosition.setAll(0);
    this.active = false;
  }

  /** IResettableComponent: reinitialize with a spawn position */
  public reinitialize(initialPosition: FPVector3Type, isStatic: boolean = false): void {
    this._copyToAll(initialPosition);
    this.active = !isStatic;
  }

  /**
   * Snapshot current position as previous position.
   * Call this BEFORE running simulation tick.
   * Mutates in-place — zero allocation.
   */
  public snapshotPosition(): void {
    this.previousFpPosition.x = this.currentFpPosition.x;
    this.previousFpPosition.y = this.currentFpPosition.y;
    this.previousFpPosition.z = this.currentFpPosition.z;
  }

  /**
   * Capture new simulation position.
   * Call this AFTER running simulation tick.
   * Mutates in-place — zero allocation.
   */
  public capturePosition(fpPosition: FPVector3Type): void {
    this.currentFpPosition.x = fpPosition.x;
    this.currentFpPosition.y = fpPosition.y;
    this.currentFpPosition.z = fpPosition.z;
  }

  /**
   * Snap both positions to the given position (for teleporting or initial spawn).
   * Mutates in-place — zero allocation.
   */
  public snapToPosition(fpPosition: FPVector3Type): void {
    this._copyToAll(fpPosition);
  }

  private _copyToAll(fpPosition: FPVector3Type): void {
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


