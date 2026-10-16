import { afterEach, describe, expect, it } from 'vitest';
import {
  Entity,
  GameWorld,
  SoAComponent,
  resetEntityIdCounter,
} from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import type { FixedPoint } from '@phalanx-engine/math';
import {
  CollisionSystem,
  PhysicsBodyComponent,
  PhysicsSoASchema,
  PhysicsWorld,
  TransformComponent,
  TransformSoASchema,
} from '@phalanx-engine/physics';
import { StateHelpers } from '../../src/helpers/StateHelpers.js';
import {
  BinaryStateReader,
  BinaryStateWriter,
} from '../../src/state/BinaryState.js';

const SCHEMAS = [TransformSoASchema, PhysicsSoASchema] as const;

class Disc extends Entity {
  public constructor(x: number, z: number) {
    super();
    this.addComponent(
      new TransformComponent(this.id, {
        x: FP.FromInt(x),
        y: FP._0,
        z: FP.FromInt(z),
      })
    );
    this.addComponent(
      new PhysicsBodyComponent(this.id, {
        radius: FP._1,
        mass: FP._1,
        restitution: FP.FromFloat(0.5),
        friction: FP.FromFloat(0.3),
      })
    );
  }
}

function finish(fill: (w: BinaryStateWriter) => void): Uint8Array {
  const writer = new BinaryStateWriter();
  fill(writer);
  return writer.finish();
}

function wiredWorld(cellSize: FixedPoint = FP.FromInt(4)): {
  world: GameWorld;
  physics: PhysicsWorld;
} {
  const world = new GameWorld({});
  const physics = new PhysicsWorld({
    gridCellSize: cellSize,
    subSteps: 1,
  });
  world.context.physics = physics;
  const { physicsSystem } = physics.getSystems();
  world.registerSystems([physicsSystem], []);
  return { world, physics };
}

function addDisc(world: GameWorld, x: number, z: number): Disc {
  const disc = new Disc(x, z);
  world.entityManager.addEntity(disc);
  return disc;
}

