import * as THREE from 'three';
import {
  Cue,
  type CueContext,
  type GameplayCueDispatchedEvent,
} from '@phalanx-engine/abilities';
import type { Entity } from '@phalanx-engine/ecs';
import { FPVector3 } from '@phalanx-engine/math';
import type { TransformComponent } from '@phalanx-engine/physics';
import { ComponentType, MeshComponent } from '../components';
import { clamp01, getSoftCircleTexture } from './vfxHelpers';

const PARTICLE_CAPACITY = 128;
const EMIT_PER_SECOND = 52;
const PARTICLES_PER_EMIT = 2;
const LIFE_MIN = 1.5;
const LIFE_MAX = 2.5;
const SIZE_START = 0.9;
const SIZE_END = 2.4;
const ALPHA_START = 0.6;
const BASE_CORE_OPACITY = 0.95;
const BASE_OUTER_OPACITY = 0.55;
const BASE_CORE_EMISSIVE = 3.2;
const BASE_OUTER_EMISSIVE = 2.0;

const COLOR_WARM = new THREE.Color('#c4a882');
const COLOR_COOL = new THREE.Color('#6e6e72');

// Smooth per-particle wander so trails curl instead of tracking straight lines.
const TURB_STRENGTH = 1.2;
const TURB_FREQ = 2.3;

const LOCAL_EXHAUST = new THREE.Vector3(0, 0, -1);

/**
 * Matches THREE.PointsMaterial's size attenuation: gl_PointSize is
 * `size * (0.5 * drawingBufferHeight) / -viewZ`. A hardcoded scale renders
 * sub-pixel (invisible) sprites at gameplay camera distance.
 */
function viewportPointScale(): number {
  return 0.5 * window.innerHeight * (window.devicePixelRatio || 1);
}

type ExhaustUserData = {
  flameCore?: THREE.Mesh;
  flameOuter?: THREE.Mesh;
};

type MaybeActive = { active?: boolean };

const VERTEX_SHADER = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;

uniform float uScale;

varying float vAlpha;
varying vec3 vColor;

void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (uScale / max(0.15, -mvPosition.z));
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uMap;

varying float vAlpha;
varying vec3 vColor;

