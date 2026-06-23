import * as THREE from 'three';
import { FPVector3 } from '@phalanx-engine/math';
import type { EntityManager } from '@phalanx-engine/ecs';
import { Cue } from '@phalanx-engine/abilities';
import type { CueContext, GameplayCueDispatchedEvent } from '@phalanx-engine/abilities';
import { ComponentType, TransformComponent } from '../components';
import { clamp01, easeOutExpo } from './vfxHelpers';

const DURATION_SECONDS = 0.65;
const START_SCALE = 0.35;
const END_SCALE = 3.2;

export class DeathCue extends Cue {
  private points: THREE.Points | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.PointsMaterial | null = null;
  private elapsed = 0;
  private done = false;
  private readonly scene: THREE.Scene;

  public constructor(scene: THREE.Scene) {
    super();
    this.scene = scene;
  }

  public onSpawn(event: GameplayCueDispatchedEvent, context: CueContext): void {
    const position = this.tryGetDeathPosition(context.entityManager, event);
    if (!position) {
      this.done = true;
      return;
    }
    this.spawnExplosion(position);
  }

  public override update(deltaTimeSeconds: number): void {
    if (this.done || !this.points || !this.material) {
      return;
    }
    this.elapsed += deltaTimeSeconds;
    const t = this.elapsed / DURATION_SECONDS;
    const k = easeOutExpo(t);
    this.points.scale.setScalar(START_SCALE + (END_SCALE - START_SCALE) * k);
    this.material.opacity = 1.0 * (1 - clamp01(t));
    if (t >= 1) {
      this.done = true;
    }
  }

  public override isFinished(): boolean {
    return this.done;
  }

  public override dispose(): void {
    if (this.points) {
      this.scene.remove(this.points);
    }
    this.geometry?.dispose();
    this.material?.dispose();
    this.points = null;
    this.geometry = null;
    this.material = null;
  }

  private spawnExplosion(position: THREE.Vector3): void {
    const particleCount = 240;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      let x = 0, y = 0, z = 0;
      do {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        z = Math.random() * 2 - 1;
      } while (x * x + y * y + z * z > 1);
      positions[i * 3] = x;
      positions[i * 3 + 1] = y * 0.8;
      positions[i * 3 + 2] = z;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.material = new THREE.PointsMaterial({
      color: new THREE.Color('#ffb02e'),
      size: 1.45,
      sizeAttenuation: true,
      transparent: true,
      opacity: 1.0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.position.copy(position);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10_000;
    this.points.scale.setScalar(START_SCALE);
    this.scene.add(this.points);
  }

  private tryGetDeathPosition(
    entityManager: EntityManager,
    event: GameplayCueDispatchedEvent,
  ): THREE.Vector3 | null {
    const entity = entityManager.getEntity(event.targetEntityId);
    if (!entity) return null;
    const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
    if (!transform) return null;
    const p = FPVector3.ToFloat(transform.fpPosition);
    return new THREE.Vector3(p.x, p.y, p.z);
  }
}
