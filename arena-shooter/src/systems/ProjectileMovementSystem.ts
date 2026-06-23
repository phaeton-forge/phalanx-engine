import { GameSystem } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import { ComponentType } from '../components/ComponentType.ts';
import type { ProjectileComponent } from '../components/ProjectileComponent.ts';
import type { TransformComponent } from '../components/TransformComponent.ts';
import { TICK_RATE, ARENA_SIZE } from '../config/constants.ts';

const FP_TIMESTEP = FP.Div(FP._1, FP.FromFloat(TICK_RATE));
const ARENA_HALF = ARENA_SIZE / 2;

export class ProjectileMovementSystem extends GameSystem {
  private readonly _tempPosition = { x: FP._0, y: FP._0, z: FP._0 };

  public override processTick(_tick: number): void {
    const entities = this.entityManager.queryEntities(ComponentType.Projectile);

    for (const entity of entities) {
      const projectile = entity.getComponent<ProjectileComponent>(ComponentType.Projectile);
      const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
      if (!projectile || !transform) continue;

      // Decrement lifetime
      projectile.lifetime--;
      if (projectile.lifetime <= 0) {
        entity.destroy();
        continue;
      }

      // Move projectile
      const distance = FP.Mul(projectile.speed, FP_TIMESTEP);
      const pos = transform.fpPosition;
      const newX = FP.Add(pos.x, FP.Mul(projectile.dirX, distance));
      const newZ = FP.Add(pos.z, FP.Mul(projectile.dirZ, distance));

      // Out-of-bounds check
      const nx = FP.ToFloat(newX);
      const nz = FP.ToFloat(newZ);
      if (nx < -ARENA_HALF || nx > ARENA_HALF || nz < -ARENA_HALF || nz > ARENA_HALF) {
        entity.destroy();
        continue;
      }

      this._tempPosition.x = newX;
      this._tempPosition.y = pos.y;
      this._tempPosition.z = newZ;
      transform.fpPosition = this._tempPosition;
    }
  }
}