void main() {
  float mask = texture2D(uMap, gl_PointCoord).a;
  float alpha = mask * vAlpha;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(vColor, alpha);
}
`;

export class MissileExhaustCue extends Cue {
  private readonly scene: THREE.Scene;
  private context: CueContext | null = null;
  private missileEntityId = -1;
  private emitting = true;
  private done = false;
  private emitAccumulator = 0;
  private elapsed = 0;

  private points: THREE.Points | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private positions: Float32Array | null = null;
  private velocities: Float32Array | null = null;
  private ages: Float32Array | null = null;
  private lifetimes: Float32Array | null = null;
  private seeds: Float32Array | null = null;
  private sizes: Float32Array | null = null;
  private alphas: Float32Array | null = null;
  private colors: Float32Array | null = null;
  private aliveCount = 0;

  private flameCore: THREE.Mesh | null = null;
  private flameOuter: THREE.Mesh | null = null;
  private readonly nozzleWorld = new THREE.Vector3();
  private readonly exhaustDir = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();

  public constructor(scene: THREE.Scene) {
    super();
    this.scene = scene;
  }

  public onSpawn(event: GameplayCueDispatchedEvent, context: CueContext): void {
    this.context = context;
    this.missileEntityId = event.sourceEntityId;

    const entity = context.entityManager.getEntity(this.missileEntityId);
    if (!entity) {
      this.done = true;
      return;
    }

    const mesh = entity.getComponent<MeshComponent>(ComponentType.Mesh);
    if (!mesh) {
      this.done = true;
      return;
    }

    const data = mesh.root.userData as ExhaustUserData;
    this.flameCore = data.flameCore ?? null;
    this.flameOuter = data.flameOuter ?? null;

    this.positions = new Float32Array(PARTICLE_CAPACITY * 3);
    this.velocities = new Float32Array(PARTICLE_CAPACITY * 3);
    this.ages = new Float32Array(PARTICLE_CAPACITY);
    this.lifetimes = new Float32Array(PARTICLE_CAPACITY);
    this.seeds = new Float32Array(PARTICLE_CAPACITY);
    this.sizes = new Float32Array(PARTICLE_CAPACITY);
    this.alphas = new Float32Array(PARTICLE_CAPACITY);
    this.colors = new Float32Array(PARTICLE_CAPACITY * 3);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3),
    );
    this.geometry.setAttribute(
      'aSize',
      new THREE.BufferAttribute(this.sizes, 1),
    );
    this.geometry.setAttribute(
      'aAlpha',
      new THREE.BufferAttribute(this.alphas, 1),
    );
    this.geometry.setAttribute(
      'aColor',
      new THREE.BufferAttribute(this.colors, 3),
    );
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: getSoftCircleTexture() },
        uScale: { value: viewportPointScale() },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8500;
    this.scene.add(this.points);
  }

  public override update(deltaTimeSeconds: number): void {
    if (this.done || !this.context) return;

    this.elapsed += deltaTimeSeconds;
    if (this.material) {
      this.material.uniforms.uScale!.value = viewportPointScale();
    }
    const entity = this.context.entityManager.getEntity(this.missileEntityId);

    if (!entity || (entity as MaybeActive).active === false) {
      this.emitting = false;
      this.restoreNozzleDefaults();
    } else if (this.emitting) {
      if (!this.resolveNozzle(entity)) {
        this.emitting = false;
      } else {
        this.flickerNozzle();
        this.emitAccumulator += EMIT_PER_SECOND * deltaTimeSeconds;
        while (this.emitAccumulator >= 1) {
          this.emitAccumulator -= 1;
          for (let n = 0; n < PARTICLES_PER_EMIT; n++) {
            this.spawnParticle(entity);
          }
        }
      }
    }

    this.ageParticles(deltaTimeSeconds);

    if (!this.emitting && this.aliveCount === 0) {
      this.done = true;
    }
  }

  public override isFinished(): boolean {
    return this.done;
  }

  public override dispose(): void {
    if (this.points) this.scene.remove(this.points);
    this.geometry?.dispose();
    this.material?.dispose();
    this.points = null;
    this.geometry = null;
    this.material = null;
    this.positions = null;
    this.velocities = null;
    this.ages = null;
    this.lifetimes = null;
    this.seeds = null;
    this.sizes = null;
    this.alphas = null;
    this.colors = null;
    this.flameCore = null;
    this.flameOuter = null;
  }

  private resolveNozzle(entity: Entity): boolean {
    const mesh = entity.getComponent<MeshComponent>(ComponentType.Mesh);
    if (mesh) {
      const core =
        (mesh.root.userData as ExhaustUserData).flameCore ?? this.flameCore;
      if (core) {
        core.getWorldPosition(this.nozzleWorld);
        return true;
      }
      this.nozzleWorld.copy(mesh.root.position);
      return true;
    }

    const transform = entity.getComponent<TransformComponent>(
      ComponentType.Transform,
    );
    if (!transform) return false;
    const p = FPVector3.ToFloat(transform.fpPosition);
    this.nozzleWorld.set(p.x, p.y, p.z);
    return true;
  }

  private updateExhaustDir(entity: Entity): void {
    const mesh = entity.getComponent<MeshComponent>(ComponentType.Mesh);
    if (mesh) {
      this.exhaustDir
        .copy(LOCAL_EXHAUST)
        .applyQuaternion(mesh.root.quaternion)
        .normalize();
      return;
    }
    this.exhaustDir.set(0, 0.2, -1).normalize();
  }

  private spawnParticle(entity: Entity): void {
    if (
      !this.positions ||
      !this.velocities ||
      !this.ages ||
      !this.lifetimes ||
      !this.seeds ||
      !this.sizes ||
      !this.alphas ||
      !this.colors
    ) {
      return;
    }
    if (this.aliveCount >= PARTICLE_CAPACITY) return;

    this.updateExhaustDir(entity);

    const i = this.aliveCount++;
    const o = i * 3;
    const jitter = 0.18;
    this.positions[o] = this.nozzleWorld.x + (Math.random() - 0.5) * jitter;
    this.positions[o + 1] =
      this.nozzleWorld.y + (Math.random() - 0.5) * jitter;
    this.positions[o + 2] =
      this.nozzleWorld.z + (Math.random() - 0.5) * jitter;

    const backSpeed = 1.4 + Math.random() * 1.8;
    const spread = 0.55;
    this.velocities[o] =
      this.exhaustDir.x * backSpeed + (Math.random() - 0.5) * spread;
    this.velocities[o + 1] =
      this.exhaustDir.y * backSpeed +
      0.15 +
      Math.random() * 0.35 +
      (Math.random() - 0.5) * spread * 0.5;
    this.velocities[o + 2] =
      this.exhaustDir.z * backSpeed + (Math.random() - 0.5) * spread;

    this.ages[i] = 0;
    this.lifetimes[i] = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
    this.seeds[i] = Math.random() * Math.PI * 2;
    this.writeVisuals(i, 0);
    this.syncDrawRange();
  }

  private writeVisuals(index: number, ageRatio: number): void {
    if (!this.sizes || !this.alphas || !this.colors) return;

    const t = clamp01(ageRatio);
    // Ease out: grow and fade as smoke ages
    const fade = 1 - t * t;
    this.sizes[index] = SIZE_START + (SIZE_END - SIZE_START) * t;
    this.alphas[index] = ALPHA_START * fade;

    this.tmpColor.copy(COLOR_WARM).lerp(COLOR_COOL, t);
    const co = index * 3;
    this.colors[co] = this.tmpColor.r;
    this.colors[co + 1] = this.tmpColor.g;
    this.colors[co + 2] = this.tmpColor.b;
  }

  private ageParticles(dt: number): void {
    if (
      !this.positions ||
      !this.velocities ||
      !this.ages ||
      !this.lifetimes ||
      !this.seeds ||
      !this.sizes ||
      !this.alphas ||
      !this.colors ||
      !this.geometry
    ) {
      return;
    }

    const damp = Math.exp(-1.4 * dt);
    let write = 0;
    for (let read = 0; read < this.aliveCount; read++) {
      const life = this.lifetimes[read]!;
      const age = this.ages[read]! + dt;
      if (age >= life) continue;

      const ro = read * 3;
      const wo = write * 3;
      this.velocities[ro] *= damp;
      this.velocities[ro + 1] *= damp;
      this.velocities[ro + 2] *= damp;

      // Smooth curl: gentle wander that grows as the puff slows, bending paths.
      const seed = this.seeds[read]!;
      const swirl = TURB_STRENGTH * age;
      this.velocities[ro] +=
        Math.sin(age * TURB_FREQ + seed) * swirl * dt;
      this.velocities[ro + 1] +=
        Math.sin(age * TURB_FREQ * 0.8 + seed * 1.7) * swirl * 0.6 * dt;
      this.velocities[ro + 2] +=
        Math.cos(age * TURB_FREQ * 1.3 + seed * 2.3) * swirl * dt;

      this.positions[wo] = this.positions[ro]! + this.velocities[ro]! * dt;
      this.positions[wo + 1] =
        this.positions[ro + 1]! + this.velocities[ro + 1]! * dt;
      this.positions[wo + 2] =
        this.positions[ro + 2]! + this.velocities[ro + 2]! * dt;
      this.velocities[wo] = this.velocities[ro]!;
      this.velocities[wo + 1] = this.velocities[ro + 1]!;
      this.velocities[wo + 2] = this.velocities[ro + 2]!;
      this.ages[write] = age;
      this.lifetimes[write] = life;
      this.seeds[write] = seed;
      this.writeVisuals(write, age / life);
      write++;
    }
    this.aliveCount = write;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
    this.syncDrawRange();
  }

  private syncDrawRange(): void {
    this.geometry?.setDrawRange(0, this.aliveCount);
  }

  private flickerNozzle(): void {
    const pulse = 0.85 + 0.15 * Math.sin(this.elapsed * 18 + Math.random());
    const coreMat = this.flameCore?.material as
      | THREE.MeshStandardMaterial
      | undefined;
    const outerMat = this.flameOuter?.material as
      | THREE.MeshStandardMaterial
      | undefined;
    if (coreMat) {
      coreMat.opacity = BASE_CORE_OPACITY * pulse;
      coreMat.emissiveIntensity = BASE_CORE_EMISSIVE * pulse;
    }
    if (outerMat) {
      outerMat.opacity = BASE_OUTER_OPACITY * (0.9 + 0.1 * pulse);
      outerMat.emissiveIntensity = BASE_OUTER_EMISSIVE * (0.9 + 0.1 * pulse);
    }
  }

  private restoreNozzleDefaults(): void {
    const coreMat = this.flameCore?.material as
      | THREE.MeshStandardMaterial
      | undefined;
    const outerMat = this.flameOuter?.material as
      | THREE.MeshStandardMaterial
      | undefined;
    if (coreMat) {
      coreMat.opacity = BASE_CORE_OPACITY;
      coreMat.emissiveIntensity = BASE_CORE_EMISSIVE;
    }
    if (outerMat) {
      outerMat.opacity = BASE_OUTER_OPACITY;
      outerMat.emissiveIntensity = BASE_OUTER_EMISSIVE;
    }
  }
}
