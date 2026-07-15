import * as THREE from 'three';
import type { Entity } from '@phalanx-engine/ecs';
import { FPVector3 } from '@phalanx-engine/math';
import { Cue } from '@phalanx-engine/abilities';
import type {
  CueContext,
  GameplayCueDispatchedEvent,
} from '@phalanx-engine/abilities';
import {
  ComponentType,
  StatsComponent,
  TransformComponent,
} from '../components';
import { clamp01 } from './vfxHelpers';

const LIFETIME_SECONDS = 0.35;
/** Local muzzle height above the drone origin (matches turret barrel in unitVisuals). */
const MUZZLE_HEIGHT = 1.2;
/** Forward offset of the muzzle toward the target, in world units. */
const MUZZLE_FORWARD = 2.0;
/** Approximate hit height on the target. */
const TARGET_HEIGHT = 1.0;
/** Number of tracer rounds visible along the line. */
const TRACER_COUNT = 4;
/** Tracer length as a fraction of the muzzle-to-target distance. */
const TRACER_LENGTH_FRACTION = 0.12;
/** How many times the tracers cycle from muzzle to target over the lifetime. */
const TRACER_CYCLES = 3;
/** Muzzle flash is visible/fading only during this fraction of the lifetime. */
const FLASH_FRACTION = 0.1 / LIFETIME_SECONDS;

/**
 * Machine-gun fire VFX: a short burst of bright tracer segments travelling from
 * the drone's muzzle toward its target, plus a brief muzzle flash. Render-only;
 * damage is applied by the ability's effect. Endpoints recompute each frame so
 * tracers track moving units.
 */
export class MachineGunFireCue extends Cue {
  private readonly scene: THREE.Scene;

  private sourceEntityId = -1;
  private targetEntityId = -1;
  private context: CueContext | null = null;

  private tracers: THREE.LineSegments | null = null;
  private tracerGeometry: THREE.BufferGeometry | null = null;
  private tracerMaterial: THREE.LineBasicMaterial | null = null;

  private flash: THREE.Points | null = null;
  private flashGeometry: THREE.BufferGeometry | null = null;
  private flashMaterial: THREE.PointsMaterial | null = null;

  private readonly muzzle = new THREE.Vector3();
  private readonly targetPoint = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly tail = new THREE.Vector3();

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

    this.flashMaterial = new THREE.PointsMaterial({
      color: 0xfff2c0,
      size: 1.6,
      sizeAttenuation: true,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.flashGeometry = new THREE.BufferGeometry();
    this.flashGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(3), 3)
    );
    this.flash = new THREE.Points(this.flashGeometry, this.flashMaterial);
    this.flash.frustumCulled = false;
    this.flash.renderOrder = 10_000;
    this.scene.add(this.flash);
  }

  public override update(deltaTimeSeconds: number): void {
    if (this.done || !this.context) return;
    this.elapsed += deltaTimeSeconds;
    if (this.elapsed >= LIFETIME_SECONDS) {
      this.done = true;
      return;
    }

    const source = this.context.entityManager.getEntity(this.sourceEntityId);
    const target = this.context.entityManager.getEntity(this.targetEntityId);
    if (!source || !target) {
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
      this.done = true;
      return;
    }

    if (
      !this.computeMuzzle(source, target) ||
      !this.tracers ||
      !this.tracerMaterial
    ) {
      this.done = true;
      return;
    }

    this.updateTracers();
    this.updateFlash();
  }

  public override isFinished(): boolean {
    return this.done;
  }

  public override dispose(): void {
    if (this.tracers) this.scene.remove(this.tracers);
    if (this.flash) this.scene.remove(this.flash);
    this.tracerGeometry?.dispose();
    this.tracerMaterial?.dispose();
    this.flashGeometry?.dispose();
    this.flashMaterial?.dispose();
    this.tracers = null;
    this.tracerGeometry = null;
    this.tracerMaterial = null;
    this.flash = null;
    this.flashGeometry = null;
    this.flashMaterial = null;
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

    const s = FPVector3.ToFloat(sourceTransform.fpPosition);
    const t = FPVector3.ToFloat(targetTransform.fpPosition);
    this.targetPoint.set(t.x, t.y + TARGET_HEIGHT, t.z);

    this.muzzle.set(s.x, s.y + MUZZLE_HEIGHT, s.z);
    const forward = this.head.set(t.x - s.x, 0, t.z - s.z);
    if (forward.lengthSq() > 1e-6) {
      forward.normalize().multiplyScalar(MUZZLE_FORWARD);
      this.muzzle.x += forward.x;
      this.muzzle.z += forward.z;
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

  private updateFlash(): void {
    if (!this.flash || !this.flashMaterial || !this.flashGeometry) return;
    const p = this.elapsed / LIFETIME_SECONDS;
    const positions = this.flashGeometry.getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    positions.setXYZ(0, this.muzzle.x, this.muzzle.y, this.muzzle.z);
    positions.needsUpdate = true;

    if (p >= FLASH_FRACTION) {
      this.flashMaterial.opacity = 0;
      return;
    }
    const k = p / FLASH_FRACTION;
    this.flashMaterial.opacity = 1 - k;
    this.flash.scale.setScalar(0.6 + 0.8 * k);
  }
}
