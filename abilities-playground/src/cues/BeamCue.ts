import * as THREE from 'three';
import type { Entity } from 'phalanx-ecs';
import { FPVector3 } from 'phalanx-math';
import { Cue, getGameplayTagsComponent } from 'phalanx-abilities';
import type { CueContext, GameplayCueDispatchedEvent } from 'phalanx-abilities';
import { ComponentType, MeshComponent, StatsComponent, TransformComponent } from '../components';

const BEAM_HEIGHT_OFFSET = 2.8;
const SPARK_COUNT = 6;
const SPARK_RADIUS = 0.22;

/**
 * Semi-transparent laser beam from cube (source) to highlighted unit (target),
 * with small sparkle pulses traveling along the beam.
 */
export class BeamCue extends Cue {
  private readonly scene: THREE.Scene;
  private readonly color: number;
  private readonly requiredTag: string;

  private sourceEntityId = -1;
  private targetEntityId = -1;
  private context: CueContext | null = null;
  private beamLine: THREE.Line | null = null;
  private beamMaterial: THREE.LineBasicMaterial | null = null;
  private sparkGroup: THREE.Group | null = null;
  private sparkMaterials: THREE.MeshBasicMaterial[] = [];
  private elapsed = 0;
  private done = false;

  public constructor(scene: THREE.Scene, color: number, requiredTag: string) {
    super();
    this.scene = scene;
    this.color = color;
    this.requiredTag = requiredTag;
  }

  public onSpawn(event: GameplayCueDispatchedEvent, context: CueContext): void {
    this.context = context;
    this.sourceEntityId = event.sourceEntityId;
    this.targetEntityId = event.targetEntityId;

    this.beamMaterial = new THREE.LineBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(6, 3));
    this.beamLine = new THREE.Line(geometry, this.beamMaterial);
    this.beamLine.renderOrder = 9000;
    this.scene.add(this.beamLine);

    this.sparkGroup = new THREE.Group();
    this.sparkGroup.renderOrder = 9001;
    this.scene.add(this.sparkGroup);

    const sparkGeometry = new THREE.SphereGeometry(SPARK_RADIUS, 8, 8);
    for (let i = 0; i < SPARK_COUNT; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: this.color,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      });
      const spark = new THREE.Mesh(sparkGeometry, material);
      this.sparkGroup.add(spark);
      this.sparkMaterials.push(material);
    }
  }

  public override update(deltaTimeSeconds: number): void {
    if (this.done || !this.context) return;

    this.elapsed += deltaTimeSeconds;

    const source = this.context.entityManager.getEntity(this.sourceEntityId);
    const target = this.context.entityManager.getEntity(this.targetEntityId);

    if (!source || !target) {
      this.done = true;
      return;
    }

    const sourceStats = source.getComponent<StatsComponent>(ComponentType.UnitStats);
    const targetStats = target.getComponent<StatsComponent>(ComponentType.UnitStats);
    if (!sourceStats?.alive || !targetStats?.alive) {
      this.done = true;
      return;
    }

    const targetTags = getGameplayTagsComponent(target);
    if (!targetTags?.tags.has(this.requiredTag)) {
      this.done = true;
      return;
    }

    const sourcePos = this.getBeamAnchor(source);
    const targetPos = this.getBeamAnchor(target);
    if (!sourcePos || !targetPos || !this.beamLine || !this.sparkGroup) {
      this.done = true;
      return;
    }

    this.updateBeamGeometry(sourcePos, targetPos);
    this.updateSparks(sourcePos, targetPos);
  }

  public override isFinished(): boolean {
    return this.done;
  }

  public override dispose(): void {
    if (this.beamLine) {
      this.scene.remove(this.beamLine);
      this.beamLine.geometry.dispose();
    }
    this.beamMaterial?.dispose();

    if (this.sparkGroup) {
      for (const child of this.sparkGroup.children) {
        (child as THREE.Mesh).geometry.dispose();
      }
      this.scene.remove(this.sparkGroup);
    }
    for (const material of this.sparkMaterials) {
      material.dispose();
    }

    this.beamLine = null;
    this.beamMaterial = null;
    this.sparkGroup = null;
    this.sparkMaterials.length = 0;
  }

  private getBeamAnchor(entity: Entity): THREE.Vector3 | null {
    const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
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

  private updateBeamGeometry(from: THREE.Vector3, to: THREE.Vector3): void {
    const positions = this.beamLine!.geometry.getAttribute('position') as THREE.BufferAttribute;
    positions.setXYZ(0, from.x, from.y, from.z);
    positions.setXYZ(1, to.x, to.y, to.z);
    positions.needsUpdate = true;
  }

  private updateSparks(from: THREE.Vector3, to: THREE.Vector3): void {
    const sparkMeshes = this.sparkGroup!.children as THREE.Mesh[];

    for (let i = 0; i < sparkMeshes.length; i++) {
      const phase = (this.elapsed * 1.8 + i / sparkMeshes.length) % 1;
      const t = phase;
      const spark = sparkMeshes[i];
      spark.position.set(
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t,
        from.z + (to.z - from.z) * t,
      );

      const pulse = 0.35 + 0.65 * Math.abs(Math.sin(this.elapsed * 12 + i * 1.7));
      this.sparkMaterials[i]!.opacity = pulse;
      spark.scale.setScalar(0.6 + pulse * 0.5);
    }
  }
}
