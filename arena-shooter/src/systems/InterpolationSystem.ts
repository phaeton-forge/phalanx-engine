import { GameSystem, type SystemContext } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import { ComponentType } from '../components/ComponentType.ts';
import type { InterpolationComponent } from '../components/InterpolationComponent.ts';
import type { TransformComponent } from '../components/TransformComponent.ts';

export class InterpolationSystem extends GameSystem {
  public override init(context: SystemContext): void {
    super.init(context);
  }

  public snapshotPositions(): void {
    const entities = this.entityManager.queryEntities(ComponentType.Interpolation);
    for (const entity of entities) {
      const interp = entity.getComponent<InterpolationComponent>(ComponentType.Interpolation);
      if (!interp || !interp.active) continue;
      interp.snapshotPosition();
    }
  }

  public captureCurrentPositions(): void {
    const entities = this.entityManager.queryEntities(ComponentType.Interpolation);
    for (const entity of entities) {
      const interp = entity.getComponent<InterpolationComponent>(ComponentType.Interpolation);
      const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
      if (!interp || !interp.active || !transform) continue;
      interp.capturePosition(transform.fpPosition, transform.visualRotationY);
    }
  }

  public interpolate(alpha: number): void {
    alpha = Math.max(0, Math.min(1, alpha));

    const entities = this.entityManager.queryEntities(ComponentType.Interpolation);
    for (const entity of entities) {
      const interp = entity.getComponent<InterpolationComponent>(ComponentType.Interpolation);
      if (!interp || !interp.active) continue;

      // Lerp position
      interp.visualPosition.x = FP.ToFloat(interp.previousFpPosition.x) * (1 - alpha) +
        FP.ToFloat(interp.currentFpPosition.x) * alpha;
      interp.visualPosition.y = FP.ToFloat(interp.previousFpPosition.y) * (1 - alpha) +
        FP.ToFloat(interp.currentFpPosition.y) * alpha;
      interp.visualPosition.z = FP.ToFloat(interp.previousFpPosition.z) * (1 - alpha) +
        FP.ToFloat(interp.currentFpPosition.z) * alpha;

      // Lerp rotation
      interp.visualRotationY = interp.previousRotationY * (1 - alpha) +
        interp.currentRotationY * alpha;
    }
  }
}
