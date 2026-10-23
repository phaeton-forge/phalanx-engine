import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Entity, EntityManager } from '@phalanx-engine/ecs';
import { FP, FPVector3, FPQuaternion } from '@phalanx-engine/math';
import {
  Transform,
  TransformSoASchema,
  attachTransform,
  readFpPosition,
  readFpRotation,
  readFpRotationEuler,
  readYaw,
  writeFpPosition,
  writeFpRotation,
  writeFpRotationEuler,
  writeYaw,
} from '../src/components/transform';

describe('Transform', () => {
  let entityManager: EntityManager;

  beforeEach(() => {
    entityManager = new EntityManager();
  });

  function add(
    position?: ReturnType<typeof FPVector3.FromFloat>,
    rotation?: ReturnType<typeof FPQuaternion.Identity>
  ): Entity {
    const entity = new Entity(entityManager.allocateEntityId());
    attachTransform(entity, position, rotation);
    entityManager.addEntity(entity);
    return entity;
  }

  it('exposes fixed-point position and quaternion rotation schema fields', () => {
    expect(Object.keys(TransformSoASchema.definition)).toEqual([
      'fpPositionX',
      'fpPositionY',
      'fpPositionZ',
      'fpRotationX',
      'fpRotationY',
      'fpRotationZ',
      'fpRotationW',
    ]);
  });

  it('defaults to the identity rotation when no initial rotation is given', () => {
    const entity = add();
    const rotation = readFpRotation(entity);
    expect(FP.ToFloat(rotation.x)).toBeCloseTo(0);
    expect(FP.ToFloat(rotation.y)).toBeCloseTo(0);
    expect(FP.ToFloat(rotation.z)).toBeCloseTo(0);
    expect(FP.ToFloat(rotation.w)).toBeCloseTo(1);
  });

  it('reads and writes fpPosition and quaternion fpRotation', () => {
    const initialPosition = FPVector3.FromFloat(1, 2, 3);
    const initialRotation = FPQuaternion.FromAxisAngle(
      FPVector3.Up,
      FP.FromFloat(1.5)
    );
    const entity = add(initialPosition, initialRotation);

    const position = readFpPosition(entity);
    expect(FP.ToFloat(position.x)).toBeCloseTo(1);
    expect(FP.ToFloat(position.y)).toBeCloseTo(2);
    expect(FP.ToFloat(position.z)).toBeCloseTo(3);
    expect(FP.ToFloat(readYaw(entity))).toBeCloseTo(1.5, 1);

    writeFpPosition(entity, FPVector3.FromFloat(4, 5, 6));
    writeYaw(entity, FP.FromFloat(0.25));

    expect(FP.ToFloat(readFpPosition(entity).x)).toBeCloseTo(4);
    expect(FP.ToFloat(readYaw(entity))).toBeCloseTo(0.25, 2);

    const store = entityManager.getOrCreateSoAStore(TransformSoASchema);
    const idx = store.indexOf(entity.id);
    expect(
      FP.ToFloat(FP.FromRaw(store.arrays.fpPositionX[idx] ?? 0n))
    ).toBeCloseTo(4);
    expect(
      FP.ToFloat(FP.FromRaw(store.arrays.fpRotationW[idx] ?? 0n))
    ).not.toBeCloseTo(0);
  });

  it('round-trips fpRotation through the SoA store without loss', () => {
    const entity = add();
    const q = FPQuaternion.FromEulerXYZ(FPVector3.FromFloat(0.3, 0.4, 0.5));
    writeFpRotation(entity, q);

    const readBack = readFpRotation(entity);
    expect(readBack.x).toEqual(q.x);
    expect(readBack.y).toEqual(q.y);
    expect(readBack.z).toEqual(q.z);
    expect(readBack.w).toEqual(q.w);
  });

  it('exposes a computed Euler view over the authoritative quaternion', () => {
    const entity = add();
    writeFpRotationEuler(entity, FPVector3.FromFloat(0, 1.0, 0));
    expect(FP.ToFloat(readFpRotationEuler(entity).y)).toBeCloseTo(1.0, 2);
  });

  it('fpRotationY matches forward derived from a PI quaternion', () => {
    const rotation = FPQuaternion.FromYaw(FP.Pi);
    const entity = add(undefined, rotation);
    const forward = FPQuaternion.RotateVector(rotation, FPVector3.Forward);
    expect(FP.Eq(forward.z, FP.Neg(FP._1))).toBe(true);
    const yaw = FP.ToFloat(readYaw(entity));
    expect(
      Math.atan2(FP.ToFloat(forward.x), FP.ToFloat(forward.z))
    ).toBeCloseTo(yaw, 2);
  });
});
