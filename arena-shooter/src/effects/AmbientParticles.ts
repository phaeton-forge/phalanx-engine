import {
  ParticleSystem,
  Texture,
  Vector3,
  Color4,
  type Scene,
} from '@babylonjs/core';
import { vfxConfig } from '../config/vfxConfig.ts';

const FLARE_URL = 'https://assets.babylonjs.com/textures/flare.png';

export class AmbientParticles {
  private ps: ParticleSystem;

  constructor(scene: Scene, arenaWidth: number, arenaHeight: number) {
    const cfg = vfxConfig.ambient;

    this.ps = new ParticleSystem('ambient', cfg.particleCount, scene);
    this.ps.particleTexture = new Texture(FLARE_URL, scene);

    // Box emitter covering the arena, just above the floor
    this.ps.emitter = Vector3.Zero();
    const halfW = arenaWidth / 2;
    const halfH = arenaHeight / 2;
    this.ps.minEmitBox = new Vector3(-halfW, 0, -halfH);
    this.ps.maxEmitBox = new Vector3(halfW, 0.5, halfH);

    this.ps.minSize = cfg.minSize;
    this.ps.maxSize = cfg.maxSize;
    this.ps.minLifeTime = cfg.minLife;
    this.ps.maxLifeTime = cfg.maxLife;
    this.ps.emitRate = cfg.emitRate;
    this.ps.blendMode = ParticleSystem.BLENDMODE_ADD;

    this.ps.color1 = new Color4(cfg.color.r, cfg.color.g, cfg.color.b, cfg.color.a);
    this.ps.color2 = new Color4(cfg.color.r, cfg.color.g, cfg.color.b, cfg.color.a * 0.5);
    this.ps.colorDead = new Color4(0, 0, 0, 0);

    this.ps.minEmitPower = 0.05;
    this.ps.maxEmitPower = 0.15;
    this.ps.updateSpeed = 0.005;
  }

  public start(): void {
    this.ps.start();
  }

  public stop(): void {
    this.ps.stop();
  }

  public dispose(): void {
    this.ps.dispose();
  }
}
