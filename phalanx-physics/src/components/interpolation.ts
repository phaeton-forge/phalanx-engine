import type { Entity, GameWorld, SoAComponentStore } from '@phalanx-engine/ecs';
import { defineComponent, ValueComponent } from '@phalanx-engine/ecs';
import {
  FP,
  type FPQuaternion as FPQuaternionType,
  type FPVector3 as FPVector3Type,
} from '@phalanx-engine/math';
import { PhysicsBody } from './physicsBody.js';
import { Transform, TransformSoASchema } from './transform.js';

/**
 * Tick samples for render smoothing. Transient: not saved, not in
 * `configHash`. Tick systems must not branch on it. `afterTick` may read it.
 */
export interface InterpolationSample {
  previousFpPosition: FPVector3Type;
  currentFpPosition: FPVector3Type;
  previousFpRotation: FPQuaternionType;
  currentFpRotation: FPQuaternionType;
}

export const Interpolation = defineComponent<InterpolationSample>(
  'Interpolation',
  {
    kind: 'transient',
    create: () => createInterpolationSample(),
  }
);

type InterpolationValue = ValueComponent<InterpolationSample>;

export function createInterpolationSample(
  position?: FPVector3Type,
  rotation?: FPQuaternionType
): InterpolationSample {
  const pos = position ?? { x: FP._0, y: FP._0, z: FP._0 };
  const rot = rotation ?? { x: FP._0, y: FP._0, z: FP._0, w: FP._1 };
  return {
    previousFpPosition: { x: pos.x, y: pos.y, z: pos.z },
    currentFpPosition: { x: pos.x, y: pos.y, z: pos.z },
    previousFpRotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
    currentFpRotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
  };
}

/**
 * Attach interpolation. Safe before the entity is registered.
 * A second call resets the stored sample in place.
 */
export function attachInterpolation(
  entity: Entity,
  position?: FPVector3Type,
  rotation?: FPQuaternionType
): InterpolationSample {
  const existing = entity._peekComponent<InterpolationValue>(
    Interpolation.type
  );
  if (existing !== undefined) {
    const next = createInterpolationSample(position, rotation);
    copySample(existing.value, next);
    return existing.value;
  }
  const value = createInterpolationSample(position, rotation);
  entity.addComponent(new ValueComponent(Interpolation.type, value));
  return value;
}

export function interpolationOf(
  entity: Entity
): InterpolationSample | undefined {
  return entity.getComponent<InterpolationValue>(Interpolation.type)?.value;
}

export function snapshotInterpolation(sample: InterpolationSample): void {
  copyVec(sample.previousFpPosition, sample.currentFpPosition);
  copyQuat(sample.previousFpRotation, sample.currentFpRotation);
}

export function captureInterpolation(
  sample: InterpolationSample,
  position: FPVector3Type,
  rotation: FPQuaternionType
): void {
  copyVec(sample.currentFpPosition, position);
  copyQuat(sample.currentFpRotation, rotation);
}

/**
 * Attach `Interpolation` to every entity that has both `Transform` and
 * `PhysicsBody`. Previous and current samples are that transform, so the
 * first rendered frame is not the origin. A fresh world has no discarded
 * ids; this does not consult them.
 */
export function restoreOwnedInterpolation(world: GameWorld): void {
  const bodies = world.entityManager.getSoAStore(PhysicsBody.schema);
  const transforms = world.entityManager.getSoAStore(Transform.schema);
  if (bodies === undefined || transforms === undefined) return;
  for (const id of bodies.entityIds()) {
    if (transforms.indexOf(id) === -1) continue;
    const entity = world.entityManager.getEntity(id);
    if (entity === undefined) continue;
    if (!entity._componentAttached(Interpolation.type)) {
      world.addComponent(entity, Interpolation);
    }
    const sample = entity._peekComponent<InterpolationValue>(
      Interpolation.type
    )?.value;
    if (sample === undefined) continue;
    captureInterpolation(
      sample,
      positionAt(transforms, id),
      rotationAt(transforms, id)
    );
    snapshotInterpolation(sample);
  }
}

function positionAt(
  store: SoAComponentStore<typeof TransformSoASchema.definition>,
  id: number
): FPVector3Type {
  const index = store.indexOf(id);
  const arrays = store.arrays;
  return {
    x: FP.FromRaw(arrays.fpPositionX[index] ?? 0n),
    y: FP.FromRaw(arrays.fpPositionY[index] ?? 0n),
    z: FP.FromRaw(arrays.fpPositionZ[index] ?? 0n),
  };
}

function rotationAt(
  store: SoAComponentStore<typeof TransformSoASchema.definition>,
  id: number
): FPQuaternionType {
  const index = store.indexOf(id);
  const arrays = store.arrays;
  return {
    x: FP.FromRaw(arrays.fpRotationX[index] ?? 0n),
    y: FP.FromRaw(arrays.fpRotationY[index] ?? 0n),
    z: FP.FromRaw(arrays.fpRotationZ[index] ?? 0n),
    w: FP.FromRaw(arrays.fpRotationW[index] ?? 0n),
  };
}

function copySample(
  target: InterpolationSample,
  source: InterpolationSample
): void {
  copyVec(target.previousFpPosition, source.previousFpPosition);
  copyVec(target.currentFpPosition, source.currentFpPosition);
  copyQuat(target.previousFpRotation, source.previousFpRotation);
  copyQuat(target.currentFpRotation, source.currentFpRotation);
}

function copyVec(target: FPVector3Type, source: FPVector3Type): void {
  target.x = source.x;
  target.y = source.y;
  target.z = source.z;
}

function copyQuat(target: FPQuaternionType, source: FPQuaternionType): void {
  target.x = source.x;
  target.y = source.y;
  target.z = source.z;
  target.w = source.w;
}
