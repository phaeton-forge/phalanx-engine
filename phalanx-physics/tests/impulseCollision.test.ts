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

function createConfig(overrides?: Partial<PhysicsConfig>): PhysicsConfig {
  return {
    // Tiny dt so integration barely moves the (already overlapping) bodies:
    // this isolates the collision-response velocity change under test.
    tickDt: FP.FromFloat(0.001),
    subSteps: 1,
    maxVelocity: FP.FromFloat(1000),
    defaultFriction: FP.FromFloat(1.0), // no damping
    pushStrength: FP.FromFloat(15.0),
    gridCellSize: FP.FromFloat(4),
    ...overrides,
  };
}

describe('impulse collision response', () => {
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
    const system = new PhysicsSystem(createConfig(overrides));
    system.init(context);
    const physicsStore = entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    const transformStore = entityManager.getOrCreateSoAStore(TransformSoASchema);
    return { system, physicsStore, transformStore };
  }

  function addBody(
    physicsStore: SoAComponentStore<typeof PhysicsSoASchema.definition>,
    transformStore: SoAComponentStore<typeof TransformSoASchema.definition>,
    entityId: number,
    posX: number,
    velX: number,
    mass = 1,
    restitution = 0.5,
  ): void {
    physicsStore.add(entityId, {
      velocityX: FP.ToRaw(FP.FromFloat(velX)),
      velocityY: FP.ToRaw(FP._0),
      velocityZ: FP.ToRaw(FP._0),
      radius: FP.ToRaw(FP._1), // radius 1 -> sumR 2
      mass: FP.ToRaw(FP.FromFloat(mass)),
      restitution: FP.ToRaw(FP.FromFloat(restitution)),
      friction: FP.ToRaw(FP._1),
      isStatic: 0,
      ignorePhysics: 0,
      useGravity: 0,
      gravityMultiplier: FP.ToRaw(FP._1),
      lastX: 0,
      lastZ: 0,
    });
    addTransformRow(transformStore, entityId, posX, 0);
  }

  const velX = (store: SoAComponentStore<typeof PhysicsSoASchema.definition>, id: number) =>
    FP.ToFloat(FP.FromRaw(store.arrays.velocityX[store.indexOf(id)]));

  it('equal-mass head-on at e=1 exchanges velocities', () => {
    const { system, physicsStore, transformStore } = setup({
      collisionResponse: 'impulse',
      restitution: FP.FromFloat(1.0),
    });
    // Overlapping along X (dist 1.8 < sumR 2), moving toward each other.
    addBody(physicsStore, transformStore, 1, -0.9, 10);
    addBody(physicsStore, transformStore, 2, 0.9, -10);

    system.step();

    expect(velX(physicsStore, 1)).toBeCloseTo(-10, 3);
    expect(velX(physicsStore, 2)).toBeCloseTo(10, 3);
  });

  it('moving body hitting stationary equal-mass body transfers momentum', () => {
    const { system, physicsStore, transformStore } = setup({
      collisionResponse: 'impulse',
      restitution: FP.FromFloat(1.0),
    });
    addBody(physicsStore, transformStore, 1, -0.9, 10);
    addBody(physicsStore, transformStore, 2, 0.9, 0);

    system.step();

    // Striker stops, struck body carries the momentum.
    expect(velX(physicsStore, 1)).toBeCloseTo(0, 3);
    expect(velX(physicsStore, 2)).toBeCloseTo(10, 3);
  });

  it('non-static body with mass=0 is treated as infinite mass (no divide-by-zero, immovable)', () => {
    const { system, physicsStore, transformStore } = setup({
      collisionResponse: 'impulse',
      restitution: FP.FromFloat(1.0),
    });
    // Body 1: non-static but mass = 0 -> must be treated as infinite mass.
    addBody(physicsStore, transformStore, 1, -0.9, 10, 0);
    // Body 2: normal dynamic body, stationary.
    addBody(physicsStore, transformStore, 2, 0.9, 0, 1);

    // Must not throw (guards FP.Div(1, 0)).
    expect(() => system.step()).not.toThrow();

    // Zero-mass body behaves as immovable: its velocity is unchanged.
    expect(velX(physicsStore, 1)).toBeCloseTo(10, 3);
    // The struck finite-mass body still receives the impulse and moves off.
    expect(velX(physicsStore, 2)).toBeGreaterThan(0);
  });

  it('two zero-mass non-static bodies collide without throwing and neither is impulsed', () => {
    const { system, physicsStore, transformStore } = setup({
      collisionResponse: 'impulse',
      restitution: FP.FromFloat(1.0),
    });
    addBody(physicsStore, transformStore, 1, -0.9, 10, 0);
    addBody(physicsStore, transformStore, 2, 0.9, -10, 0);

    // invMassSum == 0 -> early return, no divide-by-zero, velocities untouched.
    expect(() => system.step()).not.toThrow();
    expect(velX(physicsStore, 1)).toBeCloseTo(10, 3);
    expect(velX(physicsStore, 2)).toBeCloseTo(-10, 3);
  });

  it('unset (zero) restitution on both bodies defaults to e=1.0 in push mode (FIX 1)', () => {
    const { system, physicsStore, transformStore } = setup(); // push mode (default)
    // Both bodies have raw-zero restitution: the "both unset -> default 1.0"
    // branch must fire (value-equality via FP.Eq, not reference ===).
    addBody(physicsStore, transformStore, 1, -0.9, 10, 1, 0);
    addBody(physicsStore, transformStore, 2, 0.9, 0, 1, 0);

    system.step();

    // With the bug (restitution stuck at 0) pushForce would be 0 and the
    // struck body would gain no push velocity. Defaulting to 1.0 pushes it.
    expect(velX(physicsStore, 2)).toBeGreaterThan(0);
  });

  it('default push response does NOT conserve momentum (striker keeps moving)', () => {
    const { system, physicsStore, transformStore } = setup(); // collisionResponse defaults to 'push'
    addBody(physicsStore, transformStore, 1, -0.9, 10);
    addBody(physicsStore, transformStore, 2, 0.9, 0);

    system.step();

    // Push only nudges apart; the striker retains most of its forward velocity.
    expect(velX(physicsStore, 1)).toBeGreaterThan(1);
    expect(velX(physicsStore, 2)).toBeGreaterThan(0);
  });
});
