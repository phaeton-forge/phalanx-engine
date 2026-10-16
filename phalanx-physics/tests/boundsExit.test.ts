import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FP } from '@phalanx-engine/math';
import {
  EntityManager,
  EventBus,
  SystemContext,
  SoAComponent,
  type SoAComponentStore,
} from '@phalanx-engine/ecs';
import { PhysicsSystem } from '../src/systems/PhysicsSystem';
import { PhysicsSoASchema } from '../src/components/PhysicsBodyComponent';
import { TransformSoASchema } from '../src/components/TransformComponent';
import { PhysicsEvents } from '../src/events';
import type { PhysicsConfig, BoundsExitEvent } from '../src/types';
import { addTransformRow } from './testTransformHelpers';

const BOUNDS = {
  minX: FP.FromFloat(-10),
  minZ: FP.FromFloat(-10),
  maxX: FP.FromFloat(10),
  maxZ: FP.FromFloat(10),
};

function createPhysicsConfig(overrides?: Partial<PhysicsConfig>): PhysicsConfig {
  return {
    tickDt: FP.FromFloat(0.05),
    subSteps: 1,
    maxVelocity: FP.FromFloat(1000),
    defaultFriction: FP.FromFloat(1.0),
    pushStrength: FP.FromFloat(15.0),
    gridCellSize: FP.FromFloat(4),
    worldBounds: BOUNDS,
    ...overrides,
  };
}

describe('boundsExit', () => {
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
    const transformStore = entityManager.getOrCreateSoAStore(TransformSoASchema);

    return { system, physicsStore, transformStore };
  }

  function addEntity(
    physicsStore: SoAComponentStore<typeof PhysicsSoASchema.definition>,
    transformStore: SoAComponentStore<typeof TransformSoASchema.definition>,
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
      useGravity: 0,
      gravityMultiplier: FP.ToRaw(FP._1),
      lastX: 0,
      lastZ: 0,
    });
    addTransformRow(transformStore, entityId, posX, posZ);
  }

  it('ejects body and emits BOUNDS_EXIT when ejectOnBoundsExit is true', () => {
    const { system, physicsStore, transformStore } = setupSystem({
      ejectOnBoundsExit: true,
    });
    // Entity near edge, moving fast to exit bounds
    addEntity(physicsStore, transformStore, 1, 9.9, 0, 500, 0);

    const events: BoundsExitEvent[] = [];
    eventBus.on<BoundsExitEvent>(PhysicsEvents.BOUNDS_EXIT, (e) => events.push(e));

    system.step();

    expect(events.length).toBe(1);
    expect(events[0].entityId).toBe(1);
  });

  it('ejected body gets ignorePhysics=1 and zeroed velocity', () => {
    const { system, physicsStore, transformStore } = setupSystem({
      ejectOnBoundsExit: true,
    });
    addEntity(physicsStore, transformStore, 1, 9.9, 0, 500, 0);

    system.step();

    const idx = physicsStore.indexOf(1);
    expect(physicsStore.arrays.ignorePhysics[idx]).toBe(1);
    expect(FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityX[idx]))).toBe(0);
    expect(FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityZ[idx]))).toBe(0);
  });

  it('default config preserves clamping behavior (no eject)', () => {
    const { system, physicsStore, transformStore } = setupSystem({
      ejectOnBoundsExit: false,
    });
    addEntity(physicsStore, transformStore, 1, 9.9, 0, 500, 0);

    const events: BoundsExitEvent[] = [];
    eventBus.on<BoundsExitEvent>(PhysicsEvents.BOUNDS_EXIT, (e) => events.push(e));

    system.step();

    // No BOUNDS_EXIT event emitted
    expect(events.length).toBe(0);

    // Body should be clamped, not ejected
    const physIdx = physicsStore.indexOf(1);
    expect(physicsStore.arrays.ignorePhysics[physIdx]).toBe(0);

    const txIdx = transformStore.indexOf(1);
    const posX = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[txIdx]));
    expect(posX).toBeLessThanOrEqual(10);
  });

  it('default config (no ejectOnBoundsExit) also preserves clamping', () => {
    // No ejectOnBoundsExit in config at all
    const { system, physicsStore, transformStore } = setupSystem();
    addEntity(physicsStore, transformStore, 1, 9.9, 0, 500, 0);

    const events: BoundsExitEvent[] = [];
    eventBus.on<BoundsExitEvent>(PhysicsEvents.BOUNDS_EXIT, (e) => events.push(e));

    system.step();

    expect(events.length).toBe(0);
    const txIdx = transformStore.indexOf(1);
    const posX = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[txIdx]));
    expect(posX).toBeLessThanOrEqual(10);
  });

  it('BOUNDS_EXIT payload contains correct entityId', () => {
    const { system, physicsStore, transformStore } = setupSystem({
      ejectOnBoundsExit: true,
    });
    // Two entities: one exits, one stays
    addEntity(physicsStore, transformStore, 42, 9.9, 0, 500, 0);
    addEntity(physicsStore, transformStore, 99, 0, 0, 0, 0);

    const events: BoundsExitEvent[] = [];
    eventBus.on<BoundsExitEvent>(PhysicsEvents.BOUNDS_EXIT, (e) => events.push(e));

    system.step();

    expect(events.length).toBe(1);
    expect(events[0].entityId).toBe(42);
  });
});
