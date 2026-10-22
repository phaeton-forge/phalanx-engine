import { defineComponent, SoAComponent } from '@phalanx-engine/ecs';
import type { Entity, SoAComponentStore } from '@phalanx-engine/ecs';
import {
  FP,
  FPQuaternion,
  type FixedPoint,
  type FPQuaternion as FPQuaternionType,
  type FPVector3 as FPVector3Type,
} from '@phalanx-engine/math';

const RAW_0 = FP.ToRaw(FP._0);
const RAW_1 = FP.ToRaw(FP._1);

/**
 * Authoritative fixed-point position and quaternion. Saved. Hot paths
 * read `Transform.schema` arrays directly.
 */
export const Transform = defineComponent(
  'Transform',
  {
    fpPositionX: 'i64',
    fpPositionY: 'i64',
    fpPositionZ: 'i64',
    fpRotationX: 'i64',
    fpRotationY: 'i64',
    fpRotationZ: 'i64',
    fpRotationW: 'i64',
  },
  { defaults: { fpRotationW: RAW_1 } }
);

export const TransformSoASchema = Transform.schema;
export const TRANSFORM_COMPONENT_TYPE: symbol = Transform.type;

type TransformStore = SoAComponentStore<typeof TransformSoASchema.definition>;

const POSITION: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };
const ROTATION: FPQuaternionType = {
  x: FP._0,
  y: FP._0,
  z: FP._0,
  w: FP._1,
};

function store(): TransformStore {
  const manager = SoAComponent.currentEntityManager();
  if (manager === null) {
    throw new Error('Transform: no EntityManager context');
  }
  const found = manager.getSoAStore(TransformSoASchema);
  if (found === undefined) {
    throw new Error('Transform: store is not created');
  }
  return found;
}

function rawAt(values: BigInt64Array, index: number): bigint {
  const value = values[index];
  return value === undefined ? RAW_0 : value;
}

/** Attach a transform row. Safe before the entity is registered. */
export function attachTransform(
  entity: Entity,
  position?: FPVector3Type,
  rotation?: FPQuaternionType
): void {
  entity.addComponent(
    Transform.create(entity.id, transformValues(position, rotation))
  );
}

export function transformValues(
  position?: FPVector3Type,
  rotation?: FPQuaternionType
): Partial<typeof Transform.defaults> {
  const values: Partial<typeof Transform.defaults> = {};
  if (position !== undefined) {
    values.fpPositionX = FP.ToRaw(position.x);
    values.fpPositionY = FP.ToRaw(position.y);
    values.fpPositionZ = FP.ToRaw(position.z);
  }
  if (rotation !== undefined) {
    values.fpRotationX = FP.ToRaw(rotation.x);
    values.fpRotationY = FP.ToRaw(rotation.y);
    values.fpRotationZ = FP.ToRaw(rotation.z);
    values.fpRotationW = FP.ToRaw(rotation.w);
  }
  return values;
}

/** Shared scratch. Do not retain it across another transform read. */
export function readFpPosition(entityId: number): FPVector3Type {
  const index = store().indexOf(entityId);
  if (index === -1) return POSITION;
  const arrays = store().arrays;
  POSITION.x = FP.FromRaw(rawAt(arrays.fpPositionX, index));
  POSITION.y = FP.FromRaw(rawAt(arrays.fpPositionY, index));
  POSITION.z = FP.FromRaw(rawAt(arrays.fpPositionZ, index));
  return POSITION;
}

export function writeFpPosition(entityId: number, value: FPVector3Type): void {
  const arrays = store().arrays;
  const index = store().indexOf(entityId);
  if (index === -1) return;
  arrays.fpPositionX[index] = FP.ToRaw(value.x);
  arrays.fpPositionY[index] = FP.ToRaw(value.y);
  arrays.fpPositionZ[index] = FP.ToRaw(value.z);
}

/** Shared scratch. Do not retain it across another transform read. */
export function readFpRotation(entityId: number): FPQuaternionType {
  const index = store().indexOf(entityId);
  if (index === -1) return ROTATION;
  const arrays = store().arrays;
  ROTATION.x = FP.FromRaw(rawAt(arrays.fpRotationX, index));
  ROTATION.y = FP.FromRaw(rawAt(arrays.fpRotationY, index));
  ROTATION.z = FP.FromRaw(rawAt(arrays.fpRotationZ, index));
  ROTATION.w = FP.FromRaw(rawAt(arrays.fpRotationW, index));
  return ROTATION;
}

export function writeFpRotation(
  entityId: number,
  value: FPQuaternionType
): void {
  const arrays = store().arrays;
  const index = store().indexOf(entityId);
  if (index === -1) return;
  arrays.fpRotationX[index] = FP.ToRaw(value.x);
  arrays.fpRotationY[index] = FP.ToRaw(value.y);
  arrays.fpRotationZ[index] = FP.ToRaw(value.z);
  arrays.fpRotationW[index] = FP.ToRaw(value.w);
}

/** Euler XYZ view of the quaternion. A fresh vector. */
export function readFpRotationEuler(entityId: number): FPVector3Type {
  return FPQuaternion.ToEulerXYZ(readFpRotation(entityId));
}

export function writeFpRotationEuler(
  entityId: number,
  value: FPVector3Type
): void {
  writeFpRotation(entityId, FPQuaternion.FromEulerXYZ(value));
}

/** Yaw around Y, in radians. */
export function readYaw(entityId: number): FixedPoint {
  const q = readFpRotation(entityId);
  const two = FP.FromInt(2);
  const sinY = FP.Mul(two, FP.Add(FP.Mul(q.w, q.y), FP.Mul(q.x, q.z)));
  const cosY = FP.Sub(
    FP._1,
    FP.Mul(two, FP.Add(FP.Mul(q.y, q.y), FP.Mul(q.z, q.z)))
  );
  return FP.Atan2(sinY, cosY);
}

export function writeYaw(entityId: number, value: FixedPoint): void {
  writeFpRotation(entityId, FPQuaternion.FromYaw(value));
}
