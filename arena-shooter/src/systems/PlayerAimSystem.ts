import { GameSystem, type SystemContext } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import { ComponentType } from '../components/ComponentType.ts';
import type { TransformComponent } from '../components/TransformComponent.ts';
import type { InputManager } from '../core/InputManager.ts';
import { Scene } from '@babylonjs/core';

export class PlayerAimSystem extends GameSystem {
  private inputManager: InputManager;
  private scene: Scene;

  /** Remembered normalized aim direction — survives joystick release. */
  private lastAimDirX: number = 0;
  private lastAimDirZ: number = 1; // default: face +Z

  /** Tick when the aim joystick was last active (for grace-period logic). */
  private lastAimActiveTick: number = Number.NEGATIVE_INFINITY;

  private static readonly DEADZONE = 0.15;
  private static readonly AIM_PROJECT_DIST = 10;
  /** Ticks to keep the aim direction locked after the aim joystick is released.
   *  Prevents movement direction from overwriting aim during a double-tap. */
  private static readonly AIM_GRACE_TICKS = 20;

  constructor(inputManager: InputManager, scene: Scene) {
    super();
    this.inputManager = inputManager;
    this.scene = scene;
  }

  public override init(context: SystemContext): void {
    super.init(context);
  }

  /**
   * Update aim world position by raycasting from camera through screen mouse coords.
   * Called each tick before rotation is computed.
   */
  private updateAimFromScreenCoords(): void {
    const x = this.inputManager.mouseScreenX;
    const y = this.inputManager.mouseScreenY;

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

  /**
   * Touch-specific aim handling.
   * Stores a persistent aim direction that is re-projected each tick from the
   * player's current position, avoiding stale world-space aim coordinates.
   *
   * Priority:
   *  1. Right (aim) joystick — updates stored direction immediately.
   *  2. Left (move) joystick — updates stored direction only after the aim
   *     grace period expires, so a double-tap never overwrites the aim.
   *  3. Neither active — stored direction is preserved as-is.
   */
  private updateTouchAim(tick: number): void {
    if (this.inputManager.joystickAimActive) {
      this.lastAimActiveTick = tick;
      const ax = this.inputManager.joystickAimX;
      const az = this.inputManager.joystickAimZ;
      const mag = Math.sqrt(ax * ax + az * az);
      if (mag >= PlayerAimSystem.DEADZONE) {
        this.lastAimDirX = ax / mag;
        this.lastAimDirZ = az / mag;
      }
    } else if ((tick - this.lastAimActiveTick) > PlayerAimSystem.AIM_GRACE_TICKS) {
      // Aim joystick released long enough — allow movement to drive facing
      const mx = FP.ToFloat(this.inputManager.moveX);
      const mz = FP.ToFloat(this.inputManager.moveZ);
      const mag = Math.sqrt(mx * mx + mz * mz);
      if (mag >= PlayerAimSystem.DEADZONE) {
        this.lastAimDirX = mx / mag;
        this.lastAimDirZ = mz / mag;
      }
    }
    // If neither branch updates the direction, it is preserved from last tick.

    // Re-project aim point from current player position + stored direction
    const entities = this.entityManager.queryEntities(ComponentType.PlayerInput);
    if (entities.length === 0) return;

    const entity = entities[0];
    const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
    if (!transform) return;

    const pos = transform.fpPosition;
    this.inputManager.aimWorldX =
      FP.ToFloat(pos.x) + this.lastAimDirX * PlayerAimSystem.AIM_PROJECT_DIST;
    this.inputManager.aimWorldZ =
      FP.ToFloat(pos.z) + this.lastAimDirZ * PlayerAimSystem.AIM_PROJECT_DIST;
  }

  public override dispose(): void {
    // No DOM listeners to clean up — aim uses BabylonJS scene raycasting
    super.dispose();
  }

  public override processTick(_tick: number): void {
    if (this.inputManager.hasTouchControls) {
      this.updateTouchAim(_tick);
    } else {
      this.updateAimFromScreenCoords();
    }

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
      transform.fpRotationY = angle;
    }
  }
}
