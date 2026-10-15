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
      expect(FP.Eq(left.radius, right.radius)).toBe(true);
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
    expect(FP.Eq(centers[0]?.radius ?? FP._0, FP._1)).toBe(true);

    system.restoreBroadphase([...centers].reverse());
    const restored = system.getBroadphaseCenters();
    expect(restored).toHaveLength(1);
    expect(restored[0]?.entityId).toBe(1);
    expect(FP.Eq(restored[0]?.radius ?? FP._0, FP._1)).toBe(true);
  });

  it('rebuildBroadphase throws before init', () => {
    const physicsWorld = new PhysicsWorld();
    expect(() => physicsWorld.rebuildBroadphase()).toThrow(/init/);
  });

  it('getCenters keeps a non-default precision through restore', () => {
    const precision = 2;
    const cellSize = FP.FromInt(4, precision);
    const live = new SpatialHashGrid(cellSize);
    const x = FP.FromInt(10, precision);
    const z = FP.FromInt(-3, precision);
    const radius = FP.FromInt(1, precision);
    live.insert(7, x, z, radius);

    const saved = live.getCenters();
    const center = saved[0];
    expect(center).toBeDefined();
    if (!center) {
      throw new Error('missing center');
    }
    expect(center.x.precision).toBe(x.precision);
    expect(center.z.precision).toBe(z.precision);
    expect(center.radius.precision).toBe(radius.precision);
    expect(FP.Eq(center.x, x)).toBe(true);
    expect(FP.Eq(center.z, z)).toBe(true);
    expect(FP.Eq(center.radius, radius)).toBe(true);
    expect(
      FP.Eq(
        FP.Sub(center.x, FP.FromInt(1, precision)),
        FP.FromInt(9, precision)
      )
    ).toBe(true);

    const liveQuery = [...live.queryRadius(x, z, radius)];
    const restored = new SpatialHashGrid(cellSize);
    restored.restoreBroadphase(saved);
    const again = restored.getCenters()[0];
    expect(again).toBeDefined();
    if (!again) {
      throw new Error('missing restored center');
    }
    expect(again.x.precision).toBe(x.precision);
    expect(again.x.base).toBe(x.base);
    expect(again.z.precision).toBe(z.precision);
    expect(again.z.base).toBe(z.base);
    expect(again.radius.precision).toBe(radius.precision);
    expect(again.radius.base).toBe(radius.base);
    expect([...restored.queryRadius(x, z, radius)]).toEqual(liveQuery);
  });

  it('restoreBroadphase replays saved radius so queryRadius matches', () => {
    const cellSize = FP.FromInt(4);
    const live = new SpatialHashGrid(cellSize);
    live.insert(3, FP.FromInt(10), FP.FromInt(1), FP.FromInt(6));
    live.insert(1, FP.FromInt(0), FP.FromInt(0), FP._1);
    live.insert(2, FP.FromInt(5), FP.FromInt(-2), FP.FromInt(3));

    const centers = live.getCenters();
    expect(centers.map((center) => center.entityId)).toEqual([1, 2, 3]);
    const wide = centers[2];
    expect(wide).toBeDefined();
    if (!wide) {
      throw new Error('missing wide center');
    }
    expect(FP.Eq(wide.radius, FP.FromInt(6))).toBe(true);

    const probeX = FP.FromInt(8);
    const reach = FP.FromInt(4);
    const liveRadius = [...live.queryRadius(probeX, FP._0, reach)];
    const livePairs = copyPairs(live.queryPairs());

    const restored = new SpatialHashGrid(cellSize);
    restored.restoreBroadphase([...centers].reverse());
    expect([...restored.queryRadius(probeX, FP._0, reach)]).toEqual(
      liveRadius
    );
    expect(copyPairs(restored.queryPairs())).toEqual(livePairs);
    expect(() =>
      restored.restoreBroadphase([
        centers[0] ?? wide,
        centers[0] ?? wide,
      ])
    ).toThrow(/duplicate/);
  });

  it('after resolution, saved centers restore queryRadius and a transform rebuild does not', () => {
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
    addBody(physicsStore, 1);
    addBody(physicsStore, 2);
    addTransformRow(transformStore, 1, 0, 0);
    addTransformRow(transformStore, 2, 1, 0);

    physicsSystem.step();

    const saved = physicsWorld.getBroadphaseCenters();
    const reach = FP.FromInt(2);
    const liveQuery = [
      ...physicsWorld.spatialGrid.queryRadius(FP._0, FP._0, reach),
    ];
    const moved = saved.find((center) => center.entityId === 1);
    expect(moved).toBeDefined();
    if (!moved) {
      throw new Error('missing cached center');
    }
    const transformIndex = transformStore.indexOf(1);
    const transformX = FP.FromRaw(
      transformStore.arrays.fpPositionX[transformIndex] ?? 0n
    );
    expect(FP.Eq(moved.x, transformX)).toBe(false);

    physicsWorld.rebuildBroadphase();
    const rebuilt = physicsWorld
      .getBroadphaseCenters()
      .find((center) => center.entityId === 1);
    expect(rebuilt).toBeDefined();
    if (!rebuilt) {
      throw new Error('missing rebuilt center');
    }
    expect(FP.Eq(rebuilt.x, moved.x)).toBe(false);

    physicsWorld.restoreBroadphase(saved);
    expect([
      ...physicsWorld.spatialGrid.queryRadius(FP._0, FP._0, reach),
    ]).toEqual(liveQuery);
    const roundTrip = physicsWorld
      .getBroadphaseCenters()
      .find((center) => center.entityId === 1);
    expect(roundTrip).toBeDefined();
    if (!roundTrip) {
      throw new Error('missing restored center');
    }
    expect(FP.Eq(roundTrip.x, moved.x)).toBe(true);
    expect(FP.Eq(roundTrip.z, moved.z)).toBe(true);
    expect(FP.Eq(roundTrip.radius, moved.radius)).toBe(true);
  });
});