describe('physics state helpers', () => {
  afterEach(() => {
    SoAComponent.resetContext();
    resetEntityIdCounter();
  });

  it('restores pre-separation centers, which a transform rebuild does not', () => {
    const { world, physics } = wiredWorld();
    addDisc(world, 0, 0);
    addDisc(world, 1, 0);
    physics.getSystems().physicsSystem.step();

    const savedCenters = physics.getBroadphaseCenters();
    const moved = savedCenters.find((center) => center.entityId === 1);
    expect(moved).toBeDefined();
    if (moved === undefined) {
      throw new Error('missing cached center');
    }
    const transformStore = world.entityManager.getSoAStore(TransformSoASchema);
    if (transformStore === undefined) {
      throw new Error('missing transform store');
    }
    const transformIndex = transformStore.indexOf(1);
    const transformX = transformStore.arrays.fpPositionX[transformIndex];
    if (transformX === undefined) {
      throw new Error('missing transform');
    }
    expect(FP.Eq(moved.x, FP.FromRaw(transformX))).toBe(false);

    const liveQuery = [
      ...physics.spatialGrid.queryRadius(moved.x, moved.z, FP._0),
    ];
    expect(liveQuery).toContain(1);

    const bytes = finish((writer) => {
      StateHelpers.writeSoAStores(writer, world, SCHEMAS);
      StateHelpers.writeBroadphase(writer, world);
    });

    const restored = wiredWorld();
    addDisc(restored.world, 0, 0);
    addDisc(restored.world, 0, 0);
    const reader = new BinaryStateReader(bytes);
    StateHelpers.readSoAStores(reader, restored.world, SCHEMAS);
    StateHelpers.readBroadphase(reader, restored.world);
    reader.done();

    const restoredQuery = [
      ...restored.physics.spatialGrid.queryRadius(moved.x, moved.z, FP._0),
    ];
    expect(restoredQuery).toEqual(liveQuery);

    const restoredCenter = restored.physics
      .getBroadphaseCenters()
      .find((center) => center.entityId === 1);
    expect(restoredCenter).toBeDefined();
    if (restoredCenter === undefined) {
      throw new Error('missing restored center');
    }
    expect(restoredCenter.x.base).toBe(moved.x.base);
    expect(restoredCenter.x.precision).toBe(moved.x.precision);
    expect(restoredCenter.z.base).toBe(moved.z.base);
    expect(restoredCenter.z.precision).toBe(moved.z.precision);
    expect(restoredCenter.radius.base).toBe(moved.radius.base);
    expect(restoredCenter.radius.precision).toBe(moved.radius.precision);

    const again = finish((writer) => {
      StateHelpers.writeSoAStores(writer, restored.world, SCHEMAS);
      StateHelpers.writeBroadphase(writer, restored.world);
    });
    expect(again).toEqual(bytes);

    StateHelpers.rebuildBroadphaseFromTransforms(restored.world);
    const rebuiltQuery = [
      ...restored.physics.spatialGrid.queryRadius(moved.x, moved.z, FP._0),
    ];
    expect(rebuiltQuery).not.toEqual(liveQuery);
  });

  it('keeps a non-default precision through writeBroadphase', () => {
    const precision = 2;
    const cellSize = FP.FromInt(4, precision);
    const source = wiredWorld(cellSize);
    const x = FP.FromInt(10, precision);
    const z = FP.FromInt(-3, precision);
    const radius = FP.FromInt(1, precision);
    source.physics.spatialGrid.insert(7, x, z, radius);
    const liveQuery = [...source.physics.spatialGrid.queryRadius(x, z, radius)];

    const bytes = finish((writer) => {
      StateHelpers.writeBroadphase(writer, source.world);
    });

    const restored = wiredWorld(cellSize);
    const reader = new BinaryStateReader(bytes);
    StateHelpers.readBroadphase(reader, restored.world);
    reader.done();

    const center = restored.physics.getBroadphaseCenters()[0];
    expect(center).toBeDefined();
    if (center === undefined) {
      throw new Error('missing center');
    }
    expect(center.entityId).toBe(7);
    expect(center.x.base).toBe(x.base);
    expect(center.x.precision).toBe(x.precision);
    expect(center.z.base).toBe(z.base);
    expect(center.z.precision).toBe(z.precision);
    expect(center.radius.base).toBe(radius.base);
    expect(center.radius.precision).toBe(radius.precision);
    expect([...restored.physics.spatialGrid.queryRadius(x, z, radius)]).toEqual(
      liveQuery
    );
  });

  it('rebuilds from transforms only before a resolving step', () => {
    const { world, physics } = wiredWorld();
    addDisc(world, 0, 0);
    addDisc(world, 30, 0);
    expect(physics.getBroadphaseCenters()).toEqual([]);

    StateHelpers.rebuildBroadphaseFromTransforms(world);

    const centers = physics.getBroadphaseCenters();
    expect(centers.map((center) => center.entityId)).toEqual([1, 2]);
    const first = centers[0];
    expect(first).toBeDefined();
    if (first === undefined) {
      throw new Error('missing center');
    }
    expect(FP.Eq(first.x, FP.FromInt(0))).toBe(true);
    expect(FP.Eq(first.z, FP.FromInt(0))).toBe(true);
    const query = [...physics.spatialGrid.queryRadius(FP._0, FP._0, FP._1)];
    expect(query).toContain(1);
    expect(query).not.toContain(2);
  });

  it('saves a registered CollisionSystem under collisionSystem', () => {
    const world = new GameWorld({});
    const collision = new CollisionSystem(FP.FromInt(4));
    world.registerSystems([collision], []);
    collision.restoreBroadphase([
      {
        entityId: 3,
        x: FP.FromInt(1),
        z: FP.FromInt(2),
        radius: FP._1,
      },
    ]);

    const bytes = finish((writer) => {
      StateHelpers.writeBroadphase(writer, world);
    });
    expect(new TextDecoder().decode(bytes)).toContain('collisionSystem');

    const restored = new GameWorld({});
    const restoredCollision = new CollisionSystem(FP.FromInt(4));
    restored.registerSystems([restoredCollision], []);
    const reader = new BinaryStateReader(bytes);
    StateHelpers.readBroadphase(reader, restored);
    reader.done();
    const center = restoredCollision.getBroadphaseCenters()[0];
    expect(center?.entityId).toBe(3);
    expect(FP.Eq(center?.x ?? FP._0, FP.FromInt(1))).toBe(true);
    expect(FP.Eq(center?.z ?? FP._0, FP.FromInt(2))).toBe(true);
  });

  it('throws when the world has no broadphase', () => {
    const world = new GameWorld({});
    expect(() => StateHelpers.rebuildBroadphaseFromTransforms(world)).toThrow(
      /no broadphase/
    );
    expect(() =>
      finish((writer) => {
        StateHelpers.writeBroadphase(writer, world);
      })
    ).toThrow(/no broadphase/);
  });
});
