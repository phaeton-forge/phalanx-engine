import { GameSystem, type SystemContext } from '@phalanx-engine/ecs';
import type { Mesh } from '@babylonjs/core';
import { ComponentType } from '../components/ComponentType.ts';
import type { InterpolationComponent } from '../components/InterpolationComponent.ts';
import type { TransformComponent } from '../components/TransformComponent.ts';

export class MeshSyncSystem extends GameSystem {
  private meshMap: Map<number, Mesh>;

  constructor(meshMap: Map<number, Mesh>) {
    super();
    this.meshMap = meshMap;
  }

  public override init(context: SystemContext): void {
    super.init(context);
  }

  public override update(_deltaTime: number): void {
    const entities = this.entityManager.queryEntities(ComponentType.Transform);

    for (const entity of entities) {
      const mesh = this.meshMap.get(entity.id);
      if (!mesh) continue;

      const interp = entity.getComponent<InterpolationComponent>(ComponentType.Interpolation);
      const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
      if (!transform) continue;

      if (interp && interp.active) {
        mesh.position.x = interp.visualPosition.x;
        mesh.position.z = interp.visualPosition.z;
        // Y position is set based on entity type (capsule offset etc)
        // For player/enemy: keep mesh Y as-is (set at creation)
        // For projectiles: use interpolated Y
        const hasProjectile = entity.hasComponent(ComponentType.Projectile);
        if (hasProjectile) {
          mesh.position.y = interp.visualPosition.y;
        }
      } else {
        const vis = transform.visualPosition;
        mesh.position.x = vis.x;
        mesh.position.z = vis.z;
      }

      // Apply rotation — prefer interpolated rotation when available
      if (interp && interp.active) {
        mesh.rotation.y = interp.visualRotationY;
      } else {
        mesh.rotation.y = transform.visualRotationY;
      }
    }
  }
}
