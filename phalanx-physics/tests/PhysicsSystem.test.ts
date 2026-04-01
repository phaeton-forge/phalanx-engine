import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
import type { PhysicsConfig } from '../src/types';

// A minimal transform schema for testing
const TestTransformSchema = defineSoASchema({
  fpPositionX: 'i64',
  fpPositionY: 'i64',
  fpPositionZ: 'i64',
}, 'TestTransform');

const FIELD_MAPPING = {
  fpPositionX: 'fpPositionX',
  fpPositionY: 'fpPositionY',
  fpPositionZ: 'fpPositionZ',
};

function createPhysicsConfig(overrides?: Partial<PhysicsConfig>): PhysicsConfig {
  return {
    tickDt: FP.FromFloat(0.05),
    subSteps: 1,
    maxVelocity: FP.FromFloat(100),
    ...overrides,
  };
}

describe('PhysicsSystem', () => {
  let entityManager: EntityManager;
  let eventBus: EventBus;
  let context: SystemContext;

  beforeEach(() => {
    entityManager = new EntityManager();
    eventBus = new EventBus();
    context = new SystemContext(eventBus, entityManager);
    // Set global EntityManager so SoAComponent can resolve stores
    SoAComponent.useEntityManager(entityManager);
  });

  afterEach(() => {
    SoAComponent.resetContext();
  });

  function setupSystem(overrides?: Partial<PhysicsConfig>): {
    system: PhysicsSystem;
    physicsStore: SoAComponentStore<typeof PhysicsSoASchema.definition>;
    transformStore: SoAComponentStore<typeof TestTransformSchema.definition>;
  } {
    const config = createPhysicsConfig(overrides);
    const system = new PhysicsSystem(config);
    system.init(context);

    const physicsStore = entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    const transformStore = entityManager.getOrCreateSoAStore(TestTransformSchema);
    system.setTransformStore(transformStore as unknown as SoAComponentStore<Record<string, 'f32' | 'f64' | 'i32' | 'u32' | 'u8' | 'i64'>>, FIELD_MAPPING);

    return { system, physicsStore, transformStore };
  }

  function addEntity(
    physicsStore: SoAComponentStore<typeof PhysicsSoASchema.definition>,
    transformStore: SoAComponentStore<typeof TestTransformSchema.definition>,
    entityId: number,
    posX: number, posZ: number,
    velX: number = 0, velZ: number = 0,
    isStatic: boolean = false,
  ): void {
    physicsStore.add(entityId, {
      velocityX: FP.ToRaw(FP.FromFloat(velX)),
      velocityY: FP.ToRaw(FP._0),
      velocityZ: FP.ToRaw(FP.FromFloat(velZ)),
      radius: FP.ToRaw(FP._1),
      mass: FP.ToRaw(FP._1),
      restitution: FP.ToRaw(FP.FromFloat(0.5)),
      friction: FP.ToRaw(FP.FromFloat(0.3)),
      isStatic: isStatic ? 1 : 0,
      ignorePhysics: 0,
      lastX: 0,
      lastZ: 0,
    });
    transformStore.add(entityId, {
      fpPositionX: FP.ToRaw(FP.FromFloat(posX)),
      fpPositionY: FP.ToRaw(FP._0),
      fpPositionZ: FP.ToRaw(FP.FromFloat(posZ)),
    });
  }

  it('moves entity with velocity after processTick', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    addEntity(physicsStore, transformStore, 1, 0, 0, 10, 0);

    system.processTick(1);

    const idx = transformStore.indexOf(1);
    const newX = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[idx]));
    // vel=10, dt=0.05, subSteps=1 -> displacement = 10 * 0.05 = 0.5
    expect(newX).toBeCloseTo(0.5, 1);
  });

  it('static entities do not move', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    addEntity(physicsStore, transformStore, 1, 5, 5, 10, 10, true);

    system.processTick(1);

    const idx = transformStore.indexOf(1);
    const posX = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[idx]));
    expect(posX).toBeCloseTo(5, 1);
  });

  it('ignorePhysics flag skips entity', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    addEntity(physicsStore, transformStore, 1, 0, 0, 10, 0);

    // Set ignorePhysics flag
    const physIdx = physicsStore.indexOf(1);
    physicsStore.arrays.ignorePhysics[physIdx] = 1;

    system.processTick(1);

    const txIdx = transformStore.indexOf(1);
    const posX = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[txIdx]));
    expect(posX).toBeCloseTo(0, 1);
  });

  it('clamps velocity to maxVelocity', () => {
    const { system, physicsStore, transformStore } = setupSystem({
      maxVelocity: FP.FromFloat(5),
    });
    addEntity(physicsStore, transformStore, 1, 0, 0, 100, 0);

    system.processTick(1);

    // Velocity should be clamped to 5, displacement = 5 * 0.05 = 0.25
    const idx = transformStore.indexOf(1);
    const posX = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[idx]));
    expect(posX).toBeCloseTo(0.25, 1);
  });

  it('clamps position to world bounds', () => {
    const { system, physicsStore, transformStore } = setupSystem({
      worldBounds: {
        minX: FP.FromFloat(-10),
        minZ: FP.FromFloat(-10),
        maxX: FP.FromFloat(10),
        maxZ: FP.FromFloat(10),
      },
    });
    addEntity(physicsStore, transformStore, 1, 9.9, 0, 100, 0);

    system.processTick(1);

    const idx = transformStore.indexOf(1);
    const posX = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[idx]));
    expect(posX).toBeLessThanOrEqual(10);
  });

  it('sub-stepping divides dt correctly', () => {
    // With 2 sub-steps and dt=0.05, each sub-step is 0.025
    // vel=10, total displacement = 10 * 0.025 * 2 = 0.5
    const { system, physicsStore, transformStore } = setupSystem({ subSteps: 2 });
    addEntity(physicsStore, transformStore, 1, 0, 0, 10, 0);

    system.processTick(1);

    const idx = transformStore.indexOf(1);
    const posX = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[idx]));
    expect(posX).toBeCloseTo(0.5, 1);
  });
});
