import * as THREE from 'three';
import { Cue } from '@phalanx-engine/abilities';
import type {
  CueContext,
  GameplayCueDispatchedEvent,
} from '@phalanx-engine/abilities';
import { clamp01 } from './vfxHelpers';
import { tryGetSourcePoint } from './SauImpactCue';

/**
 * Duration of the ground warning marker. Emitted a couple of ticks before
 * detonation, it should read as a brief "incoming" telegraph and then fade as
 * the shell lands.
 */
const DURATION_SECONDS = 0.5;
const MARKER_RADIUS = 4.5;

/**
 * SAU falling-shadow VFX: a pulsing red targeting reticle on the ground where
 * the shell is about to land — an incoming-fire telegraph. Render-only. The
 * impact point is snapshotted in `onSpawn` from the shell's Transform.
 */
export class SauFallingShadowCue extends Cue {
  private readonly scene: THREE.Scene;
  private group: THREE.Group | null = null;
  private ringMaterial: THREE.MeshBasicMaterial | null = null;
  private discMaterial: THREE.MeshBasicMaterial | null = null;
  private disc: THREE.Mesh | null = null;
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
    if (this.done || !this.group) return;
    this.elapsed += deltaTimeSeconds;
    const t = this.elapsed / DURATION_SECONDS;
    if (t >= 1) {
      this.done = true;
      return;
    }
    // Pulse the outline; shrink the inner disc as if the shell is closing in.
    const pulse = 0.6 + 0.4 * Math.sin(this.elapsed * 24);
    if (this.ringMaterial) this.ringMaterial.opacity = 0.85 * pulse;
    if (this.disc && this.discMaterial) {
      this.disc.scale.setScalar(clamp01(1 - t));
      this.discMaterial.opacity = 0.5 * (1 - t);
    }
  }

  public override isFinished(): boolean {
    return this.done;
  }

  public override dispose(): void {
    if (this.group) this.scene.remove(this.group);
    this.group?.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    });
    this.ringMaterial?.dispose();
    this.discMaterial?.dispose();
    this.group = null;
    this.ringMaterial = null;
    this.discMaterial = null;
    this.disc = null;
  }

  private build(point: THREE.Vector3): void {
    this.group = new THREE.Group();
    this.group.position.set(point.x, point.y + 0.05, point.z);
    this.group.renderOrder = 9_998;

    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xff3322,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(MARKER_RADIUS * 0.85, MARKER_RADIUS, 48),
      this.ringMaterial
    );
    ring.rotation.x = -Math.PI / 2;
    this.group.add(ring);

    this.discMaterial = new THREE.MeshBasicMaterial({
      color: 0xff5533,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.disc = new THREE.Mesh(
      new THREE.CircleGeometry(MARKER_RADIUS * 0.8, 40),
      this.discMaterial
    );
    this.disc.rotation.x = -Math.PI / 2;
    this.group.add(this.disc);

    this.scene.add(this.group);
  }
}
