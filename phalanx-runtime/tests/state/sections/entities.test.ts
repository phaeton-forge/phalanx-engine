import { afterEach, describe, expect, it } from 'vitest';
import {
  Entity,
  GameSystem,
  GameWorld,
  SoAComponent,
  type IPoolableEntity,
  type ITickFrameProvider,
} from '@phalanx-engine/ecs';
import { StateHelpers } from '../../../src/advanced/StateHelpers.js';
import { BinaryStateReader, BinaryStateWriter } from '@phalanx-engine/ecs';
import { manualTickProvider } from '../../support/manualTickProvider.js';

class Unit extends Entity implements IPoolableEntity<{ hp: number }> {
  public hp = 0;

  public onSpawn(args: { hp: number }): void {
    this.hp = args.hp;
  }

  public onDespawn(): void {
    this.hp = 0;
  }
}

function finish(fill: (w: BinaryStateWriter) => void): Uint8Array {
  const writer = new BinaryStateWriter();
  fill(writer);
  return writer.finish();
}

const quietProvider: ITickFrameProvider = {
  onTick: () => () => {},
  onFrame: () => () => {},
};

class SpawnSystem extends GameSystem {
  public readonly spawned: Unit[] = [];

  public override processTick(tick: number): void {
    const pools = this.pools;
    if (pools === null) return;
    this.spawned.push(pools.spawn<Unit>('unit', { hp: tick }));
  }
}

function poolingWorld(): GameWorld {
  return new GameWorld({
    tickFrameProvider: manualTickProvider(),
    pooling: {
      entityTypes: {
        unit: { factory: (id) => new Unit(id) },
        bolt: { factory: (id) => new Unit(id) },
      },
    },
  });
}

function prewarmedWorld(system: SpawnSystem): GameWorld {
  const world = new GameWorld({
    tickFrameProvider: quietProvider,
    pooling: {
      entityTypes: {
        unit: {
          factory: (id) => new Unit(id),
          pool: { initialSize: 2 },
        },
      },
    },
  });
  world.registerSystems([system], []);
  world.start();
  return world;
}

