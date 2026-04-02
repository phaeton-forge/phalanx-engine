import { ParticleSystem, Texture, type Scene } from '@babylonjs/core';
import { vfxConfig } from '../config/vfxConfig.ts';

/**
 * Bundled locally — avoids runtime dependency on remote CDN.
 * This is a 1x1 white-to-transparent radial gradient encoded as a data URI.
 */
const FLARE_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAa5JREFUWEftl7FuwkAQRN8eSCgSJSUF/AD/gMQPUCBRQkdBCR0FJeIH+AH+gaJMSpQGiRLlZNaac+7O5mwsRVjy+ey7nZ2d3TsbceMf3/j9+A/gfwVSgC+5qbfXHgBeBSF45HdoLSB7XC/L+QB4IxiYGzMm4GdCTBXJjI3FfAB8z4x5DPx6XR+A9wZiSpMVkVxiYi9VxDMA7/LJZ5U2VxXwLIqKQzLkgOmP2RkP+QyBeQi0eSU5k6cJGFYkc4Nk05J7MaTZJzPAOeSEZ5L+oR8moSHJMelz3kmPhHPJiU8krAI+TAOeaIoShK2JilR6c8k3RMG6VjSE0lPksQ08JHkzCQcKxIbCTb2ALA15HCQ4pGiCkqTBqYXzS8BzSQ5+9gK1p5jUSSxJAYpYUFCQzaX5+C1Ql0qk3UjOJZOQThVQxQZwKsBvJI1CnhhYbSuJI4NnRPRJ0g1JHSuJUwN3SrIjLCXBx4Aeq0ioqjqpIYgpLCb0bHKiPaP+Q6CixAI+Osu3nNF9ofqiuFPT/VuuaLBYSq8bwL+8H8Fvur+6T/gfQ3+BfAABU6BITwtwxAAAAAElFTkSuQmCC';

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
