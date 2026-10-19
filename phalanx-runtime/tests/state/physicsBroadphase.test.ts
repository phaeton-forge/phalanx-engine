import { afterEach, describe, expect, it } from 'vitest';
import {
  BinaryStateReader,
  BinaryStateWriter,
  Entity,
  GameWorld,
  SoAComponent,
  resetEntityIdCounter,
} from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import type { FixedPoint } from '@phalanx-engine/math';
import {
  PhysicsBodyComponent,
  PhysicsSoASchema,
  PhysicsWorld,
  TransformComponent,
  TransformSoASchema,
} from '@phalanx-engine/physics';
import { StateHelpers } from '../../src/advanced/index.js';
import { manualTickProvider } from '../support/manualTickProvider.js';

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
  const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
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

describe('physics broadphase save', () => {
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
      StateHelpers.writeModuleSections(writer, world);
    });

    const restored = wiredWorld();
    addDisc(restored.world, 0, 0);
    addDisc(restored.world, 0, 0);
    const reader = new BinaryStateReader(bytes);
    StateHelpers.readSoAStores(reader, restored.world, SCHEMAS);
    StateHelpers.readModuleSections(reader, restored.world);
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
      StateHelpers.writeModuleSections(writer, restored.world);
    });
    expect(again).toEqual(bytes);

    restored.physics.rebuildBroadphase();
    const rebuiltQuery = [
      ...restored.physics.spatialGrid.queryRadius(moved.x, moved.z, FP._0),
    ];
    expect(rebuiltQuery).not.toEqual(liveQuery);
  });
});
