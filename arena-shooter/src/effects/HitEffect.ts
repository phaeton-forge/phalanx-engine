import {
  Color4,
  Vector3,
  ParticleSystem,
  type Scene,
  type Color3,
} from '@babylonjs/core';
import { vfxConfig } from '../config/vfxConfig.ts';
import type { ParticlePool } from './ParticlePool.ts';

export class HitEffect {
  private pool: ParticlePool;

  constructor(_scene: Scene, pool: ParticlePool) {
    this.pool = pool;
  }

  public spawn(position: Vector3, teamColor: Color3): void {
    const cfg = vfxConfig.hitEffect;
    const ps = this.pool.acquire(cfg.particleCount);

    ps.emitter = position.clone();
    ps.minSize = cfg.minSize;
    ps.maxSize = cfg.maxSize;
    ps.minLifeTime = cfg.minLife;
    ps.maxLifeTime = cfg.maxLife;
    ps.emitRate = cfg.emitRate;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;

    ps.color1 = new Color4(teamColor.r, teamColor.g, teamColor.b, 1);
    ps.color2 = new Color4(teamColor.r * 0.7, teamColor.g * 0.7, teamColor.b * 0.7, 0.8);
    ps.colorDead = new Color4(teamColor.r * 0.2, teamColor.g * 0.2, teamColor.b * 0.2, 0);

    ps.minEmitPower = cfg.minEmitPower;
    ps.maxEmitPower = cfg.maxEmitPower;
    ps.gravity = new Vector3(0, cfg.gravityY, 0);
    ps.createSphereEmitter(0.3);

    ps.targetStopDuration = cfg.duration;
    ps.start();
    ps.onStoppedObservable.addOnce(() => this.pool.release(ps));
  }
}
