import * as THREE from 'three';
import { TeamTag } from '../enums/TeamTag.ts';
import {
  BOARD_HEIGHT,
  HALO_COLOR_WHITE,
  HALO_COLOR_BLACK,
  HALO_HDR_SCALE,
  HALO_GLOW_RADIUS,
  HALO_SEGMENTS,
  HALO_BASE_OPACITY,
  HALO_PULSE_AMPLITUDE,
  HALO_PULSE_SPEED,
  HALO_INNER_RATIO,
  HALO_FALLOFF,
} from '../config/constants.ts';

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

  /** Emissive colour used for hover highlight */
  private static readonly HOVER_EMISSIVE = new THREE.Color(0xffffff);

  // ── Halo glow resources ─────────────────────────────────────────

  /** Shared circle geometry for all halos (flat disc on XZ plane) */
  private readonly haloGeo: THREE.CircleGeometry;

  /** Per-team radial-glow shader materials */
  private readonly haloMatWhite: THREE.ShaderMaterial;
  private readonly haloMatBlack: THREE.ShaderMaterial;

  /** Checker Object3D → halo glow mesh */
  private readonly halos: Map<THREE.Object3D, THREE.Mesh> = new Map();

  /** Y position of halo discs (just above board surface) */
  private readonly haloY = BOARD_HEIGHT / 2 + 0.005;

  /** Accumulated time for the breathing pulse */
  private glowTime = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.particleGeo = new THREE.SphereGeometry(0.03, 6, 4);
    this.particleMat = new THREE.MeshBasicMaterial({
      color: 0xddccaa,
      transparent: true,
      opacity: 0.7,
    });

    // Shared circle geometry (flat on XZ plane after rotation)
    this.haloGeo = new THREE.CircleGeometry(HALO_GLOW_RADIUS, HALO_SEGMENTS);

    // Radial-glow shader: bright at checker edge, smooth falloff to transparent
    const haloVertexShader = /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const haloFragmentShader = /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uInnerRatio;
      uniform float uFalloff;

      varying vec2 vUv;

      void main() {
        // Distance from disc centre (0..1)
        float d = length(vUv - 0.5) * 2.0;

        // Smooth radial gradient: full brightness inside inner ratio,
        // then power-curve falloff to the edge
        float glow = 1.0 - smoothstep(uInnerRatio, 1.0, d);
        glow = pow(glow, uFalloff);

        gl_FragColor = vec4(uColor, glow * uOpacity);
      }
    `;

    const makeHaloMaterial = (baseColor: number): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(baseColor).multiplyScalar(HALO_HDR_SCALE) },
          uOpacity: { value: HALO_BASE_OPACITY },
          uInnerRatio: { value: HALO_INNER_RATIO },
          uFalloff: { value: HALO_FALLOFF },
        },
        vertexShader: haloVertexShader,
        fragmentShader: haloFragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

    this.haloMatWhite = makeHaloMaterial(HALO_COLOR_WHITE);
    this.haloMatBlack = makeHaloMaterial(HALO_COLOR_BLACK);
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
   * Show or hide a soft radial glow under a checker to indicate the active team.
   * Creates a shader-driven disc on the board surface when `active` is true;
   * removes it when false. Idempotent — safe to call every frame.
   */
  public setTeamHighlight(mesh: THREE.Mesh | THREE.Group, active: boolean, team?: TeamTag): void {
    if (active) {
      if (this.halos.has(mesh)) return; // already showing

      const mat = team === TeamTag.Black ? this.haloMatBlack : this.haloMatWhite;
      const halo = new THREE.Mesh(this.haloGeo, mat);
      halo.rotation.x = -Math.PI / 2;
      halo.position.set(mesh.position.x, this.haloY, mesh.position.z);
      halo.renderOrder = 999;

      this.scene.add(halo);
      this.halos.set(mesh, halo);
    } else {
      const halo = this.halos.get(mesh);
      if (!halo) return; // nothing to remove

      this.scene.remove(halo);
      this.halos.delete(mesh);
    }
  }

  /**
   * Animate a breathing pulse on all halo glows and keep them
   * positioned under their parent checkers.
   * Call once per frame from the render system.
   */
  public updateGlowPulse(dt: number): void {
    if (this.halos.size === 0) return;

    this.glowTime += dt;
    const t = Math.sin(this.glowTime * HALO_PULSE_SPEED);

    // Shared material opacity pulse (both teams share the same rhythm)
    const opacity = HALO_BASE_OPACITY + t * HALO_PULSE_AMPLITUDE;
    this.haloMatWhite.uniforms['uOpacity'].value = opacity;
    this.haloMatBlack.uniforms['uOpacity'].value = opacity;

    // Subtle scale pulse and position sync
    const scale = 1.0 + t * 0.05;
    for (const [checkerObj, halo] of this.halos) {
      halo.position.x = checkerObj.position.x;
      halo.position.z = checkerObj.position.z;
      halo.scale.set(scale, scale, 1);
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

    // Halo cleanup
    for (const [, halo] of this.halos) {
      this.scene.remove(halo);
    }
    this.halos.clear();
    this.haloGeo.dispose();
    this.haloMatWhite.dispose();
    this.haloMatBlack.dispose();

    this.particleGeo.dispose();
    this.particleMat.dispose();
  }
}


