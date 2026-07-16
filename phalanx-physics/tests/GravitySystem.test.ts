import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FP } from '@phalanx-engine/math';
import {
  EntityManager,
  EventBus,
  SystemContext,
  SoAComponent,
  type SoAComponentStore,
} from '@phalanx-engine/ecs';
import { GravitySystem } from '../src/systems/GravitySystem';
import { PhysicsSystem } from '../src/systems/PhysicsSystem';
import { PhysicsSoASchema } from '../src/components/PhysicsBodyComponent';
import { TransformSoASchema } from '../src/components/TransformComponent';
import type { PhysicsConfig } from '../src/types';
import { addTransformRow } from './testTransformHelpers';

const TICK_DT = FP.FromFloat(0.05);
const GRAVITY = FP.FromFloat(10);

function createPhysicsConfig(overrides?: Partial<PhysicsConfig>): PhysicsConfig {
  return {
    tickDt: TICK_DT,
    subSteps: 1,
    maxVelocity: FP.FromFloat(1000),
    defaultFriction: FP.FromFloat(1.0), // no friction for cleaner tests
    pushStrength: FP.FromFloat(15.0),
    gridCellSize: FP.FromFloat(4),
    ...overrides,
  };
}

function addBody(
  physicsStore: SoAComponentStore<typeof PhysicsSoASchema.definition>,
  transformStore: SoAComponentStore<typeof TransformSoASchema.definition>,
  entityId: number,
  opts: { velX?: number; velY?: number; velZ?: number; useGravity?: boolean; posY?: number } = {},
): void {
  physicsStore.add(entityId, {
    velocityX: FP.ToRaw(FP.FromFloat(opts.velX ?? 0)),
    velocityY: FP.ToRaw(FP.FromFloat(opts.velY ?? 0)),
    velocityZ: FP.ToRaw(FP.FromFloat(opts.velZ ?? 0)),
    radius: FP.ToRaw(FP._1),
    mass: FP.ToRaw(FP._1),
    restitution: FP.ToRaw(FP.FromFloat(0.5)),
    friction: FP.ToRaw(FP._1),
    isStatic: 0,
    ignorePhysics: 0,
    useGravity: opts.useGravity ? 1 : 0,
    lastX: 0,
    lastZ: 0,
  });
  addTransformRow(transformStore, entityId, 0, 0, opts.posY ?? 0);
}

