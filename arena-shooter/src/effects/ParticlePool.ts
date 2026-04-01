import { ParticleSystem, Texture, type Scene } from '@babylonjs/core';
import { vfxConfig } from '../config/vfxConfig.ts';

const FLARE_URL = 'https://assets.babylonjs.com/textures/flare.png';

export class ParticlePool {
  private pool: ParticleSystem[] = [];
  private scene: Scene;
  private texture: Texture;

  constructor(scene: Scene) {
    this.scene = scene;
    this.texture = new Texture(FLARE_URL, scene);
    // Pre-allocate
    for (let i = 0; i < vfxConfig.pool.initialSize; i++) {
      this.pool.push(this.createSystem());
    }
  }

  private createSystem(): ParticleSystem {
    const ps = new ParticleSystem('pooled_' + Math.random(), 100, this.scene);
    ps.particleTexture = this.texture;
    ps.disposeOnStop = false;
    return ps;
  }

  public acquire(capacity?: number): ParticleSystem {
    let ps = this.pool.pop();
    if (!ps) {
      if (capacity) {
        const newPs = new ParticleSystem('pooled_dyn', capacity, this.scene);
        newPs.particleTexture = this.texture;
        newPs.disposeOnStop = false;
        return newPs;
      }
      ps = this.createSystem();
    }
    return ps;
  }

  public release(ps: ParticleSystem): void {
    ps.stop();
    ps.reset();
    if (this.pool.length < vfxConfig.pool.maxSize) {
      this.pool.push(ps);
    } else {
      ps.dispose();
    }
  }

  public dispose(): void {
    this.pool.forEach(ps => ps.dispose());
    this.pool = [];
    this.texture.dispose();
  }
}
