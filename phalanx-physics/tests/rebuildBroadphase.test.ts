import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  EntityManager,
  EventBus,
  SoAComponent,
  SystemContext,
  type SoAComponentStore,
} from '@phalanx-engine/ecs';
import { DeterministicRandom, FP } from '@phalanx-engine/math';
import type { FixedPoint } from '@phalanx-engine/math';
import { SpatialHashGrid } from '../src/collision/SpatialHashGrid';
import { PhysicsSoASchema } from '../src/components/PhysicsBodyComponent';
import { TransformSoASchema } from '../src/components/TransformComponent';
import { CollisionSystem } from '../src/systems/CollisionSystem';
import { PhysicsWorld } from '../src/PhysicsWorld';
import { addTransformRow } from './testTransformHelpers';

const BODY_COUNT = 200;

function copyPairs(
  pairs: readonly (readonly [number, number])[]
): [number, number][] {
  return pairs.map((pair) => [pair[0], pair[1]]);
}

function addBody(
  store: SoAComponentStore<typeof PhysicsSoASchema.definition>,
  entityId: number
): void {
  store.add(entityId, {
    velocityX: FP.ToRaw(FP._0),
    velocityY: FP.ToRaw(FP._0),
    velocityZ: FP.ToRaw(FP._0),
    radius: FP.ToRaw(FP._1),
    mass: FP.ToRaw(FP._1),
    restitution: FP.ToRaw(FP.FromFloat(0.5)),
    friction: FP.ToRaw(FP.FromFloat(0.3)),
    isStatic: 0,
    ignorePhysics: 0,
    useGravity: 0,
    gravityMultiplier: FP.ToRaw(FP._1),
    lastX: 0,
    lastZ: 0,
  });
}

