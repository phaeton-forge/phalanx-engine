import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Entity, EntityManager, SoAComponent } from 'phalanx-ecs';
import { FP, FPVector3 } from 'phalanx-math';
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

  it('exposes only fixed-point position and rotation schema fields', () => {
    expect(Object.keys(TransformSoASchema.definition)).toEqual([
      'fpPositionX',
      'fpPositionY',
      'fpPositionZ',
      'fpRotationX',
      'fpRotationY',
      'fpRotationZ',
    ]);
  });

  it('uses TRANSFORM_COMPONENT_TYPE as its component type', () => {
    const entity = new Entity();
    entityManager.addEntity(entity);
    const transform = new TransformComponent(entity.id);
    entity.addComponent(transform);

    expect(transform.type).toBe(TRANSFORM_COMPONENT_TYPE);
  });

  it('reads and writes fpPosition and fpRotation', () => {
    const entity = new Entity();
    entityManager.addEntity(entity);
    const initialPosition = FPVector3.FromFloat(1, 2, 3);
    const initialRotation = FPVector3.FromFloat(0, 1.5, 0);
    const transform = new TransformComponent(entity.id, initialPosition, initialRotation);
    entity.addComponent(transform);

    expect(FP.ToFloat(transform.fpPosition.x)).toBeCloseTo(1);
    expect(FP.ToFloat(transform.fpPosition.y)).toBeCloseTo(2);
    expect(FP.ToFloat(transform.fpPosition.z)).toBeCloseTo(3);
    expect(FP.ToFloat(transform.fpRotation.y)).toBeCloseTo(1.5);
    expect(FP.ToFloat(transform.fpRotationY)).toBeCloseTo(1.5);

    const newPosition = FPVector3.FromFloat(4, 5, 6);
    transform.fpPosition = newPosition;
    transform.fpRotationY = FP.FromFloat(0.25);

    expect(FP.ToFloat(transform.fpPosition.x)).toBeCloseTo(4);
    expect(FP.ToFloat(transform.fpRotationY)).toBeCloseTo(0.25);

    const store = entityManager.getOrCreateSoAStore(TransformSoASchema);
    const idx = store.indexOf(entity.id);
    expect(FP.ToFloat(FP.FromRaw(store.arrays.fpPositionX[idx]))).toBeCloseTo(4);
    expect(FP.ToFloat(FP.FromRaw(store.arrays.fpRotationY[idx]))).toBeCloseTo(0.25);
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
