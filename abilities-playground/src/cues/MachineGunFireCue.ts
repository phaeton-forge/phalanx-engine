import * as THREE from 'three';
import type { Entity } from '@phalanx-engine/ecs';
import { FPQuaternion, FPVector3 } from '@phalanx-engine/math';
import { Cue } from '@phalanx-engine/abilities';
import type {
  CueContext,
  GameplayCueDispatchedEvent,
} from '@phalanx-engine/abilities';
import {
  ComponentType,
  MeshComponent,
  StatsComponent,
  TransformComponent,
} from '../components';
import { clamp01 } from './vfxHelpers';

const LIFETIME_SECONDS = 0.35;
/**
 * Fallback local tip used only if the glTF `MuzzleFlashPoint` empty is missing
 * from the model; approximates the barrel tip at (0, size*0.55, size*0.99).
 */
const PLASMA_TANK_VISUAL_SIZE = 2.8;
const MUZZLE_LOCAL_X = 0;
const MUZZLE_LOCAL_Y = PLASMA_TANK_VISUAL_SIZE * 0.55;
const MUZZLE_LOCAL_Z = PLASMA_TANK_VISUAL_SIZE * 0.99;
/** Approximate hit height on the target. */
const TARGET_HEIGHT = 1.0;
/** Number of tracer rounds visible along the line. */
const TRACER_COUNT = 4;
/** Tracer length as a fraction of the muzzle-to-target distance. */
const TRACER_LENGTH_FRACTION = 0.12;
/** How many times the tracers cycle from muzzle to target over the lifetime. */
const TRACER_CYCLES = 3;
/** Muzzle flash visible for this many seconds of the cue lifetime. */
const FLASH_DURATION_SECONDS = 0.12;
/** Spark particles around the muzzle during the flash. */
const MUZZLE_SPARK_COUNT = 14;
/**
 * Turret kick distance in parent (Base) space. Applied opposite the turret's
 * current traverse direction — see {@link MachineGunFireCue.updateRecoil}.
 */
const RECOIL_DISTANCE = 0.14;
/** Full kick-and-return duration; kept within the cue lifetime. */
const RECOIL_DURATION_SECONDS = 0.28;
/** Fraction of recoil duration spent on the initial kick (rest is the return). */
const RECOIL_KICK_FRACTION = 0.22;

const LOCAL_FORWARD = new THREE.Vector3(0, 0, 1);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Machine-gun fire VFX: tracer segments, a bright additive muzzle flash (core
 * glow + directional flare + spark spray), plus a short Turret recoil kick.
 * Render-only; damage comes from the ability's effects.
 */
export class MachineGunFireCue extends Cue {
  private readonly scene: THREE.Scene;

  private sourceEntityId = -1;
  private targetEntityId = -1;
  private context: CueContext | null = null;

  private tracers: THREE.LineSegments | null = null;
  private tracerGeometry: THREE.BufferGeometry | null = null;
  private tracerMaterial: THREE.LineBasicMaterial | null = null;

  private flashGroup: THREE.Group | null = null;
  private flashCore: THREE.Mesh | null = null;
  private flashHalo: THREE.Mesh | null = null;
  private flashFlare: THREE.Mesh | null = null;
  private flashCoreMaterial: THREE.MeshBasicMaterial | null = null;
  private flashHaloMaterial: THREE.MeshBasicMaterial | null = null;

  private sparks: THREE.Points | null = null;
  private sparkGeometry: THREE.BufferGeometry | null = null;
  private sparkMaterial: THREE.PointsMaterial | null = null;
  private readonly sparkVelocities = new Float32Array(MUZZLE_SPARK_COUNT * 3);

  private turret: THREE.Object3D | null = null;
  private readonly turretRestLocal = new THREE.Vector3();
  private turretRestYaw = 0;

  private readonly muzzle = new THREE.Vector3();
  private readonly targetPoint = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly tail = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly lookAt = new THREE.Quaternion();

  private elapsed = 0;
  private done = false;

