import * as THREE from 'three';
import { FPQuaternion, FPVector3 } from '@phalanx-engine/math';
import { Cue } from '@phalanx-engine/abilities';
import type {
  CueContext,
  GameplayCueDispatchedEvent,
} from '@phalanx-engine/abilities';
import { ComponentType, TransformComponent } from '../components';

const LIFETIME_SECONDS = 0.18;
const SPARK_COUNT = 16;

/**
 * SAU muzzle-flash VFX: a bright additive flash plus a short directional flare
 * and spark spray at the artillery barrel tip. Like the machine-gun fire cue but
 * without tracers (the shell is a delayed-detonation logic entity that never
 * visibly flies). The muzzle world position/orientation is snapshotted in
 * `onSpawn` from the caster Transform, so the flash stays put even if the unit
 * rotates or dies afterward.
 *
 * The local muzzle offset is expressed in caster-mesh space and must track the
 * barrel tip built by `createSauBody`.
 */
const MUZZLE_LOCAL = { x: 0, y: 2.6, z: 7.8 };

export class SauMuzzleFlashCue extends Cue {
  private readonly scene: THREE.Scene;

  private group: THREE.Group | null = null;
  private core: THREE.Mesh | null = null;
  private halo: THREE.Mesh | null = null;
  private coreMaterial: THREE.MeshBasicMaterial | null = null;
  private haloMaterial: THREE.MeshBasicMaterial | null = null;

  private sparks: THREE.Points | null = null;
  private sparkGeometry: THREE.BufferGeometry | null = null;
  private sparkMaterial: THREE.PointsMaterial | null = null;
  private readonly sparkVelocities = new Float32Array(SPARK_COUNT * 3);

  private elapsed = 0;
  private done = false;

  public constructor(scene: THREE.Scene) {
    super();
    this.scene = scene;
  }

  public onSpawn(event: GameplayCueDispatchedEvent, context: CueContext): void {
    const caster = context.entityManager.getEntity(event.sourceEntityId);
    const transform = caster?.getComponent<TransformComponent>(
      ComponentType.Transform
    );
    if (!transform) {
      this.done = true;
      return;
    }

    const local = FPVector3.FromFloat(
      MUZZLE_LOCAL.x,
      MUZZLE_LOCAL.y,
      MUZZLE_LOCAL.z
    );
    const world = FPVector3.ToFloat(
      FPVector3.Add(
        transform.fpPosition,
        FPQuaternion.RotateVector(transform.fpRotation, local)
      )
    );
    const forward = FPVector3.ToFloat(
      FPQuaternion.RotateVector(
        transform.fpRotation,
        FPVector3.FromFloat(0, 0, 1)
      )
    );
    const dir = new THREE.Vector3(forward.x, 0, forward.z);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();

    this.build(new THREE.Vector3(world.x, world.y, world.z), dir);
  }

  public override update(deltaTimeSeconds: number): void {
    if (this.done || !this.group) return;
    this.elapsed += deltaTimeSeconds;
    const k = this.elapsed / LIFETIME_SECONDS;
    if (k >= 1) {
      this.done = true;
      return;
    }
    const fade = 1 - k;
    const scale = 0.7 + 1.6 * Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5);
    if (this.core && this.coreMaterial) {
      this.core.scale.setScalar(scale);
      this.coreMaterial.opacity = fade;
    }
    if (this.halo && this.haloMaterial) {
      this.halo.scale.setScalar(scale * 1.4);
      this.haloMaterial.opacity = 0.75 * fade;
    }
    if (this.sparks && this.sparkMaterial && this.sparkGeometry) {
      this.sparkMaterial.opacity = fade;
      const positions = this.sparkGeometry.getAttribute(
        'position'
      ) as THREE.BufferAttribute;
      for (let i = 0; i < SPARK_COUNT; i++) {
        const ix = i * 3;
        positions.setXYZ(
          i,
          positions.getX(i) + this.sparkVelocities[ix] * deltaTimeSeconds,
          positions.getY(i) + this.sparkVelocities[ix + 1] * deltaTimeSeconds,
          positions.getZ(i) + this.sparkVelocities[ix + 2] * deltaTimeSeconds
        );
      }
      positions.needsUpdate = true;
    }
  }

  public override isFinished(): boolean {
    return this.done;
  }

  public override dispose(): void {
    if (this.group) this.scene.remove(this.group);
    this.core?.geometry.dispose();
    this.halo?.geometry.dispose();
    this.coreMaterial?.dispose();
    this.haloMaterial?.dispose();
    this.sparkGeometry?.dispose();
    this.sparkMaterial?.dispose();
    this.group = null;
    this.core = null;
    this.halo = null;
    this.coreMaterial = null;
    this.haloMaterial = null;
    this.sparks = null;
    this.sparkGeometry = null;
    this.sparkMaterial = null;
  }

  private build(muzzle: THREE.Vector3, dir: THREE.Vector3): void {
    this.group = new THREE.Group();
    this.group.position.copy(muzzle);
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    this.group.renderOrder = 10_000;

    this.haloMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa44,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 10, 8),
      this.haloMaterial
    );
    this.group.add(this.halo);

    this.coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff6d0,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.core = new THREE.Mesh(
      new THREE.SphereGeometry(0.36, 10, 8),
      this.coreMaterial
    );
    this.group.add(this.core);

    this.sparkMaterial = new THREE.PointsMaterial({
      color: 0xffe8a0,
      size: 0.5,
      sizeAttenuation: true,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sparkGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(SPARK_COUNT * 3);
    for (let i = 0; i < SPARK_COUNT; i++) {
      const angle = (i / SPARK_COUNT) * Math.PI * 2;
      const spread = 0.35 + (i % 3) * 0.15;
      this.sparkVelocities[i * 3] = Math.cos(angle) * spread * 4;
      this.sparkVelocities[i * 3 + 1] = Math.sin(angle) * spread * 3;
      this.sparkVelocities[i * 3 + 2] = 7 + (i % 4) * 1.5;
    }
    this.sparkGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3)
    );
    this.sparks = new THREE.Points(this.sparkGeometry, this.sparkMaterial);
    this.sparks.frustumCulled = false;
    this.group.add(this.sparks);

    this.scene.add(this.group);
  }
}
