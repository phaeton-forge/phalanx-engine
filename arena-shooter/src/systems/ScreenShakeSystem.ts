import { GameSystem, type SystemContext } from '@phalanx-engine/ecs';
import type { ArcRotateCamera } from '@babylonjs/core';
import { GameEvents, type ScreenShakeEvent } from '../events/GameEvents.ts';
import { vfxConfig } from '../config/vfxConfig.ts';

export class ScreenShakeSystem extends GameSystem {
  private intensity: number = 0;
  private camera: ArcRotateCamera | null = null;
  /** Last-applied shake offset — subtracted before the next frame's update. */
  private lastOffsetX: number = 0;
  private lastOffsetY: number = 0;
  private lastOffsetZ: number = 0;

  public override init(context: SystemContext): void {
    super.init(context);
    this.subscribe<ScreenShakeEvent>(GameEvents.SCREEN_SHAKE, (event) => {
      this.intensity = Math.max(this.intensity, event.intensity);
    });
  }

  public setCamera(camera: ArcRotateCamera): void {
    this.camera = camera;
  }

  public override update(deltaTime: number): void {
    if (!this.enabled || !this.camera) return;

    // Undo the previous frame's shake offset so CameraSystem's target is clean
    this.camera.target.x -= this.lastOffsetX;
    this.camera.target.y -= this.lastOffsetY;
    this.camera.target.z -= this.lastOffsetZ;
    this.lastOffsetX = 0;
    this.lastOffsetY = 0;
    this.lastOffsetZ = 0;

    const cfg = vfxConfig.screenShake;
    if (this.intensity > cfg.minThreshold) {
      this.lastOffsetX = (Math.random() - 0.5) * this.intensity;
      this.lastOffsetY = (Math.random() - 0.5) * this.intensity * cfg.yMultiplier;
      this.lastOffsetZ = (Math.random() - 0.5) * this.intensity;
      this.camera.target.addInPlaceFromFloats(this.lastOffsetX, this.lastOffsetY, this.lastOffsetZ);
      this.intensity *= Math.exp(-cfg.decayRate * deltaTime);
    } else {
      this.intensity = 0;
    }
  }
}
