import { afterEach, describe, expect, it } from 'vitest';
import {
  BinaryStateReader,
  BinaryStateWriter,
  Entity,
  EntityManager,
  EventBus,
  GameWorld,
  SoAComponent,
  SystemContext,
  resetEntityIdCounter,
} from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import type { FixedPoint } from '@phalanx-engine/math';
import {
  CollisionSystem,
  PhysicsBodyComponent,
  PhysicsSystem,
  PhysicsWorld,
  TransformComponent,
} from '../src/index.js';
import type { PhysicsConfig } from '../src/types.js';
import {
  readBroadphase,
  rebuildBroadphaseFromTransforms,
  writeBroadphase,
} from '../src/save/broadphase.js';

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

function physicsConfig(): PhysicsConfig {
  return {
    tickDt: FP.FromFloat(0.05),
    subSteps: 1,
    maxVelocity: FP.FromFloat(100),
    defaultFriction: FP.FromFloat(0.92),
    pushStrength: FP.FromFloat(15),
    gridCellSize: FP.FromInt(4),
  };
}

function bareContext(): SystemContext {
  return new SystemContext(new EventBus(), new EntityManager());
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
  physics.attach(world);
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
      writeBroadphase(writer, source.world);
    });

    const restored = wiredWorld(cellSize);
    const reader = new BinaryStateReader(bytes);
    readBroadphase(reader, restored.world);
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

    rebuildBroadphaseFromTransforms(world);

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
      writeBroadphase(writer, world);
    });
    expect(new TextDecoder().decode(bytes)).toContain('collisionSystem');

    const restored = new GameWorld({});
    const restoredCollision = new CollisionSystem(FP.FromInt(4));
    restored.registerSystems([restoredCollision], []);
    const reader = new BinaryStateReader(bytes);
    readBroadphase(reader, restored);
    reader.done();
    const center = restoredCollision.getBroadphaseCenters()[0];
    expect(center?.entityId).toBe(3);
    expect(FP.Eq(center?.x ?? FP._0, FP.FromInt(1))).toBe(true);
    expect(FP.Eq(center?.z ?? FP._0, FP.FromInt(2))).toBe(true);
  });

  it('registers physics.broadphase once for every grid owner', () => {
    const wired = wiredWorld();
    expect(wired.world.saveSections.map((section) => section.key)).toEqual([
      'physics.broadphase',
    ]);
    expect(wired.world.saveSections[0]?.version).toBe(1);

    const collisionOnly = new GameWorld({});
    collisionOnly.registerSystems([new CollisionSystem(FP.FromInt(4))], []);
    expect(collisionOnly.saveSections.map((section) => section.key)).toEqual([
      'physics.broadphase',
    ]);

    const physicsOnly = new GameWorld({});
    new PhysicsWorld({
      gridCellSize: FP.FromInt(4),
      subSteps: 1,
    }).attach(physicsOnly);
    expect(physicsOnly.saveSections.map((section) => section.key)).toEqual([
      'physics.broadphase',
    ]);

    const both = new GameWorld({});
    const physics = new PhysicsWorld({
      gridCellSize: FP.FromInt(4),
      subSteps: 1,
    });
    physics.attach(both);
    both.registerSystems(
      [new CollisionSystem(FP.FromInt(4)), physics.getSystems().physicsSystem],
      []
    );
    expect(both.saveSections.map((section) => section.key)).toEqual([
      'physics.broadphase',
    ]);
  });

  it('does not register a section when physics is only assigned', () => {
    const world = new GameWorld({});
    world.context.physics = new PhysicsWorld({
      gridCellSize: FP.FromInt(4),
      subSteps: 1,
    });
    expect(world.saveSections).toEqual([]);
  });

  it('treats a second attach to the same world as a no-op', () => {
    const { world, physics } = wiredWorld();
    physics.attach(world);
    expect(world.saveSections.map((section) => section.key)).toEqual([
      'physics.broadphase',
    ]);
  });

  it('throws when attach is called with a different world', () => {
    const { physics } = wiredWorld();
    expect(() => physics.attach(new GameWorld({}))).toThrow(
      'PhysicsWorld.attach: already attached to another world'
    );
  });

  it('registers physics.broadphase from PhysicsSystem without attach', () => {
    const world = new GameWorld({});
    world.registerSystems([new PhysicsSystem(physicsConfig())], []);
    expect(world.saveSections.map((section) => section.key)).toEqual([
      'physics.broadphase',
    ]);
  });

  it('throws when PhysicsSystem.init has no world', () => {
    const system = new PhysicsSystem(physicsConfig());
    expect(() => system.init(bareContext())).toThrow(
      'PhysicsSystem.init: context.world is not set'
    );
  });

  it('throws when CollisionSystem.init has no world', () => {
    const system = new CollisionSystem(FP.FromInt(4));
    expect(() => system.init(bareContext())).toThrow(
      'CollisionSystem.init: context.world is not set'
    );
  });

  it('throws when the world has no broadphase', () => {
    const world = new GameWorld({});
    expect(() => rebuildBroadphaseFromTransforms(world)).toThrow(
      /no broadphase/
    );
    expect(() =>
      finish((writer) => {
        writeBroadphase(writer, world);
      })
    ).toThrow(/no broadphase/);
  });
});
