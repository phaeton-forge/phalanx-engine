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
import { ExternalPhysicsTickProvider } from '../src/tick/ExternalPhysicsTickProvider';
import type { PhysicsConfig } from '../src/types';

const TestTransformSchema = defineSoASchema({
  fpPositionX: 'i64',
  fpPositionY: 'i64',
  fpPositionZ: 'i64',
}, 'TestTransform_step');

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
    defaultFriction: FP.FromFloat(1.0),
    pushStrength: FP.FromFloat(15.0),
    gridCellSize: FP.FromFloat(4),
    ...overrides,
  };
}

describe('step()', () => {
  let entityManager: EntityManager;
  let eventBus: EventBus;
  let context: SystemContext;

  beforeEach(() => {
    entityManager = new EntityManager();
    eventBus = new EventBus();
    context = new SystemContext(eventBus, entityManager);
    SoAComponent.useEntityManager(entityManager);
  });

  afterEach(() => {
    SoAComponent.resetContext();
  });

  function setupSystem(overrides?: Partial<PhysicsConfig>) {
    const config = createPhysicsConfig(overrides);
    const system = new PhysicsSystem(config);
    system.init(context);

    const physicsStore = entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    const transformStore = entityManager.getOrCreateSoAStore(TestTransformSchema);
    system.setTransformStore(
      transformStore as unknown as SoAComponentStore<Record<string, 'f32' | 'f64' | 'i32' | 'u32' | 'u8' | 'i64'>>,
      FIELD_MAPPING,
    );

    return { system, physicsStore, transformStore };
  }

  function addEntity(
    physicsStore: SoAComponentStore<typeof PhysicsSoASchema.definition>,
    transformStore: SoAComponentStore<typeof TestTransformSchema.definition>,
    entityId: number,
    posX: number,
    posZ: number,
    velX: number = 0,
    velZ: number = 0,
  ): void {
    physicsStore.add(entityId, {
      velocityX: FP.ToRaw(FP.FromFloat(velX)),
      velocityY: FP.ToRaw(FP._0),
      velocityZ: FP.ToRaw(FP.FromFloat(velZ)),
      radius: FP.ToRaw(FP._1),
      mass: FP.ToRaw(FP._1),
      restitution: FP.ToRaw(FP.FromFloat(0.5)),
      friction: FP.ToRaw(FP._1),
      isStatic: 0,
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

  it('step() produces same result as processTick()', () => {
    // Setup two identical systems
    const setupA = (() => {
      const em = new EntityManager();
      const eb = new EventBus();
      const ctx = new SystemContext(eb, em);
      SoAComponent.useEntityManager(em);

      const config = createPhysicsConfig();
      const system = new PhysicsSystem(config);
      system.init(ctx);

      const physicsStore = em.getOrCreateSoAStore(PhysicsSoASchema);
      const transformStore = em.getOrCreateSoAStore(TestTransformSchema);
      system.setTransformStore(
        transformStore as unknown as SoAComponentStore<Record<string, 'f32' | 'f64' | 'i32' | 'u32' | 'u8' | 'i64'>>,
        FIELD_MAPPING,
      );

      physicsStore.add(1, {
        velocityX: FP.ToRaw(FP.FromFloat(10)),
        velocityY: FP.ToRaw(FP._0),
        velocityZ: FP.ToRaw(FP.FromFloat(5)),
        radius: FP.ToRaw(FP._1),
        mass: FP.ToRaw(FP._1),
        restitution: FP.ToRaw(FP.FromFloat(0.5)),
        friction: FP.ToRaw(FP._1),
        isStatic: 0,
        ignorePhysics: 0,
        lastX: 0,
        lastZ: 0,
      });
      transformStore.add(1, {
        fpPositionX: FP.ToRaw(FP._0),
        fpPositionY: FP.ToRaw(FP._0),
        fpPositionZ: FP.ToRaw(FP._0),
      });

      SoAComponent.resetContext();
      return { system, transformStore };
    })();

    const setupB = (() => {
      const em = new EntityManager();
      const eb = new EventBus();
      const ctx = new SystemContext(eb, em);
      SoAComponent.useEntityManager(em);

      const config = createPhysicsConfig();
      const system = new PhysicsSystem(config);
      system.init(ctx);

      const physicsStore = em.getOrCreateSoAStore(PhysicsSoASchema);
      const transformStore = em.getOrCreateSoAStore(TestTransformSchema);
      system.setTransformStore(
        transformStore as unknown as SoAComponentStore<Record<string, 'f32' | 'f64' | 'i32' | 'u32' | 'u8' | 'i64'>>,
        FIELD_MAPPING,
      );

      physicsStore.add(1, {
        velocityX: FP.ToRaw(FP.FromFloat(10)),
        velocityY: FP.ToRaw(FP._0),
        velocityZ: FP.ToRaw(FP.FromFloat(5)),
        radius: FP.ToRaw(FP._1),
        mass: FP.ToRaw(FP._1),
        restitution: FP.ToRaw(FP.FromFloat(0.5)),
        friction: FP.ToRaw(FP._1),
        isStatic: 0,
        ignorePhysics: 0,
        lastX: 0,
        lastZ: 0,
      });
      transformStore.add(1, {
        fpPositionX: FP.ToRaw(FP._0),
        fpPositionY: FP.ToRaw(FP._0),
        fpPositionZ: FP.ToRaw(FP._0),
      });

      SoAComponent.resetContext();
      return { system, transformStore };
    })();

    // Run step() on A, processTick() on B
    setupA.system.step();
    setupB.system.processTick(1);

    const idxA = setupA.transformStore.indexOf(1);
    const idxB = setupB.transformStore.indexOf(1);

    const posAX = setupA.transformStore.arrays.fpPositionX[idxA];
    const posAZ = setupA.transformStore.arrays.fpPositionZ[idxA];
    const posBX = setupB.transformStore.arrays.fpPositionX[idxB];
    const posBZ = setupB.transformStore.arrays.fpPositionZ[idxB];

    expect(posAX).toBe(posBX);
    expect(posAZ).toBe(posBZ);
  });

  it('processTick is no-op when provider is set', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    addEntity(physicsStore, transformStore, 1, 0, 0, 10, 0);

    const provider = new ExternalPhysicsTickProvider();
    system.setTickProvider(provider);

    // processTick should be a no-op now
    system.processTick(1);

    const txIdx = transformStore.indexOf(1);
    const posX = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[txIdx]));
    expect(posX).toBeCloseTo(0, 5); // unchanged

    // But provider.tick() should advance simulation
    provider.tick();

    const posXAfter = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[txIdx]));
    expect(posXAfter).toBeCloseTo(0.5, 1); // vel=10, dt=0.05
  });

  it('step() can be called directly', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    addEntity(physicsStore, transformStore, 1, 0, 0, 10, 0);

    system.step();

    const txIdx = transformStore.indexOf(1);
    const posX = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[txIdx]));
    expect(posX).toBeCloseTo(0.5, 1);
  });
});
