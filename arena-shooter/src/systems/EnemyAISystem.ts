import { GameSystem, type SystemContext } from '@phalanx-engine/ecs';
import { FP, FPVector3 } from '@phalanx-engine/math';
import { PhysicsBodyComponent } from '@phalanx-engine/physics';
import { ComponentType } from '../components/ComponentType.ts';
import type { EnemyAIComponent } from '../components/EnemyAIComponent.ts';
import type { TransformComponent } from '../components/TransformComponent.ts';

export class EnemyAISystem extends GameSystem {
  public override init(context: SystemContext): void {
    super.init(context);
  }

  public override processTick(_tick: number): void {
    const enemies = this.entityManager.queryEntities(ComponentType.EnemyAI);

    for (const entity of enemies) {
      const ai = entity.getComponent<EnemyAIComponent>(ComponentType.EnemyAI);
      const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
      const body = entity.getComponent<PhysicsBodyComponent>(ComponentType.PhysicsBody);
      if (!ai || !transform || !body) continue;

      const target = this.entityManager.getEntity(ai.targetEntityId);
      if (!target) {
        body.stopVelocity();
        continue;
      }

      const targetTransform = target.getComponent<TransformComponent>(ComponentType.Transform);
      if (!targetTransform) {
        body.stopVelocity();
        continue;
      }

      const enemyPos = transform.fpPosition;
      const playerPos = targetTransform.fpPosition;

      const dx = FP.Sub(playerPos.x, enemyPos.x);
      const dz = FP.Sub(playerPos.z, enemyPos.z);
      const dir = FPVector3.Normalize(FPVector3.Create(dx, FP._0, dz));

      body.setVelocity(
        FP.Mul(dir.x, ai.speed),
        FP._0,
        FP.Mul(dir.z, ai.speed),
      );
    }
  }
}
