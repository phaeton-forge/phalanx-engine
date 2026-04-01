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
import { PhysicsEvents } from '../src/events';
import type { PhysicsConfig, CollisionEvent } from '../src/types';

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
    defaultFriction: FP.FromFloat(0.92),
    pushStrength: FP.FromFloat(15.0),
    gridCellSize: FP.FromFloat(4),
    ...overrides,
  };
}

/**
 * Collision tests — now tested through PhysicsSystem which owns the full pipeline.
 * CollisionSystem is no longer a standalone GameSystem.
 */
describe('Collision (via PhysicsSystem)', () => {
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
    system.setTransformStore(
      transformStore as unknown as SoAComponentStore<Record<string, 'f32' | 'f64' | 'i32' | 'u32' | 'u8' | 'i64'>>,
      FIELD_MAPPING
    );

    return { system, physicsStore, transformStore };
  }

  function addEntity(
    physicsStore: SoAComponentStore<typeof PhysicsSoASchema.definition>,
    transformStore: SoAComponentStore<typeof TestTransformSchema.definition>,
    entityId: number,
    posX: number, posZ: number,
    radius: number = 1,
    isStatic: boolean = false,
  ): void {
    physicsStore.add(entityId, {
      velocityX: FP.ToRaw(FP._0),
      velocityY: FP.ToRaw(FP._0),
      velocityZ: FP.ToRaw(FP._0),
      radius: FP.ToRaw(FP.FromFloat(radius)),
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

  it('two overlapping circles are pushed apart', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    // Two entities with radius 1, distance 1 apart (overlap 1)
    addEntity(physicsStore, transformStore, 1, 0, 0, 1);
    addEntity(physicsStore, transformStore, 2, 1, 0, 1);

    system.processTick(1);

    const idx1 = transformStore.indexOf(1);
    const idx2 = transformStore.indexOf(2);
    const pos1X = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[idx1]));
    const pos2X = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[idx2]));

    // They should be pushed apart: entity 1 moves left, entity 2 moves right
    expect(pos1X).toBeLessThan(0);
    expect(pos2X).toBeGreaterThan(1);
  });

  it('static vs dynamic: only dynamic entity moves', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    addEntity(physicsStore, transformStore, 1, 0, 0, 1, true); // static
    addEntity(physicsStore, transformStore, 2, 1, 0, 1, false); // dynamic

    system.processTick(1);

    const idx1 = transformStore.indexOf(1);
    const idx2 = transformStore.indexOf(2);
    const pos1X = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[idx1]));
    const pos2X = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[idx2]));

    // Static entity should not move
    expect(pos1X).toBeCloseTo(0, 1);
    // Dynamic entity should be pushed away
    expect(pos2X).toBeGreaterThan(1);
  });

  it('emits collision events via EventBus', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    addEntity(physicsStore, transformStore, 1, 0, 0, 1);
    addEntity(physicsStore, transformStore, 2, 1, 0, 1);

    const events: CollisionEvent[] = [];
    eventBus.on<CollisionEvent>(PhysicsEvents.COLLISION, (e) => events.push(e));

    system.processTick(1);

    expect(events.length).toBe(1);
    expect(events[0].entityA).toBe(1);
    expect(events[0].entityB).toBe(2);
    expect(events[0].manifold).toBeDefined();
  });

  it('non-colliding entities produce no events', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    addEntity(physicsStore, transformStore, 1, 0, 0, 1);
    addEntity(physicsStore, transformStore, 2, 100, 100, 1);

    const events: CollisionEvent[] = [];
    eventBus.on<CollisionEvent>(PhysicsEvents.COLLISION, (e) => events.push(e));

    system.processTick(1);

    expect(events.length).toBe(0);
  });

  it('skips entities with ignorePhysics flag', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    addEntity(physicsStore, transformStore, 1, 0, 0, 1);
    addEntity(physicsStore, transformStore, 2, 0.5, 0, 1);

    // Set ignorePhysics on entity 2
    const idx = physicsStore.indexOf(2);
    physicsStore.arrays.ignorePhysics[idx] = 1;

    const events: CollisionEvent[] = [];
    eventBus.on<CollisionEvent>(PhysicsEvents.COLLISION, (e) => events.push(e));

    system.processTick(1);

    expect(events.length).toBe(0);
  });
});
