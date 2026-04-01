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
    defaultFriction: FP.FromFloat(0.92),
    pushStrength: FP.FromFloat(15.0),
    gridCellSize: FP.FromFloat(4),
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

    // Set friction to 1.0 (no damping) to isolate integration behavior
    const physIdx = physicsStore.indexOf(1);
    physicsStore.arrays.friction[physIdx] = FP.ToRaw(FP._1);

    system.processTick(1);

    const idx = transformStore.indexOf(1);
    const posX = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[idx]));
    expect(posX).toBeCloseTo(0.5, 1);
  });

  it('collision detection runs inside each sub-step (no tunneling)', () => {
    // Two circles (radius=1) moving toward each other at high velocity.
    // With 3 sub-steps, they must not tunnel through each other.
    const { system, physicsStore, transformStore } = setupSystem({
      subSteps: 3,
      maxVelocity: FP.FromFloat(100),
    });
    // Entity 1 at x=0, moving right; Entity 2 at x=3, moving left
    addEntity(physicsStore, transformStore, 1, 0, 0, 20, 0);
    addEntity(physicsStore, transformStore, 2, 3, 0, -20, 0);

    system.processTick(1);

    const idx1 = transformStore.indexOf(1);
    const idx2 = transformStore.indexOf(2);
    const pos1X = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[idx1]));
    const pos2X = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[idx2]));

    // After collision resolution, entity 1 should be to the left of entity 2
    expect(pos1X).toBeLessThan(pos2X);
  });

  it('two overlapping circles are pushed apart via collision resolution', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    // Two entities with radius 1, distance 1 apart (overlap 1)
    addEntity(physicsStore, transformStore, 1, 0, 0, 0, 0);
    addEntity(physicsStore, transformStore, 2, 1, 0, 0, 0);

    system.processTick(1);

    const idx1 = transformStore.indexOf(1);
    const idx2 = transformStore.indexOf(2);
    const pos1X = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[idx1]));
    const pos2X = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[idx2]));

    // They should be pushed apart
    expect(pos1X).toBeLessThan(0);
    expect(pos2X).toBeGreaterThan(1);
  });

  it('emits collision events via EventBus', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    addEntity(physicsStore, transformStore, 1, 0, 0, 0, 0);
    addEntity(physicsStore, transformStore, 2, 1, 0, 0, 0);

    const events: CollisionEvent[] = [];
    eventBus.on<CollisionEvent>(PhysicsEvents.COLLISION, (e) => events.push(e));

    system.processTick(1);

    expect(events.length).toBe(1);
    expect(events[0].entityA).toBe(1);
    expect(events[0].entityB).toBe(2);
    expect(events[0].manifold).toBeDefined();
  });

  it('friction with subSteps=3 gives effective friction of ~0.92^3', () => {
    // With subSteps=3 and friction=0.92, effective per-tick friction = 0.92^3 ≈ 0.778
    const { system, physicsStore, transformStore } = setupSystem({
      subSteps: 3,
      defaultFriction: FP.FromFloat(0.92),
    });
    addEntity(physicsStore, transformStore, 1, 0, 0, 10, 0);

    // Set friction to 0 so it uses defaultFriction
    const physIdx = physicsStore.indexOf(1);
    physicsStore.arrays.friction[physIdx] = 0n;

    system.processTick(1);

    // After one tick, velocity should be ~10 * 0.92^3 ≈ 7.78
    const velX = FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityX[physIdx]));
    const expected = 10 * Math.pow(0.92, 3);
    expect(velX).toBeCloseTo(expected, 0);
  });

  it('per-entity friction field is used when non-zero', () => {
    const { system, physicsStore, transformStore } = setupSystem({
      subSteps: 1,
      defaultFriction: FP.FromFloat(0.92),
    });
    addEntity(physicsStore, transformStore, 1, 0, 0, 10, 0);

    // Set explicit per-entity friction of 0.5
    const physIdx = physicsStore.indexOf(1);
    physicsStore.arrays.friction[physIdx] = FP.ToRaw(FP.FromFloat(0.5));

    system.processTick(1);

    const velX = FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityX[physIdx]));
    // With friction=0.5 and 1 sub-step: velocity ≈ 10 * 0.5 = 5
    expect(velX).toBeCloseTo(5, 0);
  });

  it('collision filter can skip pairs', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    addEntity(physicsStore, transformStore, 1, 0, 0, 0, 0);
    addEntity(physicsStore, transformStore, 2, 1, 0, 0, 0);

    // Filter: skip all collisions
    system.setCollisionFilter(() => false);

    const events: CollisionEvent[] = [];
    eventBus.on<CollisionEvent>(PhysicsEvents.COLLISION, (e) => events.push(e));

    system.processTick(1);

    expect(events.length).toBe(0);
  });
});
