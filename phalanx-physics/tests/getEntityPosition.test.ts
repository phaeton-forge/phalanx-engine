import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { FP } from '@phalanx-engine/math';
import {
  EntityManager,
  EventBus,
  SystemContext,
  SoAComponent,
} from '@phalanx-engine/ecs';
import { PhysicsSystem } from '../src/systems/PhysicsSystem';
import { PhysicsSoASchema } from '../src/components/PhysicsBodyComponent';
import { TransformSoASchema } from '../src/components/TransformComponent';
import { PhysicsWorld } from '../src/PhysicsWorld';
import type { PhysicsConfig } from '../src/types';
import { addTransformRow } from './testTransformHelpers';

function createPhysicsConfig(): PhysicsConfig {
  return {
    tickDt: FP.FromFloat(0.05),
    subSteps: 1,
    maxVelocity: FP.FromFloat(100),
    defaultFriction: FP.FromFloat(0.92),
    pushStrength: FP.FromFloat(15.0),
    gridCellSize: FP.FromFloat(4),
  };
}

describe('getEntityPosition', () => {
  let entityManager: EntityManager;
  let context: SystemContext;

  beforeEach(() => {
    entityManager = new EntityManager();
    context = new SystemContext(new EventBus(), entityManager);
    SoAComponent.useEntityManager(entityManager);
  });

  afterEach(() => {
    SoAComponent.resetContext();
  });

  it('PhysicsSystem returns fixed-point transform positions', () => {
    const system = new PhysicsSystem(createPhysicsConfig());
    system.init(context);
    const physicsStore = entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    const transformStore = entityManager.getOrCreateSoAStore(TransformSoASchema);

    physicsStore.add(1, {
      velocityX: FP.ToRaw(FP._0),
      velocityY: FP.ToRaw(FP._0),
      velocityZ: FP.ToRaw(FP._0),
      radius: FP.ToRaw(FP._1),
      mass: FP.ToRaw(FP._1),
      restitution: FP.ToRaw(FP.FromFloat(0.5)),
      friction: FP.ToRaw(FP.FromFloat(0.3)),
      isStatic: 0,
      ignorePhysics: 0,
      useGravity: 0,
      lastX: 0,
      lastZ: 0,
    });
    addTransformRow(transformStore, 1, 7, 9);

    const pos = system.getEntityPosition(1);
    expect(pos).toBeDefined();
    expect(FP.ToFloat(pos!.x)).toBeCloseTo(7, 5);
    expect(FP.ToFloat(pos!.z)).toBeCloseTo(9, 5);
    expect(system.getEntityPosition(999)).toBeUndefined();
  });

  it('PhysicsWorld delegates getEntityPosition to PhysicsSystem', () => {
    const physicsWorld = new PhysicsWorld();
    const { physicsSystem } = physicsWorld.getSystems();
    physicsSystem.init(context);

    const physicsStore = entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    const transformStore = entityManager.getOrCreateSoAStore(TransformSoASchema);

    physicsStore.add(2, {
      velocityX: FP.ToRaw(FP._0),
      velocityY: FP.ToRaw(FP._0),
      velocityZ: FP.ToRaw(FP._0),
      radius: FP.ToRaw(FP._1),
      mass: FP.ToRaw(FP._1),
      restitution: FP.ToRaw(FP.FromFloat(0.5)),
      friction: FP.ToRaw(FP.FromFloat(0.3)),
      isStatic: 0,
      ignorePhysics: 0,
      useGravity: 0,
      lastX: 0,
      lastZ: 0,
    });
    addTransformRow(transformStore, 2, 3, 4);

    const pos = physicsWorld.getEntityPosition(2);
    expect(pos).toBeDefined();
    expect(FP.ToFloat(pos!.x)).toBeCloseTo(3, 5);
    expect(FP.ToFloat(pos!.z)).toBeCloseTo(4, 5);
  });
});
