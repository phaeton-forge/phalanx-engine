import * as THREE from 'three';

/** Duration (seconds) for a collision particle burst */
const PARTICLE_LIFETIME = 0.6;
/** Number of particles per burst */
const PARTICLE_COUNT = 10;
/** Max trail points per checker */
const TRAIL_MAX_POINTS = 20;
/** Minimum speed to emit trail (world units / s) */
const TRAIL_SPEED_THRESHOLD = 2.0;

// ── Particle burst ──────────────────────────────────────────────

interface ParticleBurst {
  mesh: THREE.InstancedMesh;
  age: number;
  lifetime: number;
  velocities: THREE.Vector3[];
}

// ── Trail data ──────────────────────────────────────────────────

interface TrailData {
  line: THREE.Line;
  geometry: THREE.BufferGeometry;
  points: THREE.Vector3[];
}

/**
 * EffectsManager — visual juice: highlights, collision particles, speed trails.
 *
 * Not an ECS system — instantiated by ThreeRenderSystem and updated each frame.
 */
export class EffectsManager {
  private readonly scene: THREE.Scene;

  /** Active particle bursts */
  private bursts: ParticleBurst[] = [];

  /** Entity ID → trail data */
  private trails: Map<number, TrailData> = new Map();

  /** Shared small sphere geometry for particles */
  private readonly particleGeo: THREE.SphereGeometry;
  private readonly particleMat: THREE.MeshBasicMaterial;

  /** Emissive colour used for hover / team highlight */
  private static readonly HOVER_EMISSIVE = new THREE.Color(0xffffff);
  private static readonly TEAM_EMISSIVE = new THREE.Color(0x444422);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.particleGeo = new THREE.SphereGeometry(0.03, 6, 4);
    this.particleMat = new THREE.MeshBasicMaterial({
      color: 0xddccaa,
      transparent: true,
      opacity: 0.7,
    });
  }

  // ── Highlight helpers ──────────────────────────────────────────

  /**
   * Apply hover highlight to a mesh (emissive boost).
   */
  public setHoverHighlight(mesh: THREE.Mesh | THREE.Group, active: boolean): void {
    const target = mesh instanceof THREE.Group ? mesh.children[0] : mesh;
    if (!(target instanceof THREE.Mesh)) return;
    const mat = target.material;
    if (!(mat instanceof THREE.MeshStandardMaterial)) return;

    if (active) {
      mat.emissive.copy(EffectsManager.HOVER_EMISSIVE);
      mat.emissiveIntensity = 0.15;
    } else {
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0;
    }
  }

  /**
   * Apply a subtle team glow to a mesh.
   */
  public setTeamHighlight(mesh: THREE.Mesh | THREE.Group, active: boolean): void {
    const target = mesh instanceof THREE.Group ? mesh.children[0] : mesh;
    if (!(target instanceof THREE.Mesh)) return;
    const mat = target.material;
    if (!(mat instanceof THREE.MeshStandardMaterial)) return;

    if (active) {
      mat.emissive.copy(EffectsManager.TEAM_EMISSIVE);
      mat.emissiveIntensity = 0.08;
    } else {
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0;
    }
  }

  // ── Collision particles ────────────────────────────────────────

  /**
   * Spawn a small dust burst at the collision point.
   */
  public spawnCollisionParticles(x: number, y: number, z: number): void {
    const instanced = new THREE.InstancedMesh(this.particleGeo, this.particleMat, PARTICLE_COUNT);
    const velocities: THREE.Vector3[] = [];
    const dummy = new THREE.Object3D();

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 1.5;
      const vx = Math.cos(angle) * speed;
      const vy = 0.5 + Math.random() * 1.0;
      const vz = Math.sin(angle) * speed;
      velocities.push(new THREE.Vector3(vx, vy, vz));

      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    }
    instanced.instanceMatrix.needsUpdate = true;

    this.scene.add(instanced);
    this.bursts.push({ mesh: instanced, age: 0, lifetime: PARTICLE_LIFETIME, velocities });
  }

  // ── Speed trail ────────────────────────────────────────────────

  /**
   * Update the speed trail for a moving checker.
   * Call each frame with the checker's current world position and speed.
   */
  public updateTrail(entityId: number, x: number, y: number, z: number, speed: number): void {
    if (speed < TRAIL_SPEED_THRESHOLD) {
      this.removeTrail(entityId);
      return;
    }

    let trail = this.trails.get(entityId);
    if (!trail) {
      const geometry = new THREE.BufferGeometry();
      const material = new THREE.LineBasicMaterial({
        color: 0xffeedd,
        transparent: true,
        opacity: 0.35,
        depthTest: false,
      });
      const line = new THREE.Line(geometry, material);
      line.renderOrder = 998;
      this.scene.add(line);
      trail = { line, geometry, points: [] };
      this.trails.set(entityId, trail);
    }

    trail.points.push(new THREE.Vector3(x, y + 0.02, z));
    if (trail.points.length > TRAIL_MAX_POINTS) {
      trail.points.shift();
    }

    trail.geometry.setFromPoints(trail.points);
  }

  /**
   * Remove trail for an entity.
   */
  public removeTrail(entityId: number): void {
    const trail = this.trails.get(entityId);
    if (!trail) return;

    this.scene.remove(trail.line);
    trail.geometry.dispose();
    (trail.line.material as THREE.Material).dispose();
    this.trails.delete(entityId);
  }

  // ── Frame update ───────────────────────────────────────────────

  /**
   * Advance particle bursts and remove expired ones.
   */
  public update(dt: number): void {
    const dummy = new THREE.Object3D();

    // Update particle bursts
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i];
      burst.age += dt;

      if (burst.age >= burst.lifetime) {
        this.scene.remove(burst.mesh);
        burst.mesh.dispose();
        this.bursts.splice(i, 1);
        continue;
      }

      const alpha = burst.age / burst.lifetime;

      // Update each particle instance
      for (let p = 0; p < PARTICLE_COUNT; p++) {
        burst.mesh.getMatrixAt(p, dummy.matrix);
        dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);

        // Move
        dummy.position.addScaledVector(burst.velocities[p], dt);

        // Gravity
        burst.velocities[p].y -= 4.0 * dt;

        // Shrink
        const s = 1.0 - alpha;
        dummy.scale.set(s, s, s);

        dummy.updateMatrix();
        burst.mesh.setMatrixAt(p, dummy.matrix);
      }
      burst.mesh.instanceMatrix.needsUpdate = true;

      // Fade material
      (burst.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - alpha);
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────

  public dispose(): void {
    for (const burst of this.bursts) {
      this.scene.remove(burst.mesh);
      burst.mesh.dispose();
    }
    this.bursts = [];

    for (const [, trail] of this.trails) {
      this.scene.remove(trail.line);
      trail.geometry.dispose();
      (trail.line.material as THREE.Material).dispose();
    }
    this.trails.clear();

    this.particleGeo.dispose();
    this.particleMat.dispose();
  }
}


