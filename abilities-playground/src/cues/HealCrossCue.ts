import * as THREE from 'three';
import { FPVector3 } from 'phalanx-math';
import { Cue } from 'phalanx-abilities';
import type { CueContext, GameplayCueDispatchedEvent } from 'phalanx-abilities';
import { ComponentType, TransformComponent } from '../components';
import { clamp01, easeOutCubic } from './vfxHelpers';

const DURATION_SECONDS = 0.5;
const FLOAT_HEIGHT = 2.4;
const BASE_HEIGHT = 3.2;
const CROSS_COLOR = '#44ff88';

/**
 * Short-lived green "+" that floats up over a healed unit each aura pulse.
 * Bound to the heal target via `event.targetEntityId`.
 */
export class HealCrossCue extends Cue {
  private group: THREE.Group | null = null;
  private material: THREE.MeshBasicMaterial | null = null;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private elapsed = 0;
  private done = false;
  private startY = 0;
  private readonly scene: THREE.Scene;

  public constructor(scene: THREE.Scene) {
    super();
    this.scene = scene;
  }

  public onSpawn(event: GameplayCueDispatchedEvent, context: CueContext): void {
    const targetEntity = context.entityManager.getEntity(event.targetEntityId);

    if (!targetEntity) {
      this.done = true;
      return;
    }

    const transform = targetEntity.getComponent<TransformComponent>(ComponentType.Transform);
    if (!transform) {
      this.done = true;
      return;
    }

    const p = FPVector3.ToFloat(transform.fpPosition);
    const position = new THREE.Vector3(p.x, p.y, p.z);

    this.spawnCross(position);
  }

  public override update(deltaTimeSeconds: number): void {
    if (this.done || !this.group || !this.material) {
      return;
    }
    this.elapsed += deltaTimeSeconds;
    const t = this.elapsed / DURATION_SECONDS;
    const k = easeOutCubic(t);
    this.group.position.y = this.startY + FLOAT_HEIGHT * k;
    this.material.opacity = 0.95 * (1 - clamp01(t));
    if (t >= 1) {
      this.done = true;
    }
  }

  public override isFinished(): boolean {
    return this.done;
  }

  public override dispose(): void {
    if (this.group) {
      this.scene.remove(this.group);
    }
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    this.geometries.length = 0;
    this.material?.dispose();
    this.group = null;
    this.material = null;
  }

  private spawnCross(position: THREE.Vector3): void {
    this.material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(CROSS_COLOR),
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });

    const vertical = new THREE.PlaneGeometry(0.45, 1.6);
    const horizontal = new THREE.PlaneGeometry(1.6, 0.45);
    this.geometries.push(vertical, horizontal);

    this.group = new THREE.Group();
    this.group.add(new THREE.Mesh(vertical, this.material));
    this.group.add(new THREE.Mesh(horizontal, this.material));
    this.group.renderOrder = 10_000;

    this.startY = position.y + BASE_HEIGHT;
    this.group.position.set(position.x, this.startY, position.z);
    // Billboard toward +Z (top-down camera looks down -Y, so face up).
    this.group.rotation.x = -Math.PI / 2;
    this.scene.add(this.group);
  }
}

