import type { SystemContext } from '@phalanx-engine/ecs';
import { GameSystem } from '@phalanx-engine/ecs';
import type { IMeshEntity } from '../interfaces/IMeshEntity';
import {
  fpToVector3Ref,
  lerpVector3FromFpRef,
} from '../core/MathConversions';
import { ComponentType, InterpolationComponent, TransformComponent } from '../components';

/**
 * InterpolationSystem - Provides smooth visual movement between network ticks
 * Extends GameSystem for consistent lifecycle management
 *
 * This is a core system that should always be present in multiplayer games.
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
 *
 * Following ECS principles: queries entities with InterpolationComponent
 * instead of maintaining internal state.
 */
export class InterpolationSystem extends GameSystem {
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
   * Snapshot current positions as "previous" positions
   * Call this BEFORE running simulation tick
   */
  public snapshotPositions(): void {
    const entities = this.entityManager.queryEntities(ComponentType.Interpolation);

    for (const entity of entities) {
      const interpolation = entity.getComponent<InterpolationComponent>(ComponentType.Interpolation);
      if (!interpolation || !interpolation.active) continue;

      interpolation.snapshotPosition();
    }
  }

  /**
   * Capture current simulation positions
   * Call this AFTER running simulation tick
   */
  public captureCurrentPositions(): void {
    const entities = this.entityManager.queryEntities(ComponentType.Interpolation);

    for (const entity of entities) {
      const interpolation = entity.getComponent<InterpolationComponent>(ComponentType.Interpolation);
      const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
      if (!interpolation || !interpolation.active || !transform) continue;

      interpolation.capturePosition(transform.fpPosition);
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

    const entities = this.entityManager.queryEntities(ComponentType.Interpolation);

    for (const entity of entities) {
      const interpolation = entity.getComponent<InterpolationComponent>(ComponentType.Interpolation);
      if (!interpolation || !interpolation.active) continue;

      // Lerp between previous and current fixed-point positions,
      // writing result to the existing visualPosition Vector3 (no allocation)
      lerpVector3FromFpRef(
        interpolation.previousFpPosition,
        interpolation.currentFpPosition,
        alpha,
        interpolation.visualPosition
      );

      // Apply visual position to the entity's mesh
      (entity as unknown as IMeshEntity).setVisualPosition(interpolation.visualPosition);
    }
  }

  /**
   * Snap all visual positions to current simulation positions
   * Use this when teleporting or on initial spawn
   */
  public snapToCurrentPositions(): void {
    const entities = this.entityManager.queryEntities(ComponentType.Interpolation);

    for (const entity of entities) {
      const interpolation = entity.getComponent<InterpolationComponent>(ComponentType.Interpolation);
      const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
      if (!interpolation || !transform) continue;

      // Snap to current entity position
      const fpPos = transform.fpPosition;
      interpolation.snapToPosition(fpPos);

      // Convert fixed-point to visual position (no allocation, reuse existing Vector3)
      fpToVector3Ref(fpPos, interpolation.visualPosition);

      // Apply to mesh
      (entity as unknown as IMeshEntity).setVisualPosition(interpolation.visualPosition);
    }
  }

  /**
   * Dispose of the system
   */
  public override dispose(): void {
    super.dispose(); // Clean up subscriptions from base class
  }
}
