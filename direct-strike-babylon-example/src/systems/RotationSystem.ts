import type { SystemContext } from '@phalanx-engine/ecs';
import { GameSystem } from '@phalanx-engine/ecs';
import { ComponentType, RotationComponent } from '../components';
import { FP } from '@phalanx-engine/math';

// Pre-computed fixed-point constants for rotation calculations
const FP_PI = FP.Pi;
const FP_TWO_PI = FP.Pi2;
const FP_SNAP_THRESHOLD = FP.FromFloat(0.01);

/**
 * RotationSystem - Handles smooth rotation interpolation for entities
 *
 * Follows ECS pattern: contains logic, entities store data in components
 * Extends GameSystem for consistent lifecycle management
 *
 * Responsibilities:
 * - Interpolate rotation towards target
 * - Handle shortest rotation path
 * - Clear target when reached
 */
export class RotationSystem extends GameSystem {
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
   * Update rotation for all entities with RotationComponent
   * Should be called in the render loop
   * @param deltaTime Time since last frame in seconds
   */
  public override update(deltaTime: number): void {
    const entities = this.entityManager.queryEntities(ComponentType.Rotation);

    for (const entity of entities) {
      const rotation = entity.getComponent<RotationComponent>(
        ComponentType.Rotation
      );
      if (
        !rotation ||
        !rotation.transformNode ||
        rotation.targetRotationY === null
      ) {
        continue;
      }

      this.updateEntityRotation(rotation, deltaTime);
    }
  }

  /**
   * Update rotation interpolation for a single entity
   * Uses fixed-point math for deterministic angle calculations.
   */
  private updateEntityRotation(
    rotation: RotationComponent,
    deltaTime: number
  ): void {
    const transformNode = rotation.transformNode;
    if (!transformNode || rotation.targetRotationY === null) return;

    // Clear quaternion if set (GLB models use quaternion by default)
    transformNode.rotationQuaternion = null;

    // Use fixed-point for deterministic angle difference calculation
    const fpCurrentRotation = FP.FromFloat(transformNode.rotation.y);
    const fpTargetRotation = FP.FromFloat(rotation.targetRotationY);

    // Calculate the shortest rotation direction using fixed-point
    let fpDiff = FP.Sub(fpTargetRotation, fpCurrentRotation);

    // Normalize to [-PI, PI] for shortest path using fixed-point
    while (FP.Gt(fpDiff, FP_PI)) {
      fpDiff = FP.Sub(fpDiff, FP_TWO_PI);
    }
    while (FP.Lt(fpDiff, FP.Neg(FP_PI))) {
      fpDiff = FP.Add(fpDiff, FP_TWO_PI);
    }

    // Check if we're close enough to snap using fixed-point comparison
    if (FP.Lt(FP.Abs(fpDiff), FP_SNAP_THRESHOLD)) {
      transformNode.rotation.y = rotation.targetRotationY;
      rotation.clearTarget(); // Clear target, we've reached it
      return;
    }

    // Interpolate towards target rotation using fixed-point for determinism
    const fpDeltaTime = FP.FromFloat(deltaTime);
    const fpRotationSpeed = FP.FromFloat(rotation.rotationSpeed);
    const fpMaxRotation = FP.Mul(fpRotationSpeed, fpDeltaTime);

    // Calculate rotation step: sign(diff) * min(abs(diff), maxRotation)
    const fpAbsDiff = FP.Abs(fpDiff);
    const fpStepMagnitude = FP.Lt(fpAbsDiff, fpMaxRotation) ? fpAbsDiff : fpMaxRotation;
    const fpRotationStep = FP.Gt(fpDiff, FP._0)
      ? fpStepMagnitude
      : FP.Neg(fpStepMagnitude);

    // Apply rotation (convert back to float for Babylon.js)
    const newRotation = FP.Add(fpCurrentRotation, fpRotationStep);
    transformNode.rotation.y = FP.ToFloat(newRotation);
  }

  public override dispose(): void {
    super.dispose(); // Clean up subscriptions from base class
    // No additional cleanup needed currently
  }
}