describe('entity and pool state helpers', () => {
  afterEach(() => {
    SoAComponent.resetContext();
  });

  it('saves and restores the entity id counter only', () => {
    const source = new GameWorld({ tickFrameProvider: manualTickProvider() });
    const first = source.createEntity((id) => new Entity(id));
    const second = source.createEntity((id) => new Entity(id));
    source.entityManager.addEntity(first);
    source.entityManager.addEntity(second);
    expect(source.entityManager.entityIdHighWater()).toBe(2);

    const bytes = finish((writer) => {
      StateHelpers.writeEntityIds(writer, source);
    });

    const restored = new GameWorld({ tickFrameProvider: manualTickProvider() });
    const reader = new BinaryStateReader(bytes);
    StateHelpers.readEntityIds(reader, restored);
    reader.done();

    expect(restored.entityManager.entityIdHighWater()).toBe(2);
    const next = restored.createEntity((id) => new Entity(id));
    expect(next.id).toBe(3);
  });

  it('createEntityWithId constructs one entity with that id', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    const high = world.createEntityWithId(5, (id) => new Entity(id));
    expect(high.id).toBe(5);
    expect(world.entityManager.getEntity(5)).toBe(high);

    const hole = world.createEntityWithId(2, (id) => new Entity(id));
    expect(hole.id).toBe(2);
    expect(world.entityManager.entityIdHighWater()).toBe(5);

    const next = world.createEntity((id) => new Entity(id));
    expect(next.id).toBe(6);

    expect(() => world.createEntityWithId(2, (id) => new Entity(id))).toThrow(
      'createEntityWithId: entity 2 already exists'
    );
    expect(() => world.createEntityWithId(0)).toThrow(/integer >= 1/);

    const before = world.entityManager.entityIdHighWater();
    expect(() =>
      world.createEntityWithId(8, () => {
        throw new Error('nope');
      })
    ).toThrow('nope');
    expect(world.entityManager.entityIdHighWater()).toBe(before);

    expect(() => world.createEntityWithId(9, () => new Entity(1))).toThrow(
      /factory must return the entity with id 9/
    );
    expect(world.entityManager.entityIdHighWater()).toBe(before);
  });

  it('round-trips pool ownership and the LIFO free list', () => {
    const source = poolingWorld();
    const pools = source.pools;
    if (pools === null) {
      throw new Error('expected pools');
    }
    const first = pools.spawn<Unit>('unit', { hp: 1 });
    const second = pools.spawn<Unit>('unit', { hp: 2 });
    const third = pools.spawn<Unit>('unit', { hp: 3 });
    pools.despawn(first);
    pools.despawn(third);

    const owned = [...pools.ownedIds('unit')];
    const free = [...pools.freeListIds('unit')];
    expect(free).toEqual([first.id, third.id]);
    expect(owned).toEqual([first.id, second.id, third.id]);

    const bytes = finish((writer) => {
      StateHelpers.writePools(writer, source);
    });
    expect(bytes.indexOf(0x75)).toBeLessThan(bytes.indexOf(0x62)); // 'u' before 'b'

    const restored = poolingWorld();
    const restoredPools = restored.pools;
    if (restoredPools === null) {
      throw new Error('expected pools');
    }

    const reader = new BinaryStateReader(bytes);
    StateHelpers.readPools(reader, restored);
    reader.done();

    const again = finish((writer) => {
      StateHelpers.writePools(writer, restored);
    });
    expect(again).toEqual(bytes);

    expect(restored.entityManager.getEntity(second.id)?.id).toBe(second.id);
    expect(restored.entityManager.getEntity(first.id)).toBeUndefined();
    expect(restored.entityManager.getEntity(third.id)).toBeUndefined();

    const spawned = restoredPools.spawn<Unit>('unit', { hp: 9 });
    expect(spawned.id).toBe(third.id);
    expect(spawned.hp).toBe(9);
    const after = restoredPools.spawn<Unit>('unit', { hp: 4 });
    expect(after.id).toBe(first.id);
  });

  it('discards prewarm and continues tick-for-tick after readPools', () => {
    const sourceSystem = new SpawnSystem();
    const source = prewarmedWorld(sourceSystem);
    const pools = source.pools;
    if (pools === null) {
      throw new Error('expected pools');
    }
    const live = pools.spawn<Unit>('unit', { hp: 4 });
    source.entityManager.allocateEntityId();
    expect(source.entityManager.entityIdHighWater()).toBe(3);

    const bytes = finish((writer) => {
      StateHelpers.writePools(writer, source);
      StateHelpers.writeEntityIds(writer, source);
    });

    source.processAllTicks(1);
    source.processAllTicks(2);
    const continued = sourceSystem.spawned.map((unit) => ({
      id: unit.id,
      hp: unit.hp,
    }));
    expect(continued.map((unit) => unit.id)).toEqual([1, 4]);

    const restoredSystem = new SpawnSystem();
    const restored = prewarmedWorld(restoredSystem);
    const restoredPools = restored.pools;
    if (restoredPools === null) {
      throw new Error('expected pools');
    }
    expect(restoredPools.ownedIds('unit').length).toBeGreaterThan(0);

    const reader = new BinaryStateReader(bytes);
    StateHelpers.readPools(reader, restored);
    StateHelpers.readEntityIds(reader, restored);
    reader.done();

    expect(restored.entityManager.entityIdHighWater()).toBe(3);
    expect(restored.entityManager.getEntity(live.id)?.id).toBe(live.id);
    expect(restoredPools.freeListIds('unit')).toEqual([1]);

    restored.processAllTicks(1);
    restored.processAllTicks(2);
    expect(
      restoredSystem.spawned.map((unit) => ({ id: unit.id, hp: unit.hp }))
    ).toEqual(continued);
  });
});
