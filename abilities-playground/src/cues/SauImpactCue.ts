import * as THREE from 'three';
import { FPVector3 } from '@phalanx-engine/math';
import type { EntityManager } from '@phalanx-engine/ecs';
import { Cue } from '@phalanx-engine/abilities';
import type {
  CueContext,
  GameplayCueDispatchedEvent,
} from '@phalanx-engine/abilities';
import { ComponentType, TransformComponent } from '../components';
import { easeOutCubic, easeOutExpo } from './vfxHelpers';

const DURATION_SECONDS = 0.6;
const PARTICLE_COUNT = 120;
const DEBRIS_SPEED = 16;
/** Ground shockwave ring final radius (world units). */
const RING_MAX_RADIUS = 9;

/**
 * SAU primary-impact VFX: a bright ground flash, an expanding shockwave ring,
 * and an upward debris/smoke burst at the shell impact point. Render-only; the
 * damage is applied by {@link ArtilleryShellSystem}.
 *
 * The impact point is snapshotted in `onSpawn` from the shell's Transform: the
 * shell is returned to the pool on the detonation tick, so re-reading it later
 * would be unsafe.
 */
export class SauImpactCue extends Cue {
  private readonly scene: THREE.Scene;

  private debris: THREE.Points | null = null;
  private debrisGeometry: THREE.BufferGeometry | null = null;
  private debrisMaterial: THREE.PointsMaterial | null = null;
  private readonly velocities = new Float32Array(PARTICLE_COUNT * 3);

  private ring: THREE.Mesh | null = null;
  private ringMaterial: THREE.MeshBasicMaterial | null = null;

  private flash: THREE.Mesh | null = null;
  private flashMaterial: THREE.MeshBasicMaterial | null = null;

  private elapsed = 0;
  private done = false;

  public constructor(scene: THREE.Scene) {
    super();
    this.scene = scene;
  }

  public onSpawn(event: GameplayCueDispatchedEvent, context: CueContext): void {
    const point = tryGetSourcePoint(context.entityManager, event);
    if (!point) {
      this.done = true;
      return;
    }
    this.build(point);
  }

  public override update(deltaTimeSeconds: number): void {
    if (this.done) return;
    this.elapsed += deltaTimeSeconds;
    const t = this.elapsed / DURATION_SECONDS;
    if (t >= 1) {
      this.done = true;
      return;
    }

    if (this.debris && this.debrisMaterial && this.debrisGeometry) {
      const positions = this.debrisGeometry.getAttribute(
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
        this.velocities[ix + 1] -= 22 * deltaTimeSeconds;
      }
      positions.needsUpdate = true;
      this.debrisMaterial.opacity = 0.95 * (1 - easeOutCubic(t));
    }

    if (this.ring && this.ringMaterial) {
      const r = RING_MAX_RADIUS * easeOutExpo(t);
      this.ring.scale.setScalar(Math.max(0.001, r));
      this.ringMaterial.opacity = 0.7 * (1 - t);
    }

    if (this.flash && this.flashMaterial) {
      const flashT = Math.min(1, this.elapsed / 0.1);
      this.flash.scale.setScalar(1 + flashT * 3);
      this.flashMaterial.opacity = 0.95 * (1 - flashT);
      if (flashT >= 1) this.flash.visible = false;
    }
  }

  public override isFinished(): boolean {
    return this.done;
  }

  public override dispose(): void {
    if (this.debris) this.scene.remove(this.debris);
    if (this.ring) this.scene.remove(this.ring);
    if (this.flash) this.scene.remove(this.flash);
    this.debrisGeometry?.dispose();
    this.debrisMaterial?.dispose();
    this.ring?.geometry.dispose();
    this.ringMaterial?.dispose();
    this.flash?.geometry.dispose();
    this.flashMaterial?.dispose();
    this.debris = null;
    this.debrisGeometry = null;
    this.debrisMaterial = null;
    this.ring = null;
    this.ringMaterial = null;
    this.flash = null;
    this.flashMaterial = null;
  }

  private build(point: THREE.Vector3): void {
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
      positions[i * 3] = (x / len) * 0.2;
      positions[i * 3 + 1] = Math.abs(y / len) * 0.2;
      positions[i * 3 + 2] = (z / len) * 0.2;
      const speed = DEBRIS_SPEED * (0.4 + Math.random() * 0.9);
      this.velocities[i * 3] = (x / len) * speed;
      this.velocities[i * 3 + 1] = Math.abs(y / len) * speed + 6;
      this.velocities[i * 3 + 2] = (z / len) * speed;
    }
    this.debrisGeometry = new THREE.BufferGeometry();
    this.debrisGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3)
    );
    this.debrisMaterial = new THREE.PointsMaterial({
      color: new THREE.Color(0xff8833),
      size: 0.9,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.debris = new THREE.Points(this.debrisGeometry, this.debrisMaterial);
    this.debris.position.copy(point);
    this.debris.frustumCulled = false;
    this.debris.renderOrder = 10_000;
    this.scene.add(this.debris);

    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc060,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 40),
      this.ringMaterial
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(point.x, point.y + 0.1, point.z);
    this.ring.renderOrder = 9_999;
    this.scene.add(this.ring);

    this.flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff0c0,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 10),
      this.flashMaterial
    );
    this.flash.position.set(point.x, point.y + 0.5, point.z);
    this.flash.renderOrder = 10_001;
    this.scene.add(this.flash);
  }
}

/** Read the source entity's Transform world position, or null if unavailable. */
export function tryGetSourcePoint(
  entityManager: EntityManager,
  event: GameplayCueDispatchedEvent
): THREE.Vector3 | null {
  const source = entityManager.getEntity(event.sourceEntityId);
  const transform = source?.getComponent<TransformComponent>(
    ComponentType.Transform
  );
  if (!transform) return null;
  const p = FPVector3.ToFloat(transform.fpPosition);
  return new THREE.Vector3(p.x, p.y, p.z);
}