  public constructor(scene: THREE.Scene) {
    super();
    this.scene = scene;
  }

  public onSpawn(event: GameplayCueDispatchedEvent, context: CueContext): void {
    this.context = context;
    this.sourceEntityId = event.sourceEntityId;
    this.targetEntityId = event.targetEntityId;

    this.tracerMaterial = new THREE.LineBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.tracerGeometry = new THREE.BufferGeometry();
    this.tracerGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(TRACER_COUNT * 2 * 3), 3)
    );
    this.tracers = new THREE.LineSegments(
      this.tracerGeometry,
      this.tracerMaterial
    );
    this.tracers.frustumCulled = false;
    this.tracers.renderOrder = 9500;
    this.scene.add(this.tracers);

    this.flashGroup = new THREE.Group();
    this.flashGroup.renderOrder = 10_000;
    this.scene.add(this.flashGroup);

    this.flashHaloMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa44,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.flashHalo = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 10, 8),
      this.flashHaloMaterial
    );
    this.flashGroup.add(this.flashHalo);

    this.flashCoreMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff6d0,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.flashCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 10, 8),
      this.flashCoreMaterial
    );
    this.flashGroup.add(this.flashCore);

    // Short directional flare that points along the barrel/shot axis.
    this.flashFlare = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.9, 8, 1, true),
      this.flashHaloMaterial
    );
    this.flashFlare.rotation.x = Math.PI / 2;
    this.flashFlare.position.z = 0.35;
    this.flashGroup.add(this.flashFlare);

    this.sparkMaterial = new THREE.PointsMaterial({
      color: 0xffe8a0,
      size: 0.45,
      sizeAttenuation: true,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sparkGeometry = new THREE.BufferGeometry();
    const sparkPositions = new Float32Array(MUZZLE_SPARK_COUNT * 3);
    for (let i = 0; i < MUZZLE_SPARK_COUNT; i++) {
      const angle = (i / MUZZLE_SPARK_COUNT) * Math.PI * 2;
      const spread = 0.35 + (i % 3) * 0.15;
      // Prefer outward spray around +Z (shot direction in local flash space).
      this.sparkVelocities[i * 3] = Math.cos(angle) * spread * 4;
      this.sparkVelocities[i * 3 + 1] = Math.sin(angle) * spread * 3;
      this.sparkVelocities[i * 3 + 2] = 6 + (i % 4) * 1.5;
      sparkPositions[i * 3] = 0;
      sparkPositions[i * 3 + 1] = 0;
      sparkPositions[i * 3 + 2] = 0;
    }
    this.sparkGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(sparkPositions, 3)
    );
    this.sparks = new THREE.Points(this.sparkGeometry, this.sparkMaterial);
    this.sparks.frustumCulled = false;
    this.flashGroup.add(this.sparks);

    this.flashGroup.visible = false;

    this.bindTurret(context, event.sourceEntityId);
  }

  public override update(deltaTimeSeconds: number): void {
    if (this.done || !this.context) return;
    this.elapsed += deltaTimeSeconds;
    if (this.elapsed >= LIFETIME_SECONDS) {
      this.resetTurret();
      this.done = true;
      return;
    }

    const source = this.context.entityManager.getEntity(this.sourceEntityId);
    const target = this.context.entityManager.getEntity(this.targetEntityId);
    if (!source || !target) {
      this.resetTurret();
      this.done = true;
      return;
    }
    const sourceStats = source.getComponent<StatsComponent>(
      ComponentType.UnitStats
    );
    const targetStats = target.getComponent<StatsComponent>(
      ComponentType.UnitStats
    );
    if (!sourceStats?.alive || !targetStats?.alive) {
      this.resetTurret();
      this.done = true;
      return;
    }

    if (
      !this.computeMuzzle(source, target) ||
      !this.tracers ||
      !this.tracerMaterial
    ) {
      this.resetTurret();
      this.done = true;
      return;
    }

    this.updateTracers();
    this.updateFlash(deltaTimeSeconds);
    this.updateRecoil();
  }

  public override isFinished(): boolean {
    return this.done;
  }

  public override dispose(): void {
    this.resetTurret();
    if (this.tracers) this.scene.remove(this.tracers);
    if (this.flashGroup) this.scene.remove(this.flashGroup);
    this.tracerGeometry?.dispose();
    this.tracerMaterial?.dispose();
    this.flashCore?.geometry.dispose();
    this.flashHalo?.geometry.dispose();
    this.flashFlare?.geometry.dispose();
    this.flashCoreMaterial?.dispose();
    // Halo material is shared with the flare mesh; dispose once.
    this.flashHaloMaterial?.dispose();
    this.sparkGeometry?.dispose();
    this.sparkMaterial?.dispose();
    this.tracers = null;
    this.tracerGeometry = null;
    this.tracerMaterial = null;
    this.flashGroup = null;
    this.flashCore = null;
    this.flashHalo = null;
    this.flashFlare = null;
    this.flashCoreMaterial = null;
    this.flashHaloMaterial = null;
    this.sparks = null;
    this.sparkGeometry = null;
    this.sparkMaterial = null;
    this.turret = null;
  }

  /** Populate `muzzle` and `targetPoint`; returns false if a transform is missing. */
  private computeMuzzle(source: Entity, target: Entity): boolean {
    const sourceTransform = source.getComponent<TransformComponent>(
      ComponentType.Transform
    );
    const targetTransform = target.getComponent<TransformComponent>(
      ComponentType.Transform
    );
    if (!sourceTransform || !targetTransform) return false;

    const mesh = source.getComponent<MeshComponent>(ComponentType.Mesh);
    const muzzlePoint = mesh?.root.userData.muzzleFlashPoint as
      THREE.Object3D | undefined;
    if (muzzlePoint) {
      muzzlePoint.updateWorldMatrix(true, false);
      muzzlePoint.getWorldPosition(this.muzzle);
    } else {
      const tipLocal = FPVector3.FromFloat(
        MUZZLE_LOCAL_X,
        MUZZLE_LOCAL_Y,
        MUZZLE_LOCAL_Z
      );
      const tipWorld = FPVector3.Add(
        sourceTransform.fpPosition,
        FPQuaternion.RotateVector(sourceTransform.fpRotation, tipLocal)
      );
      const tip = FPVector3.ToFloat(tipWorld);
      this.muzzle.set(tip.x, tip.y, tip.z);
    }

    const t = FPVector3.ToFloat(targetTransform.fpPosition);
    this.targetPoint.set(t.x, t.y + TARGET_HEIGHT, t.z);

    // Flash/flare and spark spray face along the barrel: the hull's forward
    // axis (+Z) swung by however far the turret is currently traversed.
    const barrelDir = FPQuaternion.RotateVector(
      sourceTransform.fpRotation,
      FPVector3.FromFloat(0, 0, 1)
    );
    const dir = FPVector3.ToFloat(barrelDir);
    this.forward.set(dir.x, 0, dir.z);
    if (this.forward.lengthSq() > 1e-6) {
      this.forward.normalize();
    } else {
      this.forward.set(0, 0, 1);
    }
    if (this.turret) {
      this.forward.applyAxisAngle(
        WORLD_UP,
        this.turret.rotation.y - this.turretRestYaw
      );
    }
    return true;
  }

  private updateTracers(): void {
    const positions = this.tracerGeometry!.getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    const p = this.elapsed / LIFETIME_SECONDS;
    for (let i = 0; i < TRACER_COUNT; i++) {
      const phase = (p * TRACER_CYCLES + i / TRACER_COUNT) % 1;
      const headT = clamp01(phase);
      const tailT = clamp01(phase - TRACER_LENGTH_FRACTION);
      this.head.lerpVectors(this.muzzle, this.targetPoint, headT);
      this.tail.lerpVectors(this.muzzle, this.targetPoint, tailT);
      positions.setXYZ(i * 2, this.tail.x, this.tail.y, this.tail.z);
      positions.setXYZ(i * 2 + 1, this.head.x, this.head.y, this.head.z);
    }
    positions.needsUpdate = true;
    this.tracerMaterial!.opacity = 0.9 * (1 - p);
  }

  private updateFlash(deltaTimeSeconds: number): void {
    if (
      !this.flashGroup ||
      !this.flashCore ||
      !this.flashHalo ||
      !this.flashCoreMaterial ||
      !this.flashHaloMaterial ||
      !this.sparks ||
      !this.sparkMaterial ||
      !this.sparkGeometry
    ) {
      return;
    }

    this.flashGroup.position.copy(this.muzzle);
    this.lookAt.setFromUnitVectors(LOCAL_FORWARD, this.forward);
    this.flashGroup.quaternion.copy(this.lookAt);

    if (this.elapsed >= FLASH_DURATION_SECONDS) {
      this.flashGroup.visible = false;
      return;
    }

    this.flashGroup.visible = true;
    const k = this.elapsed / FLASH_DURATION_SECONDS;
    const fade = 1 - k;
    // Pop: expand quickly then hold as opacity falls.
    const scale = 0.7 + 1.4 * Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5);
    this.flashCore.scale.setScalar(scale);
    this.flashHalo.scale.setScalar(scale * 1.35);
    this.flashCoreMaterial.opacity = fade;
    this.flashHaloMaterial.opacity = 0.75 * fade;
    this.sparkMaterial.opacity = fade;
    this.sparkMaterial.size = 0.55 * (1 - k * 0.5);

    const positions = this.sparkGeometry.getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    for (let i = 0; i < MUZZLE_SPARK_COUNT; i++) {
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

  /**
   * Resolve the glTF Turret on the source mesh and cache its authored rest
   * pose. Missing turret is fine — procedural fallbacks have no Turret node.
   */
  private bindTurret(context: CueContext, sourceEntityId: number): void {
    const source = context.entityManager.getEntity(sourceEntityId);
    const mesh = source?.getComponent<MeshComponent>(ComponentType.Mesh);
    const turret = mesh?.root.userData.turret as THREE.Object3D | undefined;
    if (!turret) return;

    const rest = turret.userData.restLocalPosition as THREE.Vector3 | undefined;
    this.turretRestLocal.copy(rest ?? turret.position);
    this.turretRestYaw =
      (turret.userData.restLocalYaw as number | undefined) ?? turret.rotation.y;
    this.turret = turret;
  }

  /**
   * Kick the Turret backward along its own barrel axis (opposite the traversed
   * aim direction), then ease it back to rest. Peak sits early so the kick
   * reads as a sharp punch. `Object3D.position` is parent-local, so the offset
   * is built from the turret's current traverse angle rather than assuming the
   * barrel still points along the hull's +Z.
   */
  private updateRecoil(): void {
    if (!this.turret) return;
    if (this.elapsed >= RECOIL_DURATION_SECONDS) {
      this.resetTurret();
      return;
    }

    const t = this.elapsed / RECOIL_DURATION_SECONDS;
    let amount: number;
    if (t <= RECOIL_KICK_FRACTION) {
      const u = t / RECOIL_KICK_FRACTION;
      amount = Math.sin(u * Math.PI * 0.5);
    } else {
      const u = (t - RECOIL_KICK_FRACTION) / (1 - RECOIL_KICK_FRACTION);
      amount = Math.cos(u * Math.PI * 0.5);
    }

    const traverse = this.turret.rotation.y - this.turretRestYaw;
    const kick = RECOIL_DISTANCE * amount;
    this.turret.position.set(
      this.turretRestLocal.x - Math.sin(traverse) * kick,
      this.turretRestLocal.y,
      this.turretRestLocal.z - Math.cos(traverse) * kick
    );
  }

  private resetTurret(): void {
    if (!this.turret) return;
    this.turret.position.copy(this.turretRestLocal);
  }
}
