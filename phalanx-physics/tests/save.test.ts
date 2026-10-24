import { afterEach, describe, expect, it } from 'vitest';
import {
  BinaryStateReader,
  BinaryStateWriter,
  Entity,
  EntityManager,
  EventBus,
  GameWorld,
  SystemContext,
} from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import type { FixedPoint } from '@phalanx-engine/math';
import {
  Interpolation,
  Physics,
  PhysicsSystem,
  PhysicsWorld,
  attachInterpolation,
  attachPhysicsBody,
  attachTransform,
  interpolationOf,
} from '../src/index.js';
import type { PhysicsConfig } from '../src/types.js';
import { manualTickProvider } from './support/manualTickProvider.js';
import {
  readBroadphase,
  rebuildBroadphaseFromTransforms,
  writeBroadphase,
} from '../src/save/broadphase.js';

class Disc extends Entity {
  public constructor(id: number, x: number, z: number) {
    super(id);
    attachTransform(this, {
      x: FP.FromInt(x),
      y: FP._0,
      z: FP.FromInt(z),
    });
    attachPhysicsBody(this, {
      radius: FP._1,
      mass: FP._1,
      restitution: FP.FromFloat(0.5),
      friction: FP.FromFloat(0.3),
    });
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
  const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
  const physics = new PhysicsWorld({
    gridCellSize: cellSize,
    subSteps: 1,
  });
  physics.attach(world);
  return { world, physics };
}

function addDisc(world: GameWorld, x: number, z: number): Disc {
  const disc = world.createEntity((id) => new Disc(id, x, z));
  world.entityManager.addEntity(disc);
  return disc;
}

describe('physics state helpers', () => {
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

  it('registers physics.broadphase once for every grid owner', () => {
    const wired = wiredWorld();
    expect(wired.world.saveSections.map((section) => section.key)).toEqual([
      'physics.broadphase',
    ]);
    expect(wired.world.saveSections[0]?.version).toBe(1);

    const physicsOnly = new GameWorld({
      tickFrameProvider: manualTickProvider(),
    });
    new PhysicsWorld({
      gridCellSize: FP.FromInt(4),
      subSteps: 1,
    }).attach(physicsOnly);
    expect(physicsOnly.saveSections.map((section) => section.key)).toEqual([
      'physics.broadphase',
    ]);

    const both = new GameWorld({ tickFrameProvider: manualTickProvider() });
    const physics = new PhysicsWorld({
      gridCellSize: FP.FromInt(4),
      subSteps: 1,
    });
    physics.attach(both);
    class ExtraPhysics extends PhysicsSystem {
      public override readonly name = 'ExtraPhysics';
    }
    both.addSystem(new ExtraPhysics(physicsConfig()), { phase: 'physics' });
    expect(both.saveSections.map((section) => section.key)).toEqual([
      'physics.broadphase',
    ]);
  });

  it('does not register a section when physics is only provided', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    world.provide(
      Physics,
      new PhysicsWorld({ gridCellSize: FP.FromInt(4), subSteps: 1 })
    );
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
    expect(() =>
      physics.attach(new GameWorld({ tickFrameProvider: manualTickProvider() }))
    ).toThrow('PhysicsWorld.attach: already attached to another world');
  });

  it('registers physics.broadphase from PhysicsSystem without attach', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    world.addSystem(new PhysicsSystem(physicsConfig()), { phase: 'physics' });
    expect(world.saveSections.map((section) => section.key)).toEqual([
      'physics.broadphase',
    ]);
  });

  it('restores interpolation for every body, seeded from Transform', () => {
    const { world } = wiredWorld();
    const kept = world.createEntity((id) => {
      const entity = new Entity(id);
      attachTransform(entity, {
        x: FP.FromInt(3),
        y: FP.FromInt(1),
        z: FP.FromInt(4),
      });
      attachPhysicsBody(entity, { radius: FP._1 });
      attachInterpolation(entity);
      return entity;
    });
    world.entityManager.addEntity(kept);
    const bare = world.createEntity((id) => {
      const entity = new Entity(id);
      attachTransform(entity, {
        x: FP.FromInt(8),
        y: FP._0,
        z: FP.FromInt(2),
      });
      attachPhysicsBody(entity, { radius: FP._1 });
      return entity;
    });
    world.entityManager.addEntity(bare);

    world.discardTransientComponents();
    expect(kept.hasComponent(Interpolation.type)).toBe(false);

    const bytes = finish((writer) => {
      writeBroadphase(writer, world);
    });
    const reader = new BinaryStateReader(bytes);
    readBroadphase(reader, world);
    reader.done();

    expect(kept.hasComponent(Interpolation.type)).toBe(true);
    expect(bare.hasComponent(Interpolation.type)).toBe(true);
    expect(world.getComponent(kept, Interpolation)?.currentFpPosition).toEqual({
      x: FP.FromInt(3),
      y: FP.FromInt(1),
      z: FP.FromInt(4),
    });
    expect(world.getComponent(kept, Interpolation)?.previousFpPosition).toEqual(
      world.getComponent(kept, Interpolation)?.currentFpPosition
    );
    expect(world.getComponent(bare, Interpolation)?.currentFpPosition).toEqual({
      x: FP.FromInt(8),
      y: FP._0,
      z: FP.FromInt(2),
    });
    const again = finish((writer) => {
      writeBroadphase(writer, world);
    });
    expect(again).toEqual(bytes);
  });

  it('stores interpolation in one ValueComponent for attach and world.getComponent', () => {
    const { world } = wiredWorld();
    const entity = world.createEntityWithId(1);
    const sample = attachInterpolation(entity, {
      x: FP.FromInt(2),
      y: FP._0,
      z: FP._0,
    });
    expect(world.getComponent(entity, Interpolation)).toBe(sample);
    expect(interpolationOf(entity)).toBe(sample);
    expect(sample.currentFpPosition.x).toEqual(FP.FromInt(2));
  });

  it('throws when PhysicsSystem.init has no world', () => {
    const system = new PhysicsSystem(physicsConfig());
    expect(() => system.init(bareContext())).toThrow(
      'PhysicsSystem.init: context.world is not set'
    );
  });

  it('throws when the world has no broadphase', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
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
