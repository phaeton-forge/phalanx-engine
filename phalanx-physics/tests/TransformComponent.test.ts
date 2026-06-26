import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Entity, EntityManager, SoAComponent } from '@phalanx-engine/ecs';
import { FP, FPVector3, FPQuaternion } from '@phalanx-engine/math';
import {
  TransformComponent,
  TransformSoASchema,
  TRANSFORM_COMPONENT_TYPE,
} from '../src/components/TransformComponent';

describe('TransformComponent', () => {
  let entityManager: EntityManager;

  beforeEach(() => {
    entityManager = new EntityManager();
    SoAComponent.useEntityManager(entityManager);
  });

  afterEach(() => {
    SoAComponent.resetContext();
  });

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

  it('uses TRANSFORM_COMPONENT_TYPE as its component type', () => {
    const entity = new Entity();
    entityManager.addEntity(entity);
    const transform = new TransformComponent(entity.id);
    entity.addComponent(transform);

    expect(transform.type).toBe(TRANSFORM_COMPONENT_TYPE);
  });

  it('defaults to the identity rotation when no initial rotation is given', () => {
    const entity = new Entity();
    entityManager.addEntity(entity);
    const transform = new TransformComponent(entity.id);
    entity.addComponent(transform);

    const rotation = transform.fpRotation;
    expect(FP.ToFloat(rotation.x)).toBeCloseTo(0);
    expect(FP.ToFloat(rotation.y)).toBeCloseTo(0);
    expect(FP.ToFloat(rotation.z)).toBeCloseTo(0);
    expect(FP.ToFloat(rotation.w)).toBeCloseTo(1);
  });

  it('reads and writes fpPosition and quaternion fpRotation', () => {
    const entity = new Entity();
    entityManager.addEntity(entity);
    const initialPosition = FPVector3.FromFloat(1, 2, 3);
    const initialRotation = FPQuaternion.FromAxisAngle(FPVector3.Up, FP.FromFloat(1.5));
    const transform = new TransformComponent(entity.id, initialPosition, initialRotation);
    entity.addComponent(transform);

    expect(FP.ToFloat(transform.fpPosition.x)).toBeCloseTo(1);
    expect(FP.ToFloat(transform.fpPosition.y)).toBeCloseTo(2);
    expect(FP.ToFloat(transform.fpPosition.z)).toBeCloseTo(3);
    // Yaw view reflects the stored quaternion (tolerance for FixedPoint trig).
    expect(FP.ToFloat(transform.fpRotationY)).toBeCloseTo(1.5, 1);

    const newPosition = FPVector3.FromFloat(4, 5, 6);
    transform.fpPosition = newPosition;
    transform.fpRotationY = FP.FromFloat(0.25);

    expect(FP.ToFloat(transform.fpPosition.x)).toBeCloseTo(4);
    expect(FP.ToFloat(transform.fpRotationY)).toBeCloseTo(0.25, 2);

    const store = entityManager.getOrCreateSoAStore(TransformSoASchema);
    const idx = store.indexOf(entity.id);
    expect(FP.ToFloat(FP.FromRaw(store.arrays.fpPositionX[idx]))).toBeCloseTo(4);
    // Stored rotation w component must remain a valid (non-zero) quaternion.
    expect(FP.ToFloat(FP.FromRaw(store.arrays.fpRotationW[idx]))).not.toBeCloseTo(0);
  });

  it('round-trips fpRotation through the SoA store without loss', () => {
    const entity = new Entity();
    entityManager.addEntity(entity);
    const transform = new TransformComponent(entity.id);
    entity.addComponent(transform);

    const q = FPQuaternion.FromEulerXYZ(FPVector3.FromFloat(0.3, 0.4, 0.5));
    transform.fpRotation = q;

    const readBack = transform.fpRotation;
    expect(readBack.x).toEqual(q.x);
    expect(readBack.y).toEqual(q.y);
    expect(readBack.z).toEqual(q.z);
    expect(readBack.w).toEqual(q.w);
  });

  it('exposes a computed Euler view over the authoritative quaternion', () => {
    const entity = new Entity();
    entityManager.addEntity(entity);
    const transform = new TransformComponent(entity.id);
    entity.addComponent(transform);

    transform.fpRotationEuler = FPVector3.FromFloat(0, 1.0, 0);

    const euler = transform.fpRotationEuler;
    expect(FP.ToFloat(euler.y)).toBeCloseTo(1.0, 2);
  });

  it('does not expose visual position or rotation APIs', () => {
    const transform = new TransformComponent(1);
    expect('visualPosition' in transform).toBe(false);
    expect('visualPositionX' in transform).toBe(false);
    expect('visualRotationY' in transform).toBe(false);
    expect('setVisualPosition' in transform).toBe(false);
    expect('syncVisualFromFp' in transform).toBe(false);
  });
});
