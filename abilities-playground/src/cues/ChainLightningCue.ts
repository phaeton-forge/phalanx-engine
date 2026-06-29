import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Entity } from '@phalanx-engine/ecs';
import { FPVector3 } from '@phalanx-engine/math';
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
import {
  CHAIN_LIGHTNING_LIFETIME_SECONDS,
  CHAIN_LIGHTNING_LINE_WIDTH,
} from '../config/abilityDefinitions';

const BEAM_HEIGHT_OFFSET = 2.8;
const LIFETIME_SECONDS = CHAIN_LIGHTNING_LIFETIME_SECONDS;
const SEGMENT_COUNT = 10;
const JITTER_AMOUNT = 0.35;

/** Deterministic visual jitter so every client sees the same bolt shape. */
const JITTER_TABLE = [
  0.12, -0.08, 0.22, -0.15, 0.05, -0.21, 0.18, -0.04, 0.11, -0.17,
];

/**
 * Short-lived jagged lightning beam between two entities.
 *
 * The geometry recomputes each frame so the bolt tracks moving units. The
 * jitter pattern is fixed (visual-only) so replays stay consistent.
 */
export class ChainLightningCue extends Cue {
  private readonly scene: THREE.Scene;
  private readonly color: number;
  private readonly isPrimary: boolean;
  private readonly initialPositions = new Float32Array(SEGMENT_COUNT * 2 * 3);
  private readonly direction = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly base = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  private sourceEntityId = -1;
  private targetEntityId = -1;
  private context: CueContext | null = null;
  private line: LineSegments2 | null = null;
  private material: LineMaterial | null = null;
  private readonly cachedResolution = new THREE.Vector2();
  private elapsed = 0;
  private done = false;

  public constructor(scene: THREE.Scene, color: number, isPrimary: boolean) {
    super();
    this.scene = scene;
    this.color = color;
    this.isPrimary = isPrimary;
  }

  private get resolution(): THREE.Vector2 {
    return this.cachedResolution.set(window.innerWidth, window.innerHeight);
  }

  public onSpawn(event: GameplayCueDispatchedEvent, context: CueContext): void {
    this.context = context;
    this.sourceEntityId = event.sourceEntityId;
    this.targetEntityId = event.targetEntityId;

    this.material = new LineMaterial({
      color: this.color,
      linewidth: CHAIN_LIGHTNING_LINE_WIDTH,
      transparent: true,
      opacity: this.isPrimary ? 0.9 : 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      resolution: this.resolution,
    });

    const geometry = new LineSegmentsGeometry();
    // SEGMENT_COUNT segments, 2 vertices per segment, 3 floats per vertex.
    geometry.setPositions(this.initialPositions);

    this.line = new LineSegments2(geometry, this.material);
    this.line.renderOrder = 9500;
    this.scene.add(this.line);
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

    const sourcePos = this.getAnchor(source);
    const targetPos = this.getAnchor(target);
    if (!sourcePos || !targetPos || !this.line || !this.material) {
      this.done = true;
      return;
    }

    this.updateGeometry(sourcePos, targetPos);

    const flicker = 0.6 + 0.4 * Math.abs(Math.sin(this.elapsed * 60));
    const fade = 1 - this.elapsed / LIFETIME_SECONDS;
    this.material.opacity = this.getBaseOpacity() * flicker * fade;
    this.material.resolution.copy(this.resolution);
  }

  public override isFinished(): boolean {
    return this.done;
  }

  public override dispose(): void {
    if (this.line) {
      this.scene.remove(this.line);
      this.line.geometry.dispose();
    }
    this.material?.dispose();
    this.line = null;
    this.material = null;
  }

  private getBaseOpacity(): number {
    return this.isPrimary ? 0.9 : 0.7;
  }

  private getAnchor(entity: Entity): THREE.Vector3 | null {
    const transform = entity.getComponent<TransformComponent>(
      ComponentType.Transform
    );
    if (transform) {
      const p = FPVector3.ToFloat(transform.fpPosition);
      return new THREE.Vector3(p.x, p.y + BEAM_HEIGHT_OFFSET, p.z);
    }

    const mesh = entity.getComponent<MeshComponent>(ComponentType.Mesh);
    if (mesh) {
      const pos = mesh.root.position;
      return new THREE.Vector3(pos.x, pos.y + BEAM_HEIGHT_OFFSET, pos.z);
    }

    return null;
  }

  private updateGeometry(from: THREE.Vector3, to: THREE.Vector3): void {
    const geometry = this.line!.geometry;
    const dir = this.direction.subVectors(to, from);
    const len = dir.length();
    dir.normalize();

    const side = this.side.crossVectors(dir, this.up);
    if (side.lengthSq() < 0.001) {
      side.set(1, 0, 0);
    }
    side.normalize();

    const starts = geometry.getAttribute(
      'instanceStart'
    ) as THREE.InterleavedBufferAttribute;
    const ends = geometry.getAttribute(
      'instanceEnd'
    ) as THREE.InterleavedBufferAttribute;
    let prevX = from.x;
    let prevY = from.y;
    let prevZ = from.z;

    for (let i = 1; i <= SEGMENT_COUNT; i++) {
      const t = i / SEGMENT_COUNT;
      const base = this.base.lerpVectors(from, to, t);

      let jitter = 0;
      if (i < SEGMENT_COUNT) {
        jitter = JITTER_TABLE[i - 1] * JITTER_AMOUNT * len;
      }

      const p = this.point.copy(base).addScaledVector(side, jitter);
      const segmentIndex = i - 1;
      starts.setXYZ(segmentIndex, prevX, prevY, prevZ);
      ends.setXYZ(segmentIndex, p.x, p.y, p.z);
      prevX = p.x;
      prevY = p.y;
      prevZ = p.z;
    }

    starts.data.needsUpdate = true;
    ends.data.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
}
