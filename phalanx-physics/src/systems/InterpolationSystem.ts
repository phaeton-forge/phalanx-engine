import {
  GameSystem,
  type CommandsBatch,
  type IAfterTick,
  type IBeforeFrame,
  type IBeforeTick,
  type SoAComponentStore,
  type SystemContext,
} from '@phalanx-engine/ecs';
import { FP, FPVector3, type FPVector3 as FPVector3Type } from '@phalanx-engine/math';
import {
  INTERPOLATION_COMPONENT_TYPE,
  InterpolationComponent,
} from '../components';
import { TRANSFORM_COMPONENT_TYPE, TransformSoASchema } from '../components';

export interface InterpolatedTransformSample {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
}

/** Shortest-path angle interpolation (radians). */
function lerpAngle(from: number, to: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  let delta = to - from;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  return from + delta * clamped;
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

      const fpPosition = this.readFpVector3(
        transformIndex,
        'fpPositionX',
        'fpPositionY',
        'fpPositionZ',
      );
      const fpRotation = this.readFpVector3(
        transformIndex,
        'fpRotationX',
        'fpRotationY',
        'fpRotationZ',
      );

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
      const previousRotation = FPVector3.ToFloat(interpolation.previousFpRotation);
      const currentRotation = FPVector3.ToFloat(interpolation.currentFpRotation);

      this.interpolatedSamples.set(entity.id, {
        position: {
          x: lerpScalar(previousPosition.x, currentPosition.x, clampedAlpha),
          y: lerpScalar(previousPosition.y, currentPosition.y, clampedAlpha),
          z: lerpScalar(previousPosition.z, currentPosition.z, clampedAlpha),
        },
        rotation: {
          x: lerpAngle(previousRotation.x, currentRotation.x, clampedAlpha),
          y: lerpAngle(previousRotation.y, currentRotation.y, clampedAlpha),
          z: lerpAngle(previousRotation.z, currentRotation.z, clampedAlpha),
        },
      });
    }
  }

  public getInterpolatedTransform(entityId: number): InterpolatedTransformSample | undefined {
    return this.interpolatedSamples.get(entityId);
  }

  private readFpVector3(
    index: number,
    xKey: 'fpPositionX' | 'fpRotationX',
    yKey: 'fpPositionY' | 'fpRotationY',
    zKey: 'fpPositionZ' | 'fpRotationZ',
  ): FPVector3Type {
    const arrays = this.transformStore.arrays;
    return {
      x: FP.FromRaw(arrays[xKey][index]),
      y: FP.FromRaw(arrays[yKey][index]),
      z: FP.FromRaw(arrays[zKey][index]),
    };
  }
}
