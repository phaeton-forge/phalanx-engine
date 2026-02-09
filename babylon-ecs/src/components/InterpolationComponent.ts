import { Vector3 } from '@babylonjs/core';
import type { IComponent } from './Component';
import { ComponentType } from './Component';
import { FP, FPVector3, type FPVector3 as FPVector3Type } from 'phalanx-math';

/**
 * InterpolationComponent - Stores interpolation state for an entity
 *
 * This component enables smooth visual movement between network ticks.
 * Uses fixed-point positions as authoritative source and interpolates
 * to float Vector3 for smooth visual rendering.
 *
 * ARCHITECTURE:
 * - Simulation runs at 20 ticks/sec (deterministic, synchronized)
 * - Rendering runs at 60 FPS (visual only, local)
 * - This component stores state needed to interpolate between simulation positions
 */
export class InterpolationComponent implements IComponent {
  public readonly type = ComponentType.Interpolation;

  /** Fixed-point position from previous simulation tick (authoritative) */
  public previousFpPosition: FPVector3Type;

  /** Fixed-point position from current simulation tick (authoritative) */
  public currentFpPosition: FPVector3Type;

  /** Visual position applied to mesh (interpolated, for rendering) */
  public visualPosition: Vector3;

  /** Whether this entity needs interpolation (false for static entities) */
  public active: boolean;

  constructor(initialPosition: FPVector3Type, isStatic: boolean = false) {
    // Clone the initial position for both previous and current
    this.previousFpPosition = FPVector3.Create(
      initialPosition.x,
      initialPosition.y,
      initialPosition.z
    );
    this.currentFpPosition = FPVector3.Create(
      initialPosition.x,
      initialPosition.y,
      initialPosition.z
    );
    // Initialize visual position from fixed-point
    this.visualPosition = new Vector3(
      FP.ToFloat(initialPosition.x),
      FP.ToFloat(initialPosition.y),
      FP.ToFloat(initialPosition.z)
    );
    this.active = !isStatic;
  }

  /**
   * Snapshot current position as previous position
   * Call this BEFORE running simulation tick
   */
  public snapshotPosition(): void {
    this.previousFpPosition = FPVector3.Create(
      this.currentFpPosition.x,
      this.currentFpPosition.y,
      this.currentFpPosition.z
    );
  }

  /**
   * Capture new simulation position
   * Call this AFTER running simulation tick
   */
  public capturePosition(fpPosition: FPVector3Type): void {
    this.currentFpPosition = FPVector3.Create(
      fpPosition.x,
      fpPosition.y,
      fpPosition.z
    );
  }

  /**
   * Snap both positions to the given position (for teleporting or initial spawn)
   */
  public snapToPosition(fpPosition: FPVector3Type): void {
    this.previousFpPosition = FPVector3.Create(
      fpPosition.x,
      fpPosition.y,
      fpPosition.z
    );
    this.currentFpPosition = FPVector3.Create(
      fpPosition.x,
      fpPosition.y,
      fpPosition.z
    );
  }
}


