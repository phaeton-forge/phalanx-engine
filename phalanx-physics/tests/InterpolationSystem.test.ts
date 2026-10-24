import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  Entity,
  type EntityManager,
  type SystemContext,
} from '@phalanx-engine/ecs';
import { physicsTestWorld } from './support/physicsTestWorld.js';
import { FP, FPVector3, FPQuaternion } from '@phalanx-engine/math';
import {
  attachTransform,
  writeFpPosition,
  writeYaw,
  Transform,
} from '../src/components/transform';
import {
  attachInterpolation,
  interpolationOf,
  Interpolation,
} from '../src/components/interpolation';
import { InterpolationSystem } from '../src/systems/InterpolationSystem';

describe('InterpolationSystem', () => {
  let entityManager: EntityManager;
  let system: InterpolationSystem;

  beforeEach(() => {
    let context: SystemContext;
    ({ entityManager, context } = physicsTestWorld());
    system = new InterpolationSystem();
    system.init(context);
  });

  function addInterpolatedEntity(
    position: { x: number; y: number; z: number },
    rotationY = 0
  ): Entity {
    const entity = new Entity(entityManager.allocateEntityId());
    const fpPosition = FPVector3.FromFloat(position.x, position.y, position.z);
    const fpRotation = FPQuaternion.FromAxisAngle(
      FPVector3.Up,
      FP.FromFloat(rotationY)
    );
    attachTransform(entity, fpPosition, fpRotation);
    attachInterpolation(entity, fpPosition, fpRotation);
    entityManager.addEntity(entity);
    entityManager.onComponentAdded(entity, Transform.type);
    entityManager.onComponentAdded(entity, Interpolation.type);
    return entity;
  }

  it('interpolates position between tick samples', () => {
    const entity = addInterpolatedEntity({ x: 0, y: 0, z: 0 });

    system.capture();
    writeFpPosition(entity, FPVector3.FromFloat(10, 0, 0));

    system.snapshot();
    system.capture();
    system.interpolate(0.5);

    const sample = system.getInterpolatedTransform(entity.id);
    expect(sample?.position.x).toBeCloseTo(5);
    expect(sample?.position.y).toBeCloseTo(0);
    expect(sample?.position.z).toBeCloseTo(0);
  });

  it('slerps rotation and yields a normalized quaternion at t = 0.5', () => {
    const entity = addInterpolatedEntity({ x: 0, y: 0, z: 0 }, 0);

    system.capture();
    writeYaw(entity, FP.FromFloat(Math.PI / 2));

    system.snapshot();
    system.capture();
    system.interpolate(0.5);

    const sample = system.getInterpolatedTransform(entity.id);
    const r = sample!.rotation;
    const magnitude = Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z + r.w * r.w);
    expect(magnitude).toBeCloseTo(1, 1);

    const expected = FPQuaternion.ToFloat(
      FPQuaternion.FromAxisAngle(FPVector3.Up, FP.FromFloat(Math.PI / 4))
    );
    expect(r.y).toBeCloseTo(expected.y, 1);
    expect(r.w).toBeCloseTo(expected.w, 1);
  });

  it('snaps newly seen entities on first capture instead of lerping from defaults', () => {
    const entity = addInterpolatedEntity({ x: 0, y: 0, z: 0 });
    writeFpPosition(entity, FPVector3.FromFloat(20, 0, 0));

    system.capture();
    system.interpolate(0);

    const sample = system.getInterpolatedTransform(entity.id);
    expect(sample?.position.x).toBeCloseTo(20);
    expect(sample?.position.y).toBeCloseTo(0);
    expect(sample?.position.z).toBeCloseTo(0);
  });

  it('re-snaps entities that leave and re-enter the interpolation query', () => {
    const entity = addInterpolatedEntity({ x: 0, y: 0, z: 0 });
    const interpolation = entity.getComponent(Interpolation.type)!;

    system.capture();
    writeFpPosition(entity, FPVector3.FromFloat(5, 0, 0));
    system.snapshot();
    system.capture();

    entity.removeComponent(Interpolation.type);
    entityManager.onComponentRemoved(entity, Interpolation.type);
    system.capture();

    writeFpPosition(entity, FPVector3.FromFloat(30, 0, 0));
    entity.addComponent(interpolation);
    entityManager.onComponentAdded(entity, Interpolation.type);
    system.capture();
    system.interpolate(0);

    const sample = system.getInterpolatedTransform(entity.id);
    expect(sample?.position.x).toBeCloseTo(30);
    expect(interpolationOf(entity)).toBeDefined();
  });

  it('afterTick snapshots then captures so the previous sample is the last pose', () => {
    const entity = addInterpolatedEntity({ x: 0, y: 0, z: 0 });

    writeFpPosition(entity, FPVector3.FromFloat(10, 0, 0));
    system.afterTick(1);

    writeFpPosition(entity, FPVector3.FromFloat(20, 0, 0));
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
