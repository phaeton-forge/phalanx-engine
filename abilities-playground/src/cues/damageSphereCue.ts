import * as THREE from 'three';
import { FPVector3, FP } from '@phalanx-engine/math';
import { PhysicsSoASchema } from '@phalanx-engine/physics';
import type { EntityManager } from '@phalanx-engine/ecs';
import { Cue } from '@phalanx-engine/abilities';
import type { CueContext, GameplayCueDispatchedEvent } from '@phalanx-engine/abilities';
import { ComponentType, TransformComponent } from '../components';
import { easeOutCubic } from './vfxHelpers';

const DURATION_SECONDS = 0.35;
const START_SCALE = 0.25;
const END_SCALE = 1.6;

export class DamageSphereCue extends Cue {
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
    const impact = this.tryGetImpactPoint(context.entityManager, event);
    if (!impact) {
      this.done = true;
      return;
    }
    this.spawnBurst(impact);
  }

  public override update(deltaTimeSeconds: number): void {
    if (this.done || !this.points || !this.material) {
      return;
    }
    this.elapsed += deltaTimeSeconds;
    const t = this.elapsed / DURATION_SECONDS;
    const k = easeOutCubic(t);
    this.points.scale.setScalar(START_SCALE + (END_SCALE - START_SCALE) * k);
    this.material.opacity = 0.95 * (1 - k);
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

  private spawnBurst(position: THREE.Vector3): void {
    const particleCount = 90;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      let x = 0, y = 0, z = 0;
      do {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        z = Math.random() * 2 - 1;
      } while (x * x + y * y + z * z > 1);
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.material = new THREE.PointsMaterial({
      color: new THREE.Color('#ff5a3d'),
      size: 0.85,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
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

  private tryGetImpactPoint(
    entityManager: EntityManager,
    event: GameplayCueDispatchedEvent,
  ): THREE.Vector3 | null {
    const source = entityManager.getEntity(event.sourceEntityId);
    const target = entityManager.getEntity(event.targetEntityId);
    if (!source || !target) return null;

    const sourceTransform = source.getComponent<TransformComponent>(ComponentType.Transform);
    const targetTransform = target.getComponent<TransformComponent>(ComponentType.Transform);
    if (!sourceTransform || !targetTransform) return null;

    const src = FPVector3.ToFloat(sourceTransform.fpPosition);
    const tgt = FPVector3.ToFloat(targetTransform.fpPosition);

    const physStore = entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    const physIdx = physStore.indexOf(target.id);
    const targetRadius =
      physIdx === -1 ? 1 : FP.ToFloat(FP.FromRaw(physStore.arrays.radius[physIdx]));

    const normal = new THREE.Vector3(src.x - tgt.x, src.y - tgt.y, src.z - tgt.z);
    const lenSq = normal.lengthSq();
    if (lenSq < 1e-8) return new THREE.Vector3(tgt.x, tgt.y, tgt.z);
    normal.multiplyScalar(1 / Math.sqrt(lenSq));

    return new THREE.Vector3(tgt.x, tgt.y, tgt.z).addScaledVector(normal, targetRadius * 1.05 + 0.05);
  }
}
