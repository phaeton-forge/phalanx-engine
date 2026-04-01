import { GameSystem, type SystemContext } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import { ComponentType } from '../components/ComponentType.ts';
import type { TransformComponent } from '../components/TransformComponent.ts';
import type { InputManager } from '../core/InputManager.ts';
import { Scene } from '@babylonjs/core';

export class PlayerAimSystem extends GameSystem {
  private inputManager: InputManager;
  private scene: Scene;

  constructor(inputManager: InputManager, scene: Scene) {
    super();
    this.inputManager = inputManager;
    this.scene = scene;
  }

  public override init(context: SystemContext): void {
    super.init(context);

    // Listen for mouse move to update aim world position via raycast
    this.scene.getEngine().getRenderingCanvas()?.addEventListener('mousemove', (e: MouseEvent) => {
      this.updateAimPosition(e);
    });
  }

  private updateAimPosition(e: MouseEvent): void {
    const canvas = this.scene.getEngine().getRenderingCanvas();
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Create a ray from camera through screen position
    const ray = this.scene.createPickingRay(
      x,
      y,
      null,
      this.scene.activeCamera,
    );

    // Intersect with Y=0 plane
    if (Math.abs(ray.direction.y) > 0.001) {
      const t = -ray.origin.y / ray.direction.y;
      if (t > 0) {
        this.inputManager.aimWorldX = ray.origin.x + ray.direction.x * t;
        this.inputManager.aimWorldZ = ray.origin.z + ray.direction.z * t;
      }
    }
  }

  public override processTick(_tick: number): void {
    const entities = this.entityManager.queryEntities(ComponentType.PlayerInput);
    for (const entity of entities) {
      const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
      if (!transform) continue;

      const pos = transform.fpPosition;
      const aimX = FP.FromFloat(this.inputManager.aimWorldX);
      const aimZ = FP.FromFloat(this.inputManager.aimWorldZ);

      const dx = FP.Sub(aimX, pos.x);
      const dz = FP.Sub(aimZ, pos.z);

      // Compute rotation angle: atan2(dx, dz) for facing direction
      const angle = FP.Atan2(dx, dz);
      transform.fpRotationY = FP.ToRaw(angle);
    }
  }
}