describe('broadphase snapshot hooks', () => {
  let entityManager: EntityManager;
  let context: SystemContext;

  beforeEach(() => {
    entityManager = new EntityManager();
    context = new SystemContext(new EventBus(), entityManager);
    SoAComponent.useEntityManager(entityManager);
  });

  afterEach(() => {
    SoAComponent.resetContext();
  });

  it('re-inserting 200 seeded bodies in id order matches incremental queryPairs', () => {
    const cellSize = FP.FromInt(4);
    const radius = FP._1;
    const rng = new DeterministicRandom(20261015);
    const bodies: { id: number; x: FixedPoint; z: FixedPoint }[] = [];
    for (let id = 1; id <= BODY_COUNT; id++) {
      bodies.push({
        id,
        x: FP.FromInt(rng.intRange(-40, 40)),
        z: FP.FromInt(rng.intRange(-40, 40)),
      });
    }

    const order = bodies.map((body) => body.id);
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.intRange(0, i);
      const left = order[i];
      const right = order[j];
      if (left === undefined || right === undefined) {
        throw new Error('shuffle index out of range');
      }
      order[i] = right;
      order[j] = left;
    }

    const incremental = new SpatialHashGrid(cellSize);
    for (const id of order) {
      const body = bodies[id - 1];
      if (!body) {
        throw new Error(`missing body ${id}`);
      }
      incremental.insert(body.id, body.x, body.z, radius);
    }
    const incrementalPairs = copyPairs(incremental.queryPairs());
    const incrementalCenters = incremental.getCenters();

    const rebuilt = new SpatialHashGrid(cellSize);
    for (const body of bodies) {
      rebuilt.insert(body.id, body.x, body.z, radius);
    }

    expect(copyPairs(rebuilt.queryPairs())).toEqual(incrementalPairs);
    const rebuiltCenters = rebuilt.getCenters();
    expect(rebuiltCenters.map((center) => center.entityId)).toEqual(
      incrementalCenters.map((center) => center.entityId)
    );
    for (let i = 0; i < rebuiltCenters.length; i++) {
      const left = rebuiltCenters[i];
      const right = incrementalCenters[i];
      expect(left).toBeDefined();
      expect(right).toBeDefined();
      if (!left || !right) {
        throw new Error('missing broadphase center');
      }
      expect(FP.Eq(left.x, right.x)).toBe(true);
      expect(FP.Eq(left.z, right.z)).toBe(true);
      if (i > 0) {
        const previous = rebuiltCenters[i - 1];
        expect(previous).toBeDefined();
        if (previous) {
          expect(left.entityId).toBeGreaterThan(previous.entityId);
        }
      }
    }
  });

  it('PhysicsWorld.rebuildBroadphase matches that grid and does not move transforms', () => {
    const cellSize = FP.FromInt(4);
    const physicsWorld = new PhysicsWorld({
      gridCellSize: cellSize,
      subSteps: 1,
    });
    const { physicsSystem } = physicsWorld.getSystems();
    physicsSystem.init(context);

    const physicsStore = entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    const transformStore =
      entityManager.getOrCreateSoAStore(TransformSoASchema);
    const rng = new DeterministicRandom(20261015);
    const bodies: { id: number; x: number; z: number }[] = [];
    for (let id = 1; id <= BODY_COUNT; id++) {
      bodies.push({
        id,
        x: rng.intRange(-40, 40),
        z: rng.intRange(-40, 40),
      });
    }

    const reference = new SpatialHashGrid(cellSize);
    for (const body of bodies) {
      addBody(physicsStore, body.id);
      addTransformRow(transformStore, body.id, body.x, body.z);
      reference.insert(body.id, FP.FromInt(body.x), FP.FromInt(body.z), FP._1);
    }
    const beforeX = transformStore.arrays.fpPositionX.slice();
    const beforeZ = transformStore.arrays.fpPositionZ.slice();

    physicsWorld.rebuildBroadphase();

    expect(copyPairs(physicsWorld.spatialGrid.queryPairs())).toEqual(
      copyPairs(reference.queryPairs())
    );
    expect(Array.from(transformStore.arrays.fpPositionX)).toEqual(
      Array.from(beforeX)
    );
    expect(Array.from(transformStore.arrays.fpPositionZ)).toEqual(
      Array.from(beforeZ)
    );

    const centers = physicsWorld.getBroadphaseCenters();
    expect(centers).toHaveLength(BODY_COUNT);
    expect(physicsSystem.getBroadphaseCenters()).toEqual(centers);
    const moved = bodies[0];
    expect(moved).toBeDefined();
    if (!moved) {
      throw new Error('missing body');
    }
    const index = transformStore.indexOf(moved.id);
    transformStore.arrays.fpPositionX[index] = FP.ToRaw(
      FP.FromInt(moved.x + 25)
    );
    const cached = physicsWorld
      .getBroadphaseCenters()
      .find((center) => center.entityId === moved.id);
    expect(cached).toBeDefined();
    if (!cached) {
      throw new Error('missing cached center');
    }
    expect(FP.Eq(cached.x, FP.FromInt(moved.x))).toBe(true);

    physicsWorld.rebuildBroadphase();
    const refreshed = physicsWorld
      .getBroadphaseCenters()
      .find((center) => center.entityId === moved.id);
    expect(refreshed).toBeDefined();
    if (!refreshed) {
      throw new Error('missing refreshed center');
    }
    expect(FP.Eq(refreshed.x, FP.FromInt(moved.x + 25))).toBe(true);
  });

  it('CollisionSystem exposes cached centers and an explicit transform rebuild', () => {
    const cellSize = FP.FromInt(4);
    const system = new CollisionSystem(cellSize);
    system.init(context);
    const physicsStore = entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    const transformStore =
      entityManager.getOrCreateSoAStore(TransformSoASchema);
    addBody(physicsStore, 1);
    addTransformRow(transformStore, 1, 2, 6);

    expect(system.getBroadphaseCenters()).toEqual([]);
    system.rebuildBroadphase();
    const centers = system.getBroadphaseCenters();
    expect(centers).toHaveLength(1);
    expect(centers[0]?.entityId).toBe(1);
    expect(FP.Eq(centers[0]?.x ?? FP._0, FP.FromInt(2))).toBe(true);
    expect(FP.Eq(centers[0]?.z ?? FP._0, FP.FromInt(6))).toBe(true);
  });

  it('rebuildBroadphase throws before init', () => {
    const physicsWorld = new PhysicsWorld();
    expect(() => physicsWorld.rebuildBroadphase()).toThrow(/init/);
  });
});
