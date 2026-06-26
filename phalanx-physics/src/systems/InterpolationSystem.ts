import {
  GameSystem,
  type CommandsBatch,
  type IAfterTick,
  type IBeforeFrame,
  type IBeforeTick,
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
  INTERPOLATION_COMPONENT_TYPE,
  InterpolationComponent,
} from '../components';
import { TRANSFORM_COMPONENT_TYPE, TransformSoASchema } from '../components';

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
 * InterpolationSystem — snapshots transform state each tick and interpolates
 * between previous/current samples for rendering.
 */
export class InterpolationSystem
  extends GameSystem
  implements IBeforeTick, IAfterTick, IBeforeFrame
{
  private transformStore!: SoAComponentStore<typeof TransformSoASchema.definition>;
  private readonly interpolatedSamples = new Map<number, InterpolatedTransformSample>();
  /** Entities captured at least once while present in the interpolation query. */
  private readonly capturedEntities = new Set<number>();

  public override init(context: SystemContext): void {
    super.init(context);
    this.transformStore = this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  public beforeTick(_tick: number, _commands: CommandsBatch): void {
    this.snapshot();
  }

  public afterTick(_tick: number): void {
    this.capture();
  }

  public beforeFrame(alpha: number, _dt: number): void {
    this.interpolate(alpha);
  }

  public snapshot(): void {
    const entities = this.entityManager.queryEntities(INTERPOLATION_COMPONENT_TYPE);
    for (const entity of entities) {
      entity.getComponent<InterpolationComponent>(INTERPOLATION_COMPONENT_TYPE)?.snapshot();
    }
  }

  public capture(): void {
    const entities = this.entityManager.queryEntities(
      INTERPOLATION_COMPONENT_TYPE,
      TRANSFORM_COMPONENT_TYPE,
    );
    const activeEntityIds = new Set<number>();

    for (const entity of entities) {
      activeEntityIds.add(entity.id);

      const interpolation = entity.getComponent<InterpolationComponent>(INTERPOLATION_COMPONENT_TYPE);
      const transformIndex = this.transformStore.indexOf(entity.id);
      if (!interpolation || transformIndex === -1) continue;

      const fpPosition = this.readFpPosition(transformIndex);
      const fpRotation = this.readFpRotation(transformIndex);

      if (!this.capturedEntities.has(entity.id)) {
        interpolation.capture(fpPosition, fpRotation);
        interpolation.snapshot();
        this.capturedEntities.add(entity.id);
        continue;
      }

      interpolation.capture(fpPosition, fpRotation);
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
      INTERPOLATION_COMPONENT_TYPE,
      TRANSFORM_COMPONENT_TYPE,
    );

    for (const entity of entities) {
      const interpolation = entity.getComponent<InterpolationComponent>(INTERPOLATION_COMPONENT_TYPE);
      if (!interpolation) continue;

      const previousPosition = FPVector3.ToFloat(interpolation.previousFpPosition);
      const currentPosition = FPVector3.ToFloat(interpolation.currentFpPosition);

      const interpolatedRotation = FPQuaternion.Slerp(
        interpolation.previousFpRotation,
        interpolation.currentFpRotation,
        fpAlpha,
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

  public getInterpolatedTransform(entityId: number): InterpolatedTransformSample | undefined {
    return this.interpolatedSamples.get(entityId);
  }

  private readFpPosition(index: number): FPVector3Type {
    const arrays = this.transformStore.arrays;
    return {
      x: FP.FromRaw(arrays.fpPositionX[index]),
      y: FP.FromRaw(arrays.fpPositionY[index]),
      z: FP.FromRaw(arrays.fpPositionZ[index]),
    };
  }

  private readFpRotation(index: number): FPQuaternionType {
    const arrays = this.transformStore.arrays;
    return {
      x: FP.FromRaw(arrays.fpRotationX[index]),
      y: FP.FromRaw(arrays.fpRotationY[index]),
      z: FP.FromRaw(arrays.fpRotationZ[index]),
      w: FP.FromRaw(arrays.fpRotationW[index]),
    };
  }
}
