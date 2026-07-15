import * as THREE from 'three';
import { FPVector3, FP } from '@phalanx-engine/math';
import { PhysicsSoASchema } from '@phalanx-engine/physics';
import type { EntityManager } from '@phalanx-engine/ecs';
import { Cue } from '@phalanx-engine/abilities';
import type {
  CueContext,
  GameplayCueDispatchedEvent,
} from '@phalanx-engine/abilities';
import { ComponentType, TransformComponent } from '../components';
import { easeOutCubic } from './vfxHelpers';

const DURATION_SECONDS = 0.3;
const PARTICLE_COUNT = 48;
const SPARK_SPEED = 8;

/** Bright spark burst at the machine-gun hit point on the target surface. */
export class MachineGunImpactCue extends Cue {
  private points: THREE.Points | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.PointsMaterial | null = null;
  private flash: THREE.Mesh | null = null;
  private flashMaterial: THREE.MeshBasicMaterial | null = null;
  private readonly velocities = new Float32Array(PARTICLE_COUNT * 3);
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
    if (this.done || !this.points || !this.material || !this.geometry) {
      return;
    }
    this.elapsed += deltaTimeSeconds;
    const t = this.elapsed / DURATION_SECONDS;
    const k = easeOutCubic(t);

    const positions = this.geometry.getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const ix = i * 3;
      positions.setXYZ(
        i,
        positions.getX(i) + this.velocities[ix] * deltaTimeSeconds,
        positions.getY(i) + this.velocities[ix + 1] * deltaTimeSeconds,
        positions.getZ(i) + this.velocities[ix + 2] * deltaTimeSeconds
      );
      // Mild gravity so sparks arc down.
      this.velocities[ix + 1] -= 12 * deltaTimeSeconds;
    }
    positions.needsUpdate = true;

    this.material.opacity = 0.95 * (1 - k);
    this.material.size = 0.75 * (1 - k * 0.55);

    if (this.flash && this.flashMaterial) {
      const flashT = Math.min(1, this.elapsed / 0.08);
      this.flash.scale.setScalar(0.4 + flashT * 1.2);
      this.flashMaterial.opacity = 0.9 * (1 - flashT);
      if (flashT >= 1) {
        this.flash.visible = false;
      }
    }

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
    if (this.flash) {
      this.scene.remove(this.flash);
      this.flash.geometry.dispose();
    }
    this.geometry?.dispose();
    this.material?.dispose();
    this.flashMaterial?.dispose();
    this.points = null;
    this.geometry = null;
    this.material = null;
    this.flash = null;
    this.flashMaterial = null;
  }

  private spawnBurst(position: THREE.Vector3): void {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      let x = 0;
      let y = 0;
      let z = 0;
      do {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        z = Math.random() * 2 - 1;
      } while (x * x + y * y + z * z > 1);
      const len = Math.sqrt(x * x + y * y + z * z) || 1;
      // Start near the impact surface; mostly fly out and slightly up.
      positions[i * 3] = (x / len) * 0.15;
      positions[i * 3 + 1] = (y / len) * 0.15;
      positions[i * 3 + 2] = (z / len) * 0.15;
      const speed = SPARK_SPEED * (0.55 + Math.random() * 0.7);
      this.velocities[i * 3] = (x / len) * speed;
      this.velocities[i * 3 + 1] = Math.abs(y / len) * speed + 2;
      this.velocities[i * 3 + 2] = (z / len) * speed;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3)
    );

    this.material = new THREE.PointsMaterial({
      color: new THREE.Color(0xffd24d),
      size: 0.75,
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
    this.scene.add(this.points);

    // Brief white-hot flash at the impact point.
    this.flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff2c0,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 10, 8),
      this.flashMaterial
    );
    this.flash.position.copy(position);
    this.flash.renderOrder = 10_001;
    this.flash.scale.setScalar(0.4);
    this.scene.add(this.flash);
  }

  private tryGetImpactPoint(
    entityManager: EntityManager,
    event: GameplayCueDispatchedEvent
  ): THREE.Vector3 | null {
    const source = entityManager.getEntity(event.sourceEntityId);
    if (!source) return null;

    const sourceTransform = source.getComponent<TransformComponent>(
      ComponentType.Transform
    );
    if (!sourceTransform) return null;

    const src = FPVector3.ToFloat(sourceTransform.fpPosition);
    const target = entityManager.getEntity(event.targetEntityId);
    const targetTransform = target?.getComponent<TransformComponent>(
      ComponentType.Transform
    );
    if (!target || !targetTransform) {
      return new THREE.Vector3(src.x, src.y, src.z);
    }

    const tgt = FPVector3.ToFloat(targetTransform.fpPosition);

    const physStore = entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    const physIdx = physStore.indexOf(target.id);
    const targetRadius =
      physIdx === -1
        ? 1
        : FP.ToFloat(FP.FromRaw(physStore.arrays.radius[physIdx]));

    const normal = new THREE.Vector3(
      src.x - tgt.x,
      src.y - tgt.y,
      src.z - tgt.z
    );
    const lenSq = normal.lengthSq();
    if (lenSq < 1e-8) return new THREE.Vector3(tgt.x, tgt.y + 1, tgt.z);
    normal.multiplyScalar(1 / Math.sqrt(lenSq));

    // Lift slightly so sparks sit on the unit body, not the ground plane.
    return new THREE.Vector3(tgt.x, tgt.y + 0.4, tgt.z).addScaledVector(
      normal,
      targetRadius * 1.05 + 0.05
    );
  }
}
