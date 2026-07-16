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
    defaultFriction: FP.FromFloat(1.0), // no friction for cleaner tests
    pushStrength: FP.FromFloat(15.0),
    gridCellSize: FP.FromFloat(4),
    ...overrides,
  };
}

describe('applyImpulse', () => {
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
  ): void {
    physicsStore.add(entityId, {
      velocityX: FP.ToRaw(FP._0),
      velocityY: FP.ToRaw(FP._0),
      velocityZ: FP.ToRaw(FP._0),
      radius: FP.ToRaw(FP._1),
      mass: FP.ToRaw(FP._1),
      restitution: FP.ToRaw(FP.FromFloat(0.5)),
      friction: FP.ToRaw(FP._1), // no friction
      isStatic: 0,
      ignorePhysics: 0,
      useGravity: 0,
      lastX: 0,
      lastZ: 0,
    });
    addTransformRow(transformStore, entityId, posX, posZ);
  }

  it('sets velocity correctly on a body at rest', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    addEntity(physicsStore, transformStore, 1, 0, 0);

    system.applyImpulse(1, FP.FromFloat(5), FP.FromFloat(3));

    const idx = physicsStore.indexOf(1);
    expect(FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityX[idx]))).toBeCloseTo(5, 2);
    expect(FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityZ[idx]))).toBeCloseTo(3, 2);
  });

  it('replaces existing velocity (does not accumulate)', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    addEntity(physicsStore, transformStore, 1, 0, 0);

    // Apply first impulse
    system.applyImpulse(1, FP.FromFloat(10), FP.FromFloat(0));
    // Apply second impulse — should replace
    system.applyImpulse(1, FP.FromFloat(3), FP.FromFloat(7));

    const idx = physicsStore.indexOf(1);
    expect(FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityX[idx]))).toBeCloseTo(3, 2);
    expect(FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityZ[idx]))).toBeCloseTo(7, 2);
  });

  it('re-enables ignorePhysics flag when applying impulse', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    addEntity(physicsStore, transformStore, 1, 0, 0);

    // Manually set ignorePhysics
    const idx = physicsStore.indexOf(1);
    physicsStore.arrays.ignorePhysics[idx] = 1;

    system.applyImpulse(1, FP.FromFloat(5), FP.FromFloat(0));

    expect(physicsStore.arrays.ignorePhysics[idx]).toBe(0);
  });

  it('respects maxVelocity clamp on next step', () => {
    const { system, physicsStore, transformStore } = setupSystem({
      maxVelocity: FP.FromFloat(5),
    });
    addEntity(physicsStore, transformStore, 1, 0, 0);

    // Apply impulse exceeding maxVelocity
    system.applyImpulse(1, FP.FromFloat(100), FP.FromFloat(0));

    // After step, velocity should be clamped
    system.step();

    const idx = physicsStore.indexOf(1);
    const velX = FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityX[idx]));
    expect(velX).toBeLessThanOrEqual(5.01);
  });

  it('no-ops for unknown entityId', () => {
    const { system, physicsStore, transformStore } = setupSystem();
    addEntity(physicsStore, transformStore, 1, 0, 0);

    // Should not throw
    system.applyImpulse(999, FP.FromFloat(5), FP.FromFloat(5));

    // Existing entity is unaffected
    const idx = physicsStore.indexOf(1);
    expect(FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityX[idx]))).toBeCloseTo(0, 2);
  });
});
