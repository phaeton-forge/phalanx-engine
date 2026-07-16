import * as THREE from 'three';
import { Cue } from '@phalanx-engine/abilities';
import type {
  CueContext,
  GameplayCueDispatchedEvent,
} from '@phalanx-engine/abilities';
import { easeOutCubic } from './vfxHelpers';
import { tryGetSourcePoint } from './SauImpactCue';

const DURATION_SECONDS = 0.35;
const PARTICLE_COUNT = 36;
const SPARK_SPEED = 9;

/**
 * SAU secondary-impact VFX: a compact spark burst where a shrapnel fragment
 * lands. Render-only; damage is applied by {@link ShrapnelLandingSystem}. The
 * landing point is snapshotted in `onSpawn` from the fragment's Transform (the
 * fragment is pooled immediately after landing).
 */
export class SauSecondaryImpactCue extends Cue {
  private readonly scene: THREE.Scene;
  private points: THREE.Points | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.PointsMaterial | null = null;
  private readonly velocities = new Float32Array(PARTICLE_COUNT * 3);
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
    if (this.done || !this.points || !this.material || !this.geometry) return;
    this.elapsed += deltaTimeSeconds;
    const t = this.elapsed / DURATION_SECONDS;
    if (t >= 1) {
      this.done = true;
      return;
    }
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
      this.velocities[ix + 1] -= 14 * deltaTimeSeconds;
    }
    positions.needsUpdate = true;
    this.material.opacity = 0.9 * (1 - easeOutCubic(t));
    this.material.size = 0.5 * (1 - t * 0.5);
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
      positions[i * 3] = (x / len) * 0.1;
      positions[i * 3 + 1] = Math.abs(y / len) * 0.1;
      positions[i * 3 + 2] = (z / len) * 0.1;
      const speed = SPARK_SPEED * (0.5 + Math.random() * 0.8);
      this.velocities[i * 3] = (x / len) * speed;
      this.velocities[i * 3 + 1] = Math.abs(y / len) * speed + 3;
      this.velocities[i * 3 + 2] = (z / len) * speed;
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3)
    );
    this.material = new THREE.PointsMaterial({
      color: new THREE.Color(0xffd24d),
      size: 0.5,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.position.copy(point);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10_000;
    this.scene.add(this.points);
  }
}
