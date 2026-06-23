import { GameSystem, type SystemContext } from '@phalanx-engine/ecs';
import { PhysicsBodyComponent } from '@phalanx-engine/physics';
import { FP, FPVector3 } from '@phalanx-engine/math';
import { ComponentType } from '../components/ComponentType.ts';
import type { PlayerInputComponent } from '../components/PlayerInputComponent.ts';
import { PLAYER_SPEED } from '../config/constants.ts';

export class PlayerMovementSystem extends GameSystem {
  public override init(context: SystemContext): void {
    super.init(context);
  }

  public override processTick(_tick: number): void {
    const entities = this.entityManager.queryEntities(ComponentType.PlayerInput);
    for (const entity of entities) {
      const input = entity.getComponent<PlayerInputComponent>(ComponentType.PlayerInput);
      const body = entity.getComponent<PhysicsBodyComponent>(ComponentType.PhysicsBody);
      if (!input || !body) continue;

      let vx = input.moveX;
      let vz = input.moveZ;

      // Normalize diagonal movement
      const moveVec = FPVector3.Create(vx, FP._0, vz);
      const sqrMag = FPVector3.SqrMagnitude(moveVec);
      if (FP.Gt(sqrMag, FP._1)) {
        const normalized = FPVector3.Normalize(moveVec);
        vx = normalized.x;
        vz = normalized.z;
      }

      body.setVelocity(
        FP.Mul(vx, PLAYER_SPEED),
        FP._0,
        FP.Mul(vz, PLAYER_SPEED),
      );
    }
  }
}
