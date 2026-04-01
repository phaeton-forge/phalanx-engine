import { GameSystem, type SystemContext } from 'phalanx-ecs';
import type { ArcRotateCamera } from '@babylonjs/core';
import { GameEvents, type ScreenShakeEvent } from '../events/GameEvents.ts';
import { vfxConfig } from '../config/vfxConfig.ts';

export class ScreenShakeSystem extends GameSystem {
  private intensity: number = 0;
  private camera: ArcRotateCamera | null = null;

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
    const cfg = vfxConfig.screenShake;
    if (this.intensity > cfg.minThreshold) {
      const offsetX = (Math.random() - 0.5) * this.intensity;
      const offsetY = (Math.random() - 0.5) * this.intensity * cfg.yMultiplier;
      const offsetZ = (Math.random() - 0.5) * this.intensity;
      this.camera.target.addInPlaceFromFloats(offsetX, offsetY, offsetZ);
      this.intensity *= Math.exp(-cfg.decayRate * deltaTime);
    } else {
      this.intensity = 0;
    }
  }
}
