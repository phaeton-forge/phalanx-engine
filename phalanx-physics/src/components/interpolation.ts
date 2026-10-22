import type { Entity, GameWorld, IComponent } from '@phalanx-engine/ecs';
import { defineComponent } from '@phalanx-engine/ecs';
import {
  FP,
  type FPQuaternion as FPQuaternionType,
  type FPVector3 as FPVector3Type,
} from '@phalanx-engine/math';
import { PhysicsBody } from './physicsBody.js';

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

export const INTERPOLATION_COMPONENT_TYPE: symbol = Interpolation.type;

class InterpolationHolder implements IComponent {
  public readonly type = INTERPOLATION_COMPONENT_TYPE;

  public constructor(public value: InterpolationSample) {}
}

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
  const existing = entity._peekComponent<InterpolationHolder>(
    INTERPOLATION_COMPONENT_TYPE
  );
  if (existing !== undefined) {
    const next = createInterpolationSample(position, rotation);
    copySample(existing.value, next);
    return existing.value;
  }
  const value = createInterpolationSample(position, rotation);
  entity.addComponent(new InterpolationHolder(value));
  entity._manager?.onComponentAdded(entity, INTERPOLATION_COMPONENT_TYPE);
  return value;
}

export function interpolationOf(
  entity: Entity
): InterpolationSample | undefined {
  return entity.getComponent<InterpolationHolder>(INTERPOLATION_COMPONENT_TYPE)
    ?.value;
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
 * Put `Interpolation` back on every entity that had it when transients
 * were discarded. Values are `create()` defaults. Bodies that never had
 * the component stay without it.
 */
export function restoreOwnedInterpolation(world: GameWorld): void {
  const store = world.entityManager.getSoAStore(PhysicsBody.schema);
  if (store === undefined) return;
  for (const id of world.discardedTransientIds(INTERPOLATION_COMPONENT_TYPE)) {
    if (store.indexOf(id) === -1) continue;
    const entity = world.entityManager.getEntity(id);
    if (entity === undefined) continue;
    if (entity._componentAttached(INTERPOLATION_COMPONENT_TYPE)) continue;
    world.add(entity, Interpolation);
  }
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