describe('GravitySystem', () => {
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

  function setup(gravity = GRAVITY, gravityAxis: 'x' | 'y' | 'z' = 'y') {
    const gravitySystem = new GravitySystem(gravity, gravityAxis, TICK_DT);
    gravitySystem.init(context);
    const physicsStore = entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    const transformStore = entityManager.getOrCreateSoAStore(TransformSoASchema);
    return { gravitySystem, physicsStore, transformStore };
  }

  it('decreases velocityY by gravity*dt each tick for a useGravity body', () => {
    const { gravitySystem, physicsStore, transformStore } = setup();
    addBody(physicsStore, transformStore, 1, { useGravity: true });
    const idx = physicsStore.indexOf(1);

    const deltaPerTick = FP.ToFloat(FP.Mul(GRAVITY, TICK_DT)); // 10 * 0.05 = 0.5

    gravitySystem.processTick(1);
    expect(FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityY[idx]))).toBeCloseTo(-deltaPerTick, 5);

    gravitySystem.processTick(2);
    expect(FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityY[idx]))).toBeCloseTo(-2 * deltaPerTick, 5);

    gravitySystem.processTick(3);
    expect(FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityY[idx]))).toBeCloseTo(-3 * deltaPerTick, 5);
  });

  it('does not change X/Z velocities', () => {
    const { gravitySystem, physicsStore, transformStore } = setup();
    addBody(physicsStore, transformStore, 1, { velX: 7, velZ: -4, useGravity: true });
    const idx = physicsStore.indexOf(1);

    gravitySystem.processTick(1);

    expect(FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityX[idx]))).toBeCloseTo(7, 5);
    expect(FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityZ[idx]))).toBeCloseTo(-4, 5);
  });

  it('leaves velocityY untouched for a useGravity=false body', () => {
    const { gravitySystem, physicsStore, transformStore } = setup();
    addBody(physicsStore, transformStore, 1, { velY: 3, useGravity: false });
    const idx = physicsStore.indexOf(1);

    gravitySystem.processTick(1);

    expect(FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityY[idx]))).toBeCloseTo(3, 5);
  });

  it('does NOT change positionY (integration is PhysicsSystem\'s job)', () => {
    const { gravitySystem, physicsStore, transformStore } = setup();
    addBody(physicsStore, transformStore, 1, { useGravity: true, posY: 100 });
    const txIdx = transformStore.indexOf(1);

    // GravitySystem alone: velocity changes, position does not.
    gravitySystem.processTick(1);
    expect(FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionY[txIdx]))).toBeCloseTo(100, 5);

    const velY = FP.FromRaw(physicsStore.arrays.velocityY[physicsStore.indexOf(1)]);
    expect(FP.ToFloat(velY)).toBeCloseTo(-0.5, 5);

    // Now PhysicsSystem integrates the accumulated velocity into position.
    const physicsSystem = new PhysicsSystem(createPhysicsConfig());
    physicsSystem.init(context);
    physicsSystem.processTick(1);

    // pos.y += velY * dt = 100 + (-0.5 * 0.05) = 99.975
    expect(FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionY[txIdx]))).toBeCloseTo(99.975, 4);
  });

  it('is a no-op when gravity is 0', () => {
    const { gravitySystem, physicsStore, transformStore } = setup(FP._0);
    addBody(physicsStore, transformStore, 1, { velY: 2, useGravity: true });
    const idx = physicsStore.indexOf(1);

    gravitySystem.processTick(1);

    expect(FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityY[idx]))).toBeCloseTo(2, 5);
  });

  it('throws when gravityAxis is not \'y\'', () => {
    expect(() => new GravitySystem(GRAVITY, 'x', TICK_DT)).toThrow();
    expect(() => new GravitySystem(GRAVITY, 'z', TICK_DT)).toThrow();
  });

  it('is deterministic: two identical worlds produce identical velY each tick', () => {
    const worldA = (() => {
      const em = new EntityManager();
      const eb = new EventBus();
      const ctx = new SystemContext(eb, em);
      SoAComponent.useEntityManager(em);
      const sys = new GravitySystem(GRAVITY, 'y', TICK_DT);
      sys.init(ctx);
      const ps = em.getOrCreateSoAStore(PhysicsSoASchema);
      const ts = em.getOrCreateSoAStore(TransformSoASchema);
      addBody(ps, ts, 1, { velY: 5, useGravity: true });
      SoAComponent.resetContext();
      return { sys, ps };
    })();

    const worldB = (() => {
      const em = new EntityManager();
      const eb = new EventBus();
      const ctx = new SystemContext(eb, em);
      SoAComponent.useEntityManager(em);
      const sys = new GravitySystem(GRAVITY, 'y', TICK_DT);
      sys.init(ctx);
      const ps = em.getOrCreateSoAStore(PhysicsSoASchema);
      const ts = em.getOrCreateSoAStore(TransformSoASchema);
      addBody(ps, ts, 1, { velY: 5, useGravity: true });
      SoAComponent.resetContext();
      return { sys, ps };
    })();

    for (let tick = 1; tick <= 10; tick++) {
      worldA.sys.processTick(tick);
      worldB.sys.processTick(tick);
      const a = worldA.ps.arrays.velocityY[worldA.ps.indexOf(1)];
      const b = worldB.ps.arrays.velocityY[worldB.ps.indexOf(1)];
      expect(a).toBe(b);
    }
  });
});
