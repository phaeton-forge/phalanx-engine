import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {CommandsBatch, Entity, EntityManager, EventBus, SoAComponent, SystemContext} from 'phalanx-ecs';
import { FP, FPVector3 } from 'phalanx-math';
import { TransformComponent, TRANSFORM_COMPONENT_TYPE } from '../src/components/TransformComponent';
import {
  InterpolationComponent,
  INTERPOLATION_COMPONENT_TYPE,
} from '../src/components/InterpolationComponent';
import { InterpolationSystem } from '../src/systems/InterpolationSystem';

describe('InterpolationSystem', () => {
  let entityManager: EntityManager;
  let system: InterpolationSystem;

  beforeEach(() => {
    entityManager = new EntityManager();
    entityManager.registerComponentTypes([
      TRANSFORM_COMPONENT_TYPE,
      INTERPOLATION_COMPONENT_TYPE,
    ]);
    SoAComponent.useEntityManager(entityManager);

    const context = new SystemContext(new EventBus(), entityManager);
    system = new InterpolationSystem();
    system.init(context);
  });

  afterEach(() => {
    SoAComponent.resetContext();
  });

  function addInterpolatedEntity(
    position: { x: number; y: number; z: number },
    rotationY = 0,
  ): Entity {
    const entity = new Entity();

    const transform = new TransformComponent(
      entity.id,
      FPVector3.FromFloat(position.x, position.y, position.z),
      FPVector3.FromFloat(0, rotationY, 0),
    );
    const interpolation = new InterpolationComponent(transform.fpPosition, transform.fpRotation);

    entity.addComponent(transform);
    entity.addComponent(interpolation);
    entityManager.addEntity(entity);
    entityManager.onComponentAdded(entity, TRANSFORM_COMPONENT_TYPE);
    entityManager.onComponentAdded(entity, INTERPOLATION_COMPONENT_TYPE);

    return entity;
  }

  it('interpolates position between tick samples', () => {
    const entity = addInterpolatedEntity({ x: 0, y: 0, z: 0 });

    system.capture();
    const transform = entity.getComponent<TransformComponent>(TRANSFORM_COMPONENT_TYPE)!;
    transform.fpPosition = FPVector3.FromFloat(10, 0, 0);

    system.snapshot();
    system.capture();
    system.interpolate(0.5);

    const sample = system.getInterpolatedTransform(entity.id);
    expect(sample?.position.x).toBeCloseTo(5);
    expect(sample?.position.y).toBeCloseTo(0);
    expect(sample?.position.z).toBeCloseTo(0);
  });

  it('interpolates Y rotation with shortest-path wraparound near +PI and -PI', () => {
    const entity = addInterpolatedEntity({ x: 0, y: 0, z: 0 }, Math.PI - 0.1);

    system.capture();
    const transform = entity.getComponent<TransformComponent>(TRANSFORM_COMPONENT_TYPE)!;
    transform.fpRotationY = FP.FromFloat(-Math.PI + 0.1);

    system.snapshot();
    system.capture();
    system.interpolate(0.5);

    const sample = system.getInterpolatedTransform(entity.id);
    expect(sample?.rotation.y).toBeCloseTo(Math.PI, 1);
  });

  it('snaps newly seen entities on first capture instead of lerping from defaults', () => {
    const entity = addInterpolatedEntity({ x: 0, y: 0, z: 0 });

    const transform = entity.getComponent<TransformComponent>(TRANSFORM_COMPONENT_TYPE)!;
    transform.fpPosition = FPVector3.FromFloat(20, 0, 0);

    system.capture();
    system.interpolate(0);

    const sample = system.getInterpolatedTransform(entity.id);
    expect(sample?.position.x).toBeCloseTo(20);
    expect(sample?.position.y).toBeCloseTo(0);
    expect(sample?.position.z).toBeCloseTo(0);
  });

  it('re-snaps entities that leave and re-enter the interpolation query', () => {
    const entity = addInterpolatedEntity({ x: 0, y: 0, z: 0 });
    const interpolation = entity.getComponent<InterpolationComponent>(INTERPOLATION_COMPONENT_TYPE)!;
    const transform = entity.getComponent<TransformComponent>(TRANSFORM_COMPONENT_TYPE)!;

    system.capture();
    transform.fpPosition = FPVector3.FromFloat(5, 0, 0);
    system.snapshot();
    system.capture();

    entity.removeComponent(INTERPOLATION_COMPONENT_TYPE);
    entityManager.onComponentRemoved(entity, INTERPOLATION_COMPONENT_TYPE);
    system.capture();

    transform.fpPosition = FPVector3.FromFloat(30, 0, 0);
    entity.addComponent(interpolation);
    entityManager.onComponentAdded(entity, INTERPOLATION_COMPONENT_TYPE);
    system.capture();
    system.interpolate(0);

    const sample = system.getInterpolatedTransform(entity.id);
    expect(sample?.position.x).toBeCloseTo(30);
  });

  it('lifecycle hooks wire snapshot, capture, and interpolate', () => {
    const entity = addInterpolatedEntity({ x: 0, y: 0, z: 0 });
    const transform = entity.getComponent<TransformComponent>(TRANSFORM_COMPONENT_TYPE)!;

    system.beforeTick(1, [] as unknown as CommandsBatch);
    transform.fpPosition = FPVector3.FromFloat(10, 0, 0);
    system.afterTick(1);

    system.beforeTick(2, [] as unknown as CommandsBatch);
    transform.fpPosition = FPVector3.FromFloat(20, 0, 0);
    system.afterTick(2);

    system.beforeFrame(0.5, 0.016);

    const sample = system.getInterpolatedTransform(entity.id);
    expect(sample?.position.x).toBeCloseTo(15);
  });

  it('exposes samples through getInterpolatedTransform only after interpolate', () => {
    const entity = addInterpolatedEntity({ x: 1, y: 2, z: 3 });
    system.capture();

    expect(system.getInterpolatedTransform(entity.id)).toBeUndefined();

    system.interpolate(1);
    const sample = system.getInterpolatedTransform(entity.id);
    expect(sample?.position.x).toBeCloseTo(1);
    expect(sample?.position.y).toBeCloseTo(2);
    expect(sample?.position.z).toBeCloseTo(3);
  });
});
