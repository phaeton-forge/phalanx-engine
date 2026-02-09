import { Vector3 } from '@babylonjs/core';
import type { SystemContext } from '../core/SystemContext';
import { GameSystem } from './GameSystem';
import {
  fpToVector3Ref,
  lerpVector3FromFpRef,
} from '../core/MathConversions';
import { FPVector3, type FPVector3 as FPVector3Type } from 'phalanx-math';

/**
 * Interpolation state for an entity
 * Stores previous and current fixed-point simulation positions for smooth visual interpolation
 *
 * NOTE: We store FPVector3 (fixed-point) for deterministic snapshot/capture,
 * but interpolate to Vector3 (float) for rendering.
 */
interface InterpolationState {
  entityId: number;
  /** Fixed-point position from previous simulation tick (authoritative) */
  previousFpPosition: FPVector3Type;
  /** Fixed-point position from current simulation tick (authoritative) */
  currentFpPosition: FPVector3Type;
  /** Visual position applied to mesh (interpolated, for rendering) */
  visualPosition: Vector3;
  /** Whether this entity needs interpolation */
  active: boolean;
}

/**
 * InterpolationSystem - Provides smooth visual movement between network ticks
 * Extends GameSystem for consistent lifecycle management
 *
 * ARCHITECTURE:
 * - Simulation runs at 20 ticks/sec (deterministic, synchronized)
 * - Rendering runs at 60 FPS (visual only, local)
 * - This system interpolates visual positions between simulation positions
 *
 * USAGE:
 * 1. Call snapshotPositions() BEFORE each simulation tick to save previous state
 * 2. Call captureCurrentPositions() AFTER each simulation tick to get new state
 * 3. Call interpolate(alpha) each render frame to smoothly blend positions
 *
 * The alpha value represents how far we are between the last tick and next tick:
 * - alpha = 0: Show position from previous tick
 * - alpha = 1: Show position from current tick
 * - alpha = 0.5: Show position halfway between
 */
export class InterpolationSystem extends GameSystem {
  private states: Map<number, InterpolationState> = new Map();

  // Entities that should NOT be interpolated (static structures)
  private staticEntities: Set<number> = new Set();

  constructor() {
    super();
  }

  /**
   * Initialize the system with context
   */
  public override init(context: SystemContext): void {
    super.init(context);
  }

  /**
   * Register an entity for interpolation
   * Call this when a new entity is created
   */
  public registerEntity(entityId: number, isStatic: boolean = false): void {
    if (isStatic) {
      this.staticEntities.add(entityId);
      return;
    }

    const entity = this.entityManager.getEntity(entityId);
    if (!entity) return;

    // Clone the authoritative fixed-point position for interpolation state
    const fpPos = entity.fpPosition;
    const clonedFpPos: FPVector3Type = FPVector3.Create(fpPos.x, fpPos.y, fpPos.z);
    const clonedFpPos2: FPVector3Type = FPVector3.Create(fpPos.x, fpPos.y, fpPos.z);

    this.states.set(entityId, {
      entityId,
      previousFpPosition: clonedFpPos,
      currentFpPosition: clonedFpPos2,
      visualPosition: entity.position.clone(),
      active: true,
    });
  }

  /**
   * Unregister an entity from interpolation
   * Call this when an entity is destroyed
   */
  public unregisterEntity(entityId: number): void {
    this.states.delete(entityId);
    this.staticEntities.delete(entityId);
  }

  /**
   * Snapshot current positions as "previous" positions
   * Call this BEFORE running simulation tick
   */
  public snapshotPositions(): void {
    for (const state of this.states.values()) {
      // Previous becomes what was current (copy fixed-point values)
      state.previousFpPosition = FPVector3.Create(
        state.currentFpPosition.x,
        state.currentFpPosition.y,
        state.currentFpPosition.z
      );
    }
  }

  /**
   * Capture current simulation positions
   * Call this AFTER running simulation tick
   */
  public captureCurrentPositions(): void {
    for (const state of this.states.values()) {
      const entity = this.entityManager.getEntity(state.entityId);
      if (!entity) continue;

      // Capture the new authoritative fixed-point simulation position
      const fpPos = entity.fpPosition;
      state.currentFpPosition = FPVector3.Create(fpPos.x, fpPos.y, fpPos.z);
    }
  }

  /**
   * Interpolate visual positions and apply to meshes
   * Call this every render frame
   *
   * Uses fixed-point positions as authoritative source and interpolates
   * to float Vector3 for smooth visual rendering.
   *
   * @param alpha Interpolation factor (0 = previous tick, 1 = current tick)
   */
  public interpolate(alpha: number): void {
    // Clamp alpha to valid range
    alpha = Math.max(0, Math.min(1, alpha));

    for (const state of this.states.values()) {
      const entity = this.entityManager.getEntity(state.entityId);
      if (!entity) continue;

      // Lerp between previous and current fixed-point positions,
      // writing result to the existing visualPosition Vector3 (no allocation)
      lerpVector3FromFpRef(
        state.previousFpPosition,
        state.currentFpPosition,
        alpha,
        state.visualPosition
      );

      // Apply visual position to the entity's mesh
      entity.setVisualPosition(state.visualPosition);
    }
  }

  /**
   * Snap all visual positions to current simulation positions
   * Use this when teleporting or on initial spawn
   */
  public snapToCurrentPositions(): void {
    for (const state of this.states.values()) {
      const entity = this.entityManager.getEntity(state.entityId);
      if (!entity) continue;

      // Copy current fixed-point position to both previous and current
      const fpPos = entity.fpPosition;
      state.previousFpPosition = FPVector3.Create(fpPos.x, fpPos.y, fpPos.z);
      state.currentFpPosition = FPVector3.Create(fpPos.x, fpPos.y, fpPos.z);

      // Convert fixed-point to visual position (no allocation, reuse existing Vector3)
      fpToVector3Ref(fpPos, state.visualPosition);

      // Apply to mesh
      entity.setVisualPosition(state.visualPosition);
    }
  }

  /**
   * Clear all interpolation states
   */
  public clear(): void {
    this.states.clear();
    this.staticEntities.clear();
  }

  /**
   * Dispose of the system
   */
  public override dispose(): void {
    super.dispose(); // Clean up subscriptions from base class
    this.clear();
  }
}
