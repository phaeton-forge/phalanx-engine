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
    maxVelocity: FP.FromFloat(1000),
    defaultFriction: FP.FromFloat(1.0), // no friction so XZ velocity is preserved
    pushStrength: FP.FromFloat(15.0),
    gridCellSize: FP.FromFloat(4),
    ...overrides,
  };
}

describe('PhysicsSystem Y integration', () => {
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

  function setup(overrides?: Partial<PhysicsConfig>) {
    const system = new PhysicsSystem(createPhysicsConfig(overrides));
    system.init(context);
    const physicsStore = entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    const transformStore = entityManager.getOrCreateSoAStore(TransformSoASchema);
    return { system, physicsStore, transformStore };
  }

  function addBody(
    physicsStore: SoAComponentStore<typeof PhysicsSoASchema.definition>,
    transformStore: SoAComponentStore<typeof TransformSoASchema.definition>,
    entityId: number,
    velX: number, velY: number, velZ: number,
    posY = 0,
  ): void {
    physicsStore.add(entityId, {
      velocityX: FP.ToRaw(FP.FromFloat(velX)),
      velocityY: FP.ToRaw(FP.FromFloat(velY)),
      velocityZ: FP.ToRaw(FP.FromFloat(velZ)),
      radius: FP.ToRaw(FP._1),
      mass: FP.ToRaw(FP._1),
      restitution: FP.ToRaw(FP.FromFloat(0.5)),
      friction: FP.ToRaw(FP._1),
      isStatic: 0,
      ignorePhysics: 0,
      useGravity: 0,
      lastX: 0,
      lastZ: 0,
    });
    addTransformRow(transformStore, entityId, 0, 0, posY);
  }

  it('moves a body on Y linearly when velocityY is nonzero (useGravity=false)', () => {
    const { system, physicsStore, transformStore } = setup();
    // velY = 8, dt = 0.05, subSteps = 1 -> ΔY per tick = 8 * 0.05 = 0.4 (constant velocity)
    addBody(physicsStore, transformStore, 1, 0, 8, 0, 0);
    const txIdx = transformStore.indexOf(1);

    system.processTick(1);
    expect(FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionY[txIdx]))).toBeCloseTo(0.4, 4);

    system.processTick(2);
    expect(FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionY[txIdx]))).toBeCloseTo(0.8, 4);

    system.processTick(3);
    expect(FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionY[txIdx]))).toBeCloseTo(1.2, 4);
  });

  it('sub-steps Y integration consistently with XZ', () => {
    const { system, physicsStore, transformStore } = setup({ subSteps: 3 });
    // velY = 6, total ΔY per tick = 6 * (0.05/3) * 3 = 0.3
    addBody(physicsStore, transformStore, 1, 0, 6, 0, 0);
    const txIdx = transformStore.indexOf(1);

    system.processTick(1);
    // 3-digit tolerance: fixed-point sub-step dt = 0.05/3 is not exactly
    // representable, so accumulated ΔY has a small (~1e-4) rounding error.
    expect(FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionY[txIdx]))).toBeCloseTo(0.3, 3);
  });

  it('regression: body with velocityY=0 does not move on Y', () => {
    const { system, physicsStore, transformStore } = setup();
    addBody(physicsStore, transformStore, 1, 10, 0, 5, 42);
    const txIdx = transformStore.indexOf(1);

    system.processTick(1);

    // Y stays fixed even though XZ move.
    expect(FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionY[txIdx]))).toBeCloseTo(42, 5);
    // XZ still integrate normally.
    expect(FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[txIdx]))).toBeCloseTo(0.5, 4);
    expect(FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionZ[txIdx]))).toBeCloseTo(0.25, 4);
  });

  it('static bodies do not integrate on Y', () => {
    const { system, physicsStore, transformStore } = setup();
    addBody(physicsStore, transformStore, 1, 0, 8, 0, 10);
    const physIdx = physicsStore.indexOf(1);
    physicsStore.arrays.isStatic[physIdx] = 1;
    const txIdx = transformStore.indexOf(1);

    system.processTick(1);

    expect(FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionY[txIdx]))).toBeCloseTo(10, 5);
  });
});
