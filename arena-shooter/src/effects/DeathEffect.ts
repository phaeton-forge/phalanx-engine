import {
  Color4,
  Vector3,
  ParticleSystem,
  type Scene,
  type Color3,
} from '@babylonjs/core';
import { vfxConfig } from '../config/vfxConfig.ts';
import type { ParticlePool } from './ParticlePool.ts';

export class DeathEffect {
  private pool: ParticlePool;

  constructor(_scene: Scene, pool: ParticlePool) {
    this.pool = pool;
  }

  public spawn(position: Vector3, teamColor: Color3): void {
    this.spawnCore(position, teamColor);
    this.spawnSparks(position, teamColor);
    this.spawnRing(position, teamColor);
  }

  private spawnCore(position: Vector3, teamColor: Color3): void {
    const cfg = vfxConfig.deathEffect;
    const ps = this.pool.acquire(cfg.coreParticleCount);

    ps.emitter = position.clone();
    ps.minSize = cfg.coreMinSize;
    ps.maxSize = cfg.coreMaxSize;
    ps.minLifeTime = cfg.coreMinLife;
    ps.maxLifeTime = cfg.coreMaxLife;
    ps.emitRate = cfg.coreEmitRate;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;

    // White -> team color
    ps.color1 = new Color4(1, 1, 1, 1);
    ps.color2 = new Color4(teamColor.r, teamColor.g, teamColor.b, 1);
    ps.colorDead = new Color4(teamColor.r, teamColor.g, teamColor.b, 0);

    ps.minEmitPower = 0.5;
    ps.maxEmitPower = 1.5;
    ps.createSphereEmitter(0.1);

    ps.targetStopDuration = cfg.coreDuration;
    ps.start();
    ps.onStoppedObservable.addOnce(() => this.pool.release(ps));
  }

  private spawnSparks(position: Vector3, teamColor: Color3): void {
    const cfg = vfxConfig.deathEffect;
    const ps = this.pool.acquire(cfg.sparkParticleCount);

    ps.emitter = position.clone();
    ps.minSize = cfg.sparkMinSize;
    ps.maxSize = cfg.sparkMaxSize;
    ps.minLifeTime = cfg.sparkMinLife;
    ps.maxLifeTime = cfg.sparkMaxLife;
    ps.emitRate = cfg.sparkEmitRate;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;

    // Team color bright -> dim -> transparent
    ps.color1 = new Color4(teamColor.r, teamColor.g, teamColor.b, 1);
    ps.color2 = new Color4(teamColor.r * 0.5, teamColor.g * 0.5, teamColor.b * 0.5, 0.8);
    ps.colorDead = new Color4(teamColor.r * 0.2, teamColor.g * 0.2, teamColor.b * 0.2, 0);

    ps.minEmitPower = cfg.sparkMinEmitPower;
    ps.maxEmitPower = cfg.sparkMaxEmitPower;
    ps.gravity = new Vector3(0, cfg.sparkGravityY, 0);
    ps.createSphereEmitter(0.3);

    ps.targetStopDuration = cfg.sparkDuration;
    ps.start();
    ps.onStoppedObservable.addOnce(() => this.pool.release(ps));
  }

  private spawnRing(position: Vector3, teamColor: Color3): void {
    const cfg = vfxConfig.deathEffect;
    const ps = this.pool.acquire(cfg.ringParticleCount);

    ps.emitter = position.clone();
    ps.minSize = 0.1;
    ps.maxSize = 0.25;
    ps.minLifeTime = cfg.ringMinLife;
    ps.maxLifeTime = cfg.ringMaxLife;
    ps.emitRate = cfg.ringEmitRate;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;

    // Team color at 0.6 alpha -> 0
    ps.color1 = new Color4(teamColor.r, teamColor.g, teamColor.b, 0.6);
    ps.color2 = new Color4(teamColor.r, teamColor.g, teamColor.b, 0.3);
    ps.colorDead = new Color4(teamColor.r, teamColor.g, teamColor.b, 0);

    ps.minEmitPower = cfg.ringMinEmitPower;
    ps.maxEmitPower = cfg.ringMaxEmitPower;
    // Cylinder emitter for horizontal ring spread
    ps.createCylinderEmitter(0.1, 0.01, 0, 0);

    ps.targetStopDuration = cfg.ringDuration;
    ps.start();
    ps.onStoppedObservable.addOnce(() => this.pool.release(ps));
  }
}
