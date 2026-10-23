import {
  GameSystem,
  type IAfterTick,
  type IBeforeFrame,
  type SoAComponentStore,
  type SystemContext,
} from '@phalanx-engine/ecs';
import {
  FP,
  FPVector3,
  FPQuaternion,
  type FPVector3 as FPVector3Type,
  type FPQuaternion as FPQuaternionType,
} from '@phalanx-engine/math';
import {
  Interpolation,
  Transform,
  TransformSoASchema,
  interpolationOf,
  snapshotInterpolation,
  captureInterpolation,
} from '../components/index.js';

export interface InterpolatedTransformSample {
  position: { x: number; y: number; z: number };
  /** Interpolated rotation as a float quaternion. */
  rotation: { x: number; y: number; z: number; w: number };
}

function lerpScalar(from: number, to: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return from + (to - from) * clamped;
}

/**
 * InterpolationSystem — snapshots transform state after each tick and
 * interpolates between previous/current samples for rendering.
 *
 * `afterTick` runs outside the transient-read guard. Snapshot and capture
 * both happen there, after simulation has written `Transform`.
 */
export class InterpolationSystem
  extends GameSystem
  implements IAfterTick, IBeforeFrame
{
  private transformStore!: SoAComponentStore<
    typeof TransformSoASchema.definition
  >;
  private readonly interpolatedSamples = new Map<
    number,
    InterpolatedTransformSample
  >();
  /** Entities captured at least once while present in the interpolation query. */
  private readonly capturedEntities = new Set<number>();

  public override init(context: SystemContext): void {
    super.init(context);
    this.transformStore =
      this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  public afterTick(_tick: number): void {
    this.snapshot();
    this.capture();
  }

  public beforeFrame(alpha: number, _dt: number): void {
    this.interpolate(alpha);
  }

  public snapshot(): void {
    const entities = this.entityManager.queryEntities(Interpolation.type);
    for (const entity of entities) {
      const sample = interpolationOf(entity);
      if (sample === undefined) continue;
      snapshotInterpolation(sample);
    }
  }

  public capture(): void {
    const entities = this.entityManager.queryEntities(
      Interpolation.type,
      Transform.type
    );
    const activeEntityIds = new Set<number>();

    for (const entity of entities) {
      activeEntityIds.add(entity.id);

      const sample = interpolationOf(entity);
      const transformIndex = this.transformStore.indexOf(entity.id);
      if (sample === undefined || transformIndex === -1) continue;

      const fpPosition = this.readFpPosition(transformIndex);
      const fpRotation = this.readFpRotation(transformIndex);

      if (!this.capturedEntities.has(entity.id)) {
        captureInterpolation(sample, fpPosition, fpRotation);
        snapshotInterpolation(sample);
        this.capturedEntities.add(entity.id);
        continue;
      }

      captureInterpolation(sample, fpPosition, fpRotation);
    }

    for (const entityId of this.capturedEntities) {
      if (!activeEntityIds.has(entityId)) {
        this.capturedEntities.delete(entityId);
        this.interpolatedSamples.delete(entityId);
      }
    }
  }

  public interpolate(alpha: number): void {
    const clampedAlpha = Math.max(0, Math.min(1, alpha));
    const fpAlpha = FP.FromFloat(clampedAlpha);
    this.interpolatedSamples.clear();

    const entities = this.entityManager.queryEntities(
      Interpolation.type,
      Transform.type
    );

    for (const entity of entities) {
      const sample = interpolationOf(entity);
      if (sample === undefined) continue;

      const previousPosition = FPVector3.ToFloat(sample.previousFpPosition);
      const currentPosition = FPVector3.ToFloat(sample.currentFpPosition);

      const interpolatedRotation = FPQuaternion.Slerp(
        sample.previousFpRotation,
        sample.currentFpRotation,
        fpAlpha
      );

      this.interpolatedSamples.set(entity.id, {
        position: {
          x: lerpScalar(previousPosition.x, currentPosition.x, clampedAlpha),
          y: lerpScalar(previousPosition.y, currentPosition.y, clampedAlpha),
          z: lerpScalar(previousPosition.z, currentPosition.z, clampedAlpha),
        },
        rotation: FPQuaternion.ToFloat(interpolatedRotation),
      });
    }
  }

  public getInterpolatedTransform(
    entityId: number
  ): InterpolatedTransformSample | undefined {
    return this.interpolatedSamples.get(entityId);
  }

  private readFpPosition(index: number): FPVector3Type {
    const arrays = this.transformStore.arrays;
    return {
      x: FP.FromRaw(arrays.fpPositionX[index] ?? 0n),
      y: FP.FromRaw(arrays.fpPositionY[index] ?? 0n),
      z: FP.FromRaw(arrays.fpPositionZ[index] ?? 0n),
    };
  }

  private readFpRotation(index: number): FPQuaternionType {
    const arrays = this.transformStore.arrays;
    return {
      x: FP.FromRaw(arrays.fpRotationX[index] ?? 0n),
      y: FP.FromRaw(arrays.fpRotationY[index] ?? 0n),
      z: FP.FromRaw(arrays.fpRotationZ[index] ?? 0n),
      w: FP.FromRaw(arrays.fpRotationW[index] ?? 0n),
    };
  }
}
