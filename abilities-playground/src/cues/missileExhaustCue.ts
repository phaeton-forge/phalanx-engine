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

const PARTICLE_CAPACITY = 96;
const EMIT_PER_SECOND = 28;
const LIFE_MIN = 1.5;
const LIFE_MAX = 2.5;
const SMOKE_SIZE = 0.55;
const BASE_CORE_OPACITY = 0.95;
const BASE_OUTER_OPACITY = 0.55;
const BASE_LIGHT_INTENSITY = 1.1;

type ExhaustUserData = {
  flameCore?: THREE.Mesh;
  flameOuter?: THREE.Mesh;
  engineLight?: THREE.PointLight;
};

type MaybeActive = { active?: boolean };

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
  private material: THREE.PointsMaterial | null = null;
  private positions: Float32Array | null = null;
  private velocities: Float32Array | null = null;
  private ages: Float32Array | null = null;
  private lifetimes: Float32Array | null = null;
  private aliveCount = 0;

  private flameCore: THREE.Mesh | null = null;
  private flameOuter: THREE.Mesh | null = null;
  private engineLight: THREE.PointLight | null = null;
  private readonly nozzleWorld = new THREE.Vector3();

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
    this.engineLight = data.engineLight ?? null;

    this.positions = new Float32Array(PARTICLE_CAPACITY * 3);
    this.velocities = new Float32Array(PARTICLE_CAPACITY * 3);
    this.ages = new Float32Array(PARTICLE_CAPACITY);
    this.lifetimes = new Float32Array(PARTICLE_CAPACITY);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3),
    );
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.PointsMaterial({
      color: new THREE.Color('#9a9a9a'),
      size: SMOKE_SIZE,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8500;
    this.scene.add(this.points);
  }

  public override update(deltaTimeSeconds: number): void {
    if (this.done || !this.context) return;

    this.elapsed += deltaTimeSeconds;
    const entity = this.context.entityManager.getEntity(this.missileEntityId);

    if (!entity || (entity as MaybeActive).active === false) {
      this.emitting = false;
      this.restoreNozzleDefaults(false);
    } else if (this.emitting) {
      if (!this.resolveNozzle(entity)) {
        this.emitting = false;
      } else {
        this.flickerNozzle();
        this.emitAccumulator += EMIT_PER_SECOND * deltaTimeSeconds;
        while (this.emitAccumulator >= 1) {
          this.emitAccumulator -= 1;
          this.spawnParticle();
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
    this.flameCore = null;
    this.flameOuter = null;
    this.engineLight = null;
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

  private spawnParticle(): void {
    if (
      !this.positions ||
      !this.velocities ||
      !this.ages ||
      !this.lifetimes
    ) {
      return;
    }
    if (this.aliveCount >= PARTICLE_CAPACITY) return;

    const i = this.aliveCount++;
    const o = i * 3;
    this.positions[o] = this.nozzleWorld.x + (Math.random() - 0.5) * 0.25;
    this.positions[o + 1] =
      this.nozzleWorld.y + (Math.random() - 0.5) * 0.25;
    this.positions[o + 2] = this.nozzleWorld.z + (Math.random() - 0.5) * 0.25;

    this.velocities[o] = (Math.random() - 0.5) * 0.35;
    this.velocities[o + 1] = 0.35 + Math.random() * 0.45;
    this.velocities[o + 2] = (Math.random() - 0.5) * 0.35;

    this.ages[i] = 0;
    this.lifetimes[i] = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
    this.syncDrawRange();
  }

  private ageParticles(dt: number): void {
    if (
      !this.positions ||
      !this.velocities ||
      !this.ages ||
      !this.lifetimes ||
      !this.geometry
    ) {
      return;
    }

    let write = 0;
    for (let read = 0; read < this.aliveCount; read++) {
      const life = this.lifetimes[read]!;
      const age = this.ages[read]! + dt;
      if (age >= life) continue;

      const ro = read * 3;
      const wo = write * 3;
      this.positions[wo] =
        this.positions[ro]! + this.velocities[ro]! * dt;
      this.positions[wo + 1] =
        this.positions[ro + 1]! + this.velocities[ro + 1]! * dt;
      this.positions[wo + 2] =
        this.positions[ro + 2]! + this.velocities[ro + 2]! * dt;
      this.velocities[wo] = this.velocities[ro]!;
      this.velocities[wo + 1] = this.velocities[ro + 1]!;
      this.velocities[wo + 2] = this.velocities[ro + 2]!;
      this.ages[write] = age;
      this.lifetimes[write] = life;
      write++;
    }
    this.aliveCount = write;
    this.geometry.attributes.position.needsUpdate = true;
    this.syncDrawRange();

    if (this.material) {
      this.material.opacity = this.emitting ? 0.45 : 0.35;
    }
  }

  private syncDrawRange(): void {
    this.geometry?.setDrawRange(0, this.aliveCount);
  }

  private flickerNozzle(): void {
    const pulse = 0.85 + 0.15 * Math.sin(this.elapsed * 18 + Math.random());
    const coreMat = this.flameCore?.material as
      | THREE.MeshBasicMaterial
      | undefined;
    const outerMat = this.flameOuter?.material as
      | THREE.MeshBasicMaterial
      | undefined;
    if (coreMat) coreMat.opacity = BASE_CORE_OPACITY * pulse;
    if (outerMat) {
      outerMat.opacity = BASE_OUTER_OPACITY * (0.9 + 0.1 * pulse);
    }
    if (this.engineLight) {
      this.engineLight.intensity = BASE_LIGHT_INTENSITY * pulse;
      this.engineLight.visible = true;
    }
  }

  private restoreNozzleDefaults(lightOn: boolean): void {
    const coreMat = this.flameCore?.material as
      | THREE.MeshBasicMaterial
      | undefined;
    const outerMat = this.flameOuter?.material as
      | THREE.MeshBasicMaterial
      | undefined;
    if (coreMat) coreMat.opacity = BASE_CORE_OPACITY;
    if (outerMat) outerMat.opacity = BASE_OUTER_OPACITY;
    if (this.engineLight) {
      this.engineLight.intensity = BASE_LIGHT_INTENSITY;
      this.engineLight.visible = lightOn;
    }
  }
}
