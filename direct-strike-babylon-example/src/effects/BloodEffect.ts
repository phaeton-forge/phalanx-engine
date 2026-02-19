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
 * BloodEffect - Creates a blood splatter particle effect
 * Used when melee units take damage
 */
export class BloodEffect {
  private scene: Scene;
  private particleSystem: ParticleSystem;
  private emitter: Mesh;

  constructor(scene: Scene, position: Vector3, duration: number = 0.3) {
    this.scene = scene;

    // Create invisible emitter at blood position
    this.emitter = MeshBuilder.CreateSphere(
      'bloodEmitter',
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
      duration * 1000 + 300
    ); // Add extra time for particles to fade
  }

  private createParticleSystem(): ParticleSystem {
    const ps = new ParticleSystem('blood', 30, this.scene);

    // Use a procedural texture (blood droplet effect)
    ps.particleTexture = this.createDropletTexture();

    // Emitter
    ps.emitter = this.emitter;
    ps.minEmitBox = new Vector3(-0.2, 0, -0.2);
    ps.maxEmitBox = new Vector3(0.2, 0.3, 0.2);

    // Colors - dark red blood
    ps.color1 = new Color4(0.8, 0.05, 0.05, 1); // Dark red
    ps.color2 = new Color4(0.5, 0.02, 0.02, 1); // Darker red
    ps.colorDead = new Color4(0.3, 0.01, 0.01, 0); // Fade to transparent

    // Size - small droplets
    ps.minSize = 0.1;
    ps.maxSize = 0.25;

    // Lifetime - short burst
    ps.minLifeTime = 0.2;
    ps.maxLifeTime = 0.4;

    // Emission - quick burst
    ps.emitRate = 0; // Use manual emit
    ps.manualEmitCount = 15; // Burst emission

    // Speed - spray outward
    ps.minEmitPower = 1;
    ps.maxEmitPower = 3;
    ps.updateSpeed = 0.02;

    // Direction - mostly outward and slightly up
    ps.direction1 = new Vector3(-1, 0.5, -1);
    ps.direction2 = new Vector3(1, 1, 1);

    // Gravity - blood falls down
    ps.gravity = new Vector3(0, -8, 0);

    // Blend mode for blood (standard blending)
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;

    // Stop after one burst
    ps.targetStopDuration = 0.1;
    ps.disposeOnStop = false; // We'll dispose manually

    return ps;
  }

  private createDropletTexture(): Texture {
    // Create a simple procedural texture for blood droplets
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    // Create radial gradient for droplet effect
    const gradient = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2
    );
    gradient.addColorStop(0, 'rgba(200, 20, 20, 1)');
    gradient.addColorStop(0.5, 'rgba(150, 10, 10, 0.8)');
    gradient.addColorStop(1, 'rgba(100, 5, 5, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const texture = new Texture('data:' + canvas.toDataURL(), this.scene);
    texture.hasAlpha = true;
    return texture;
  }

  public dispose(): void {
    this.particleSystem.stop();
    this.particleSystem.dispose();
    this.emitter.dispose();
  }
}
