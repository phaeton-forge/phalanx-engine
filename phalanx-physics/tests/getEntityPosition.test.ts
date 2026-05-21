import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { FP } from 'phalanx-math';
import {
  EntityManager,
  EventBus,
  SystemContext,
  SoAComponent,
  defineSoASchema,
  type SoAComponentStore,
} from 'phalanx-ecs';
import { PhysicsSystem } from '../src/systems/PhysicsSystem';
import { PhysicsSoASchema } from '../src/components/PhysicsBodyComponent';
import { PhysicsWorld } from '../src/PhysicsWorld';
import { createPhysicsSpatialQuery } from '../src/spatial/createPhysicsSpatialQuery';
import type { PhysicsConfig } from '../src/types';

const TestTransformSchema = defineSoASchema(
  {
    fpPositionX: 'i64',
    fpPositionY: 'i64',
    fpPositionZ: 'i64',
  },
  'TestTransform'
);

const FIELD_MAPPING = {
  fpPositionX: 'fpPositionX',
  fpPositionY: 'fpPositionY',
  fpPositionZ: 'fpPositionZ',
};

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
    const transformStore = entityManager.getOrCreateSoAStore(TestTransformSchema);
    system.setTransformStore(
      transformStore as unknown as SoAComponentStore<Record<string, 'f32' | 'f64' | 'i32' | 'u32' | 'u8' | 'i64'>>,
      FIELD_MAPPING
    );

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
      lastX: 0,
      lastZ: 0,
    });
    transformStore.add(1, {
      fpPositionX: FP.ToRaw(FP.FromFloat(7)),
      fpPositionY: FP.ToRaw(FP._0),
      fpPositionZ: FP.ToRaw(FP.FromFloat(9)),
    });

    const pos = system.getEntityPosition(1);
    expect(pos).toBeDefined();
    expect(FP.ToFloat(pos!.x)).toBeCloseTo(7, 5);
    expect(FP.ToFloat(pos!.z)).toBeCloseTo(9, 5);
    expect(system.getEntityPosition(999)).toBeUndefined();
  });

  it('createPhysicsSpatialQuery delegates to PhysicsWorld', () => {
    const world = new PhysicsWorld({ tickRate: 20, gridCellSize: FP.FromFloat(4) });
    const { physicsSystem } = world.getSystems();
    const entityManager = new EntityManager();
    const context = new SystemContext(new EventBus(), entityManager);
    SoAComponent.useEntityManager(entityManager);
    physicsSystem.init(context);

    const physicsStore = entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    const transformStore = entityManager.getOrCreateSoAStore(TestTransformSchema);
    world.setTransformStore(
      transformStore as unknown as SoAComponentStore<Record<string, 'f32' | 'f64' | 'i32' | 'u32' | 'u8' | 'i64'>>,
      FIELD_MAPPING
    );

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
      lastX: 0,
      lastZ: 0,
    });
    transformStore.add(2, {
      fpPositionX: FP.ToRaw(FP.FromFloat(1)),
      fpPositionY: FP.ToRaw(FP._0),
      fpPositionZ: FP.ToRaw(FP.FromFloat(2)),
    });

    const adapter = createPhysicsSpatialQuery(world);
    expect(FP.ToFloat(adapter.getEntityPosition(2)!.x)).toBeCloseTo(1, 5);
    expect(FP.ToFloat(adapter.getEntityPosition(2)!.z)).toBeCloseTo(2, 5);

    SoAComponent.resetContext();
  });
});
