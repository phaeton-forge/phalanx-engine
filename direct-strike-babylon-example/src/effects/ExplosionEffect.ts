import {
  Scene,
  Vector3,
  ParticleSystem,
  Texture,
  Color4,
  MeshBuilder,
  Mesh,
} from '@babylonjs/core';

/**
 * ExplosionEffect - Creates a particle-based explosion effect
 * Follows Single Responsibility: Only handles explosion visual effects
 */
export class ExplosionEffect {
  private scene: Scene;
  private particleSystem: ParticleSystem;
  private emitter: Mesh;

  constructor(scene: Scene, position: Vector3, duration: number = 0.5) {
    this.scene = scene;

    // Create invisible emitter at explosion position
    this.emitter = MeshBuilder.CreateSphere(
      'explosionEmitter',
      { diameter: 0.1 },
      scene
    );
    this.emitter.position = position.clone();
    this.emitter.isVisible = false;

    this.particleSystem = this.createParticleSystem();

    // Start the particle system
    this.particleSystem.start();

    // Auto-dispose after duration
    setTimeout(
      () => {
        this.dispose();
      },
      duration * 1000 + 500
    ); // Add extra time for particles to fade
  }

  private createParticleSystem(): ParticleSystem {
    const ps = new ParticleSystem('explosion', 100, this.scene);

    // Use a procedural texture (flare effect)
    ps.particleTexture = this.createFlareTexture();

    // Emitter
    ps.emitter = this.emitter;
    ps.minEmitBox = new Vector3(-0.2, -0.2, -0.2);
    ps.maxEmitBox = new Vector3(0.2, 0.2, 0.2);

    // Colors - orange to red to black
    ps.color1 = new Color4(1, 0.5, 0, 1); // Orange
    ps.color2 = new Color4(1, 0.2, 0, 1); // Red-orange
    ps.colorDead = new Color4(0.2, 0.1, 0, 0); // Fade to transparent

    // Size
    ps.minSize = 0.3;
    ps.maxSize = 0.8;

    // Lifetime
    ps.minLifeTime = 0.2;
    ps.maxLifeTime = 0.5;

    // Emission
    ps.emitRate = 200;
    ps.manualEmitCount = 50; // Burst emission

    // Speed
    ps.minEmitPower = 2;
    ps.maxEmitPower = 5;
    ps.updateSpeed = 0.02;

    // Direction
    ps.direction1 = new Vector3(-1, 1, -1);
    ps.direction2 = new Vector3(1, 1, 1);

    // Gravity
    ps.gravity = new Vector3(0, -5, 0);

    // Blend mode for additive glow
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;

    // Stop after one burst
    ps.targetStopDuration = 0.1;
    ps.disposeOnStop = false; // We'll dispose manually

    return ps;
  }

  private createFlareTexture(): Texture {
    // Create a simple procedural texture for particles
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    // Create radial gradient for flare effect
    const gradient = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2
    );
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.3, 'rgba(255, 200, 100, 0.8)');
    gradient.addColorStop(0.6, 'rgba(255, 100, 0, 0.4)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const texture = new Texture('data:' + canvas.toDataURL(), this.scene);
    return texture;
  }

  public dispose(): void {
    this.particleSystem.stop();
    this.particleSystem.dispose();
    this.emitter.dispose();
  }
}
