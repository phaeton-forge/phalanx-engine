import { ParticleSystem, Texture, type Scene, DynamicTexture } from '@babylonjs/core';
import { vfxConfig } from '../config/vfxConfig.ts';

/**
 * Generate a soft radial-gradient flare texture at runtime.
 * Avoids dependency on remote CDN or possibly-corrupt base64 blobs.
 */
function createFlareTexture(scene: Scene): Texture {
  const size = 64;
  const dt = new DynamicTexture('flare', size, scene, false);
  const ctx = dt.getContext();
  const half = size / 2;

  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  dt.update();
  dt.hasAlpha = true;
  return dt;
}

export class ParticlePool {
  private pool: ParticleSystem[] = [];
  private scene: Scene;
  private texture: Texture;

  constructor(scene: Scene) {
    this.scene = scene;
    this.texture = createFlareTexture(scene);
    // Pre-allocate
    for (let i = 0; i < vfxConfig.pool.initialSize; i++) {
      this.pool.push(this.createSystem());
    }
  }

  /** Counter for unique particle system names (render-only, determinism not required). */
  private static nextId = 0;

  private createSystem(): ParticleSystem {
    // VFX-only: Math.random() usage below is acceptable — particle systems are
    // render-frame effects and do not participate in deterministic tick simulation.
    const ps = new ParticleSystem('pooled_' + ParticlePool.nextId++, 100, this.scene);
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
    ps.onStoppedObservable.clear();
    ps.stop();
    ps.reset();
    // Reset configuration state that persists across reset()
    ps.gravity.set(0, 0, 0);
    ps.minEmitPower = 1;
    ps.maxEmitPower = 1;
    ps.minSize = 1;
    ps.maxSize = 1;
    ps.minLifeTime = 1;
    ps.maxLifeTime = 1;
    ps.emitRate = 10;
    ps.targetStopDuration = 0;
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
