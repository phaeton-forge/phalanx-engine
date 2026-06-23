import { GameSystem, type SystemContext } from '@phalanx-engine/ecs';
import type { InputManager } from '../core/InputManager.ts';
import { ComponentType } from '../components/ComponentType.ts';
import type { PlayerInputComponent } from '../components/PlayerInputComponent.ts';
import { FP } from '@phalanx-engine/math';

export class PlayerInputSystem extends GameSystem {
  private inputManager: InputManager;

  constructor(inputManager: InputManager) {
    super();
    this.inputManager = inputManager;
  }

  public override init(context: SystemContext): void {
    super.init(context);
  }

  public override processTick(_tick: number): void {
    const entities = this.entityManager.queryEntities(ComponentType.PlayerInput);
    for (const entity of entities) {
      const input = entity.getComponent<PlayerInputComponent>(ComponentType.PlayerInput);
      if (!input) continue;

      input.moveX = this.inputManager.moveX;
      input.moveZ = this.inputManager.moveZ;

      // Aim position is set in PlayerAimSystem (screen→world raycast)
      input.aimX = FP.FromFloat(this.inputManager.aimWorldX);
      input.aimZ = FP.FromFloat(this.inputManager.aimWorldZ);

      // Fire: consume single trigger
      const mouseFired = this.inputManager.consumeFire();
      const spaceFired = this.inputManager.isSpaceFiring;
      input.isFiring = mouseFired || spaceFired;

      input.isReloading = this.inputManager.consumeReload();
    }
  }
}
