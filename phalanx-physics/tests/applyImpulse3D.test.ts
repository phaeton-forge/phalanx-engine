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
import { GravitySystem } from '../src/systems/GravitySystem';
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
    defaultFriction: FP.FromFloat(1.0), // no friction so XZ stays linear
    pushStrength: FP.FromFloat(15.0),
    gridCellSize: FP.FromFloat(4),
    ...overrides,
  };
}

function addBody(
  physicsStore: SoAComponentStore<typeof PhysicsSoASchema.definition>,
  transformStore: SoAComponentStore<typeof TransformSoASchema.definition>,
  entityId: number,
  useGravity: boolean,
): void {
  physicsStore.add(entityId, {
    velocityX: FP.ToRaw(FP._0),
    velocityY: FP.ToRaw(FP._0),
    velocityZ: FP.ToRaw(FP._0),
    radius: FP.ToRaw(FP._1),
    mass: FP.ToRaw(FP._1),
    restitution: FP.ToRaw(FP.FromFloat(0.5)),
    friction: FP.ToRaw(FP._1),
    isStatic: 0,
    ignorePhysics: 0,
    useGravity: useGravity ? 1 : 0,
    lastX: 0,
    lastZ: 0,
  });
  addTransformRow(transformStore, entityId, 0, 0, 0);
}

describe('applyImpulse3D', () => {
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
    const physicsSystem = new PhysicsSystem(createPhysicsConfig(overrides));
    physicsSystem.init(context);
    const gravitySystem = new GravitySystem(GRAVITY, 'y', TICK_DT);
    gravitySystem.init(context);
    const physicsStore = entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    const transformStore = entityManager.getOrCreateSoAStore(TransformSoASchema);
    return { physicsSystem, gravitySystem, physicsStore, transformStore };
  }

  it('sets all three velocity components', () => {
    const { physicsSystem, physicsStore, transformStore } = setup();
    addBody(physicsStore, transformStore, 1, false);

    physicsSystem.applyImpulse3D(1, FP.FromFloat(4), FP.FromFloat(5), FP.FromFloat(-2));

    const idx = physicsStore.indexOf(1);
    expect(FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityX[idx]))).toBeCloseTo(4, 5);
    expect(FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityY[idx]))).toBeCloseTo(5, 5);
    expect(FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityZ[idx]))).toBeCloseTo(-2, 5);
  });

  it('clears ignorePhysics', () => {
    const { physicsSystem, physicsStore, transformStore } = setup();
    addBody(physicsStore, transformStore, 1, false);
    const idx = physicsStore.indexOf(1);
    physicsStore.arrays.ignorePhysics[idx] = 1;

    physicsSystem.applyImpulse3D(1, FP.FromFloat(1), FP.FromFloat(1), FP.FromFloat(1));

    expect(physicsStore.arrays.ignorePhysics[idx]).toBe(0);
  });

  it('no-ops for unknown entityId', () => {
    const { physicsSystem, physicsStore, transformStore } = setup();
    addBody(physicsStore, transformStore, 1, false);

    physicsSystem.applyImpulse3D(999, FP.FromFloat(5), FP.FromFloat(5), FP.FromFloat(5));

    const idx = physicsStore.indexOf(1);
    expect(FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityY[idx]))).toBeCloseTo(0, 5);
  });

  it('applyImpulse3D + GravitySystem + PhysicsSystem produces a parabolic Y with linear XZ', () => {
    const { physicsSystem, gravitySystem, physicsStore, transformStore } = setup();
    addBody(physicsStore, transformStore, 1, true);

    const v0x = 4, v0y = 5, v0z = -2;
    physicsSystem.applyImpulse3D(1, FP.FromFloat(v0x), FP.FromFloat(v0y), FP.FromFloat(v0z));

    const txIdx = transformStore.indexOf(1);
    const dt = FP.ToFloat(TICK_DT);
    const g = FP.ToFloat(GRAVITY);

    // Reference float simulation of semi-implicit Euler:
    // per tick: velY -= g*dt (gravity first), then posY += velY*dt.
    let refPosY = 0, refVelY = v0y;
    let refPosX = 0, refPosZ = 0;

    const N = 6;
    for (let tick = 1; tick <= N; tick++) {
      gravitySystem.processTick(tick);
      physicsSystem.processTick(tick);

      refVelY -= g * dt;
      refPosY += refVelY * dt;
      refPosX += v0x * dt;
      refPosZ += v0z * dt;

      expect(FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionY[txIdx]))).toBeCloseTo(refPosY, 3);
      expect(FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[txIdx]))).toBeCloseTo(refPosX, 3);
      expect(FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionZ[txIdx]))).toBeCloseTo(refPosZ, 3);
    }

    // The Y trajectory must rise then fall (parabola): apex above 0, and by the
    // end it has descended below the apex.
    // v0y=5, g*dt=0.5 -> velY crosses zero around tick 10; within N=6 it is still rising.
    expect(refPosY).toBeGreaterThan(0);
  });

  it('is deterministic across two identical worlds', () => {
    function runWorld(): bigint[] {
      const em = new EntityManager();
      const eb = new EventBus();
      const ctx = new SystemContext(eb, em);
      SoAComponent.useEntityManager(em);
      const phys = new PhysicsSystem(createPhysicsConfig());
      phys.init(ctx);
      const grav = new GravitySystem(GRAVITY, 'y', TICK_DT);
      grav.init(ctx);
      const ps = em.getOrCreateSoAStore(PhysicsSoASchema);
      const ts = em.getOrCreateSoAStore(TransformSoASchema);
      addBody(ps, ts, 1, true);
      phys.applyImpulse3D(1, FP.FromFloat(4), FP.FromFloat(5), FP.FromFloat(-2));

      const samples: bigint[] = [];
      for (let tick = 1; tick <= 12; tick++) {
        grav.processTick(tick);
        phys.processTick(tick);
        const txIdx = ts.indexOf(1);
        samples.push(ts.arrays.fpPositionY[txIdx]);
      }
      SoAComponent.resetContext();
      return samples;
    }

    const a = runWorld();
    const b = runWorld();
    expect(a).toEqual(b);
  });
});
