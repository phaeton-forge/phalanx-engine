import { GameSystem, type SystemContext } from '@phalanx-engine/ecs';
import type { ArcRotateCamera } from '@babylonjs/core';
import type { Mesh } from '@babylonjs/core';
import { ComponentType } from '../components/ComponentType.ts';
import type { InterpolationComponent } from '../components/InterpolationComponent.ts';

export class CameraSystem extends GameSystem {
  private camera: ArcRotateCamera;
  private playerId: number = -1;
  constructor(camera: ArcRotateCamera, _meshMap: Map<number, Mesh>) {
    super();
    this.camera = camera;
  }

  public setPlayerId(id: number): void {
    this.playerId = id;
  }

  public override init(context: SystemContext): void {
    super.init(context);
  }

  public override update(deltaTime: number): void {
    if (this.playerId === -1) return;

    const player = this.entityManager.getEntity(this.playerId);
    if (!player) return;

    const interp = player.getComponent<InterpolationComponent>(ComponentType.Interpolation);
    if (!interp) return;

    // Smooth lerp towards player position
    const lerpFactor = Math.min(1, deltaTime * 5);
    this.camera.target.x += (interp.visualPosition.x - this.camera.target.x) * lerpFactor;
    this.camera.target.z += (interp.visualPosition.z - this.camera.target.z) * lerpFactor;
    this.camera.target.y = 0;
  }
}
