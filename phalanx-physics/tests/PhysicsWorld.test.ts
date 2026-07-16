import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Entity, EntityManager, EventBus, SoAComponent, SystemContext } from '@phalanx-engine/ecs';
import { FPVector3, FPQuaternion } from '@phalanx-engine/math';
import { FP } from '@phalanx-engine/math';
import { PhysicsWorld } from '../src/PhysicsWorld';
import { PhysicsSystem } from '../src/systems/PhysicsSystem';
import { GravitySystem } from '../src/systems/GravitySystem';
import { InterpolationSystem } from '../src/systems/InterpolationSystem';
import { TransformComponent, TRANSFORM_COMPONENT_TYPE } from '../src/components/TransformComponent';
import {
  InterpolationComponent,
  INTERPOLATION_COMPONENT_TYPE,
} from '../src/components/InterpolationComponent';

describe('PhysicsWorld', () => {
  let entityManager: EntityManager;
  let context: SystemContext;

  beforeEach(() => {
    entityManager = new EntityManager();
    entityManager.registerComponentTypes([
      TRANSFORM_COMPONENT_TYPE,
      INTERPOLATION_COMPONENT_TYPE,
    ]);
    SoAComponent.useEntityManager(entityManager);
    context = new SystemContext(new EventBus(), entityManager);
  });

  afterEach(() => {
    SoAComponent.resetContext();
  });

  it('getSystems returns both physics and interpolation systems', () => {
    const physicsWorld = new PhysicsWorld();
    const { physicsSystem, interpolationSystem } = physicsWorld.getSystems();

    expect(physicsSystem).toBeInstanceOf(PhysicsSystem);
    expect(interpolationSystem).toBeInstanceOf(InterpolationSystem);
  });

  it('getSystems exposes a gravitySystem (backward-compatible destructure)', () => {
    const physicsWorld = new PhysicsWorld({ gravity: FP.FromFloat(9.8) });
    const { gravitySystem } = physicsWorld.getSystems();

    expect(gravitySystem).toBeInstanceOf(GravitySystem);
    expect(FP.ToFloat(gravitySystem.getGravity())).toBeCloseTo(9.8, 3);
    expect(gravitySystem.getGravityAxis()).toBe('y');
  });

  it('defaults gravity to 0 (GravitySystem no-op) when not configured', () => {
    const physicsWorld = new PhysicsWorld();
    const { gravitySystem } = physicsWorld.getSystems();

    expect(FP.ToFloat(gravitySystem.getGravity())).toBe(0);
  });

  it('applyImpulse3D delegates to PhysicsSystem and sets all three axes', () => {
    const physicsWorld = new PhysicsWorld();
    const { physicsSystem } = physicsWorld.getSystems();
    physicsSystem.init(context);

    const physicsStore = physicsSystem.getPhysicsStore();
    physicsStore.add(1, {
      velocityX: FP.ToRaw(FP._0),
      velocityY: FP.ToRaw(FP._0),
      velocityZ: FP.ToRaw(FP._0),
      radius: FP.ToRaw(FP._1),
      mass: FP.ToRaw(FP._1),
      restitution: FP.ToRaw(FP.FromFloat(0.5)),
      friction: FP.ToRaw(FP._1),
      isStatic: 0,
      ignorePhysics: 0,
      useGravity: 0,
      lastX: 0,
      lastZ: 0,
    });

    physicsWorld.applyImpulse3D(1, FP.FromFloat(1), FP.FromFloat(2), FP.FromFloat(3));

    const idx = physicsStore.indexOf(1);
    expect(FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityX[idx]))).toBeCloseTo(1, 4);
    expect(FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityY[idx]))).toBeCloseTo(2, 4);
    expect(FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityZ[idx]))).toBeCloseTo(3, 4);
  });

  it('getInterpolatedTransform delegates to the owned interpolation system', () => {
    const physicsWorld = new PhysicsWorld();
    const { interpolationSystem } = physicsWorld.getSystems();
    interpolationSystem.init(context);

    const entity = new Entity();
    const transform = new TransformComponent(
      entity.id,
      FPVector3.FromFloat(0, 0, 0),
      FPQuaternion.Identity(),
    );
    const interpolation = new InterpolationComponent(transform.fpPosition, transform.fpRotation);
    entity.addComponent(transform);
    entity.addComponent(interpolation);
    entityManager.addEntity(entity);
    entityManager.onComponentAdded(entity, TRANSFORM_COMPONENT_TYPE);
    entityManager.onComponentAdded(entity, INTERPOLATION_COMPONENT_TYPE);

    transform.fpPosition = FPVector3.FromFloat(10, 0, 0);

    interpolationSystem.snapshot();
    interpolationSystem.capture();
    transform.fpPosition = FPVector3.FromFloat(20, 0, 0);
    interpolationSystem.capture();
    interpolationSystem.interpolate(0.5);

    const sample = physicsWorld.getInterpolatedTransform(entity.id);
    expect(sample).toBeDefined();
    expect(sample!.position.x).toBeCloseTo(15, 5);
    expect(sample!.position.y).toBeCloseTo(0, 5);
    expect(sample!.position.z).toBeCloseTo(0, 5);
  });

  it('does not expose setTransformStore', () => {
    const physicsWorld = new PhysicsWorld();
    expect('setTransformStore' in physicsWorld).toBe(false);
  });

  it('getInterpolatedTransform returns undefined for unknown entities', () => {
    const physicsWorld = new PhysicsWorld();
    const { interpolationSystem } = physicsWorld.getSystems();
    interpolationSystem.init(context);

    expect(physicsWorld.getInterpolatedTransform(999)).toBeUndefined();
  });
});
