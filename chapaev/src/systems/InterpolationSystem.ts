import { GameSystem } from 'phalanx-ecs';
import { FP, FPVector3 } from 'phalanx-math';
import { ComponentType } from '../components/Component.ts';
import type { InterpolationComponent } from '../components/InterpolationComponent.ts';
import type { TransformComponent } from '../components/TransformComponent.ts';
import type { CheckerComponent } from '../components/CheckerComponent.ts';

/**
 * InterpolationSystem — provides smooth visual movement between network ticks.
 *
 * Simulation: 20 ticks/sec (deterministic, lockstep-synchronised).
 * Rendering: 60+ fps (visual only, local).
 *
 * Usage from GameWorld lifecycle hooks:
 * 1. beforeTick:  snapshotPositions()  — save positions BEFORE tick systems run
 * 2. afterTick:   captureCurrentPositions() — capture positions AFTER tick systems run
 * 3. afterFrame:  interpolate(alpha)   — lerp visual positions between ticks
 *
 * Only interpolates alive checkers. Dead checkers are managed by RapierVFXSystem.
 */
export class InterpolationSystem extends GameSystem {
  /**
   * Snapshot current positions as "previous" positions.
   * Call BEFORE running simulation tick.
   */
  public snapshotPositions(): void {
    const entities = this.entityManager.queryEntities(ComponentType.Interpolation);
    for (const entity of entities) {
      const interp = entity.getComponent<InterpolationComponent>(ComponentType.Interpolation);
      if (interp?.active) {
        interp.snapshotPosition();
      }
    }
  }

  /**
   * Capture current simulation positions.
   * Call AFTER running simulation tick.
   */
  public captureCurrentPositions(): void {
    const entities = this.entityManager.queryEntities(ComponentType.Interpolation);
    for (const entity of entities) {
      const interp = entity.getComponent<InterpolationComponent>(ComponentType.Interpolation);
      const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
      if (!interp?.active || !transform) continue;

      // Deactivate interpolation for dead checkers
      const checker = entity.getComponent<CheckerComponent>(ComponentType.Checker);
      if (checker && !checker.isAlive) {
        interp.active = false;
        continue;
      }

      interp.capturePosition(transform.fpPosition);
    }
  }

  /**
   * Interpolate visual positions and write them to TransformComponent.
   * Call every render frame.
   *
   * Uses float lerp (more efficient than FP lerp for visuals).
   *
   * @param alpha Interpolation factor (0 = previous tick, 1 = current tick)
   */
  public interpolate(alpha: number): void {
    alpha = Math.max(0, Math.min(1, alpha));

    const entities = this.entityManager.queryEntities(ComponentType.Interpolation);
    for (const entity of entities) {
      const interp = entity.getComponent<InterpolationComponent>(ComponentType.Interpolation);
      if (!interp?.active) continue;

      const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
      if (!transform) continue;

      // Convert FP to float then lerp (avoids FP math overhead for visuals)
      const prevPos = FPVector3.ToFloat(interp.previousFpPosition);
      const curPos = FPVector3.ToFloat(interp.currentFpPosition);

      transform.setVisualPosition(
        prevPos.x + (curPos.x - prevPos.x) * alpha,
        prevPos.y + (curPos.y - prevPos.y) * alpha,
        prevPos.z + (curPos.z - prevPos.z) * alpha,
      );
    }
  }

  /**
   * Snap all interpolated entities to their current simulation position.
   * Use on initial spawn or after reconnect fast-forward.
   */
  public snapToCurrentPositions(): void {
    const entities = this.entityManager.queryEntities(ComponentType.Interpolation);
    for (const entity of entities) {
      const interp = entity.getComponent<InterpolationComponent>(ComponentType.Interpolation);
      const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
      if (!interp || !transform) continue;

      const fpPos = transform.fpPosition;
      interp.snapToPosition(fpPos);

      const floats = FPVector3.ToFloat(fpPos);
      transform.setVisualPosition(floats.x, floats.y, floats.z);
    }
  }
}
