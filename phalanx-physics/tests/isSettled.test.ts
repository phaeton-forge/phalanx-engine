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
import type { PhysicsConfig } from '../src/types';
import { addTransformRow } from './testTransformHelpers';

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

describe('isSettled', () => {
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
    velX: number = 0,
    velZ: number = 0,
    isStatic: boolean = false,
    ignorePhysics: boolean = false,
  ): void {
    physicsStore.add(entityId, {
      velocityX: FP.ToRaw(FP.FromFloat(velX)),
      velocityY: FP.ToRaw(FP._0),
      velocityZ: FP.ToRaw(FP.FromFloat(velZ)),
      radius: FP.ToRaw(FP._1),
      mass: FP.ToRaw(FP._1),
      restitution: FP.ToRaw(FP.FromFloat(0.5)),
      friction: FP.ToRaw(FP._1),
      isStatic: isStatic ? 1 : 0,
      ignorePhysics: ignorePhysics ? 1 : 0,
      useGravity: 0,
      gravityMultiplier: FP.ToRaw(FP._1),
      lastX: 0,
      lastZ: 0,
    });
    addTransformRow(transformStore, entityId, 0, 0);
  }

  it('returns true when all bodies are at rest', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    addEntity(physicsStore, transformStore, 1, 0, 0);
    addEntity(physicsStore, transformStore, 2, 0, 0);

    expect(system.isSettled()).toBe(true);
  });

  it('returns false when a body has velocity above threshold', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    addEntity(physicsStore, transformStore, 1, 5, 0);
    addEntity(physicsStore, transformStore, 2, 0, 0);

    expect(system.isSettled()).toBe(false);
  });

  it('respects custom threshold', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    // velocity magnitude = 0.5, below threshold 1.0
    addEntity(physicsStore, transformStore, 1, 0.5, 0);

    expect(system.isSettled(FP.FromFloat(1.0))).toBe(true);
    expect(system.isSettled(FP.FromFloat(0.1))).toBe(false);
  });

  it('excludes static bodies from check', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    // Static body with high velocity should not affect settlement
    addEntity(physicsStore, transformStore, 1, 100, 100, true);
    addEntity(physicsStore, transformStore, 2, 0, 0);

    expect(system.isSettled()).toBe(true);
  });

  it('excludes ignored bodies from check', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    // Ignored body with high velocity should not affect settlement
    addEntity(physicsStore, transformStore, 1, 100, 100, false, true);
    addEntity(physicsStore, transformStore, 2, 0, 0);

    expect(system.isSettled()).toBe(true);
  });

  it('returns true when world is empty', () => {
    const { system } = setupSystem();
    expect(system.isSettled()).toBe(true);
  });

  it('returns false when a body moves only on Y (vx=0, vz=0, vy!=0)', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    addEntity(physicsStore, transformStore, 1, 0, 0);
    // Falling shrapnel: only velocityY is nonzero.
    const idx = physicsStore.indexOf(1);
    physicsStore.arrays.velocityY[idx] = FP.ToRaw(FP.FromFloat(5));

    expect(system.isSettled()).toBe(false);
  });

  it('returns true when Y velocity is zeroed back out', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    addEntity(physicsStore, transformStore, 1, 0, 0);
    const idx = physicsStore.indexOf(1);
    physicsStore.arrays.velocityY[idx] = FP.ToRaw(FP.FromFloat(5));
    expect(system.isSettled()).toBe(false);

    physicsStore.arrays.velocityY[idx] = FP.ToRaw(FP._0);
    expect(system.isSettled()).toBe(true);
  });
});
