import { afterEach, describe, expect, it } from 'vitest';
import {
  Entity,
  GameWorld,
  SoAComponent,
  resetEntityIdCounter,
  type IPoolableEntity,
} from '@phalanx-engine/ecs';
import { StateHelpers } from '../../src/helpers/StateHelpers.js';
import {
  BinaryStateReader,
  BinaryStateWriter,
} from '../../src/state/BinaryState.js';

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

function poolingWorld(): GameWorld {
  return new GameWorld({
    pooling: {
      entityTypes: {
        unit: { factory: () => new Unit() },
        bolt: { factory: () => new Unit() },
      },
    },
  });
}

describe('entity and pool state helpers', () => {
  afterEach(() => {
    SoAComponent.resetContext();
    resetEntityIdCounter();
  });

  it('saves and restores the entity id counter only', () => {
    const source = new GameWorld({});
    const first = new Entity();
    const second = new Entity();
    source.entityManager.addEntity(first);
    source.entityManager.addEntity(second);
    expect(source.getEntityIdCounter()).toBe(2);

    const bytes = finish((writer) => {
      StateHelpers.writeEntityIds(writer, source);
    });

    const restored = new GameWorld({});
    const reader = new BinaryStateReader(bytes);
    StateHelpers.readEntityIds(reader, restored);
    reader.done();

    expect(restored.getEntityIdCounter()).toBe(2);
    const next = new Entity();
    expect(next.id).toBe(3);
  });

  it('spawnWithId constructs one entity with that id', () => {
    const world = new GameWorld({});
    const high = StateHelpers.spawnWithId(world, 5, () => new Entity());
    expect(high.id).toBe(5);
    expect(world.entityManager.getEntity(5)).toBe(high);

    const hole = StateHelpers.spawnWithId(world, 2, () => new Entity());
    expect(hole.id).toBe(2);
    expect(world.getEntityIdCounter()).toBe(5);

    const next = new Entity();
    expect(next.id).toBe(6);

    expect(() =>
      StateHelpers.spawnWithId(world, 2, () => new Entity())
    ).toThrow('spawnWithId: entity 2 already exists');
    expect(() =>
      StateHelpers.spawnWithId(world, 0, () => new Entity())
    ).toThrow(/integer >= 1/);

    const before = world.getEntityIdCounter();
    expect(() =>
      StateHelpers.spawnWithId(world, 8, () => {
        throw new Error('nope');
      })
    ).toThrow('nope');
    expect(world.getEntityIdCounter()).toBe(before);

    expect(() =>
      StateHelpers.spawnWithId(world, 9, () => {
        new Entity();
        return new Entity();
      })
    ).toThrow(/exactly one entity/);
    expect(world.getEntityIdCounter()).toBe(before);
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
    const byId = new Map<number, Unit>();
    for (const id of owned) {
      const entity = StateHelpers.spawnWithId(restored, id, () => new Unit());
      byId.set(id, entity);
    }

    const reader = new BinaryStateReader(bytes);
    StateHelpers.readPools(reader, restored);
    reader.done();

    const again = finish((writer) => {
      StateHelpers.writePools(writer, restored);
    });
    expect(again).toEqual(bytes);

    expect(restored.entityManager.getEntity(second.id)).toBe(
      byId.get(second.id)
    );
    expect(restored.entityManager.getEntity(first.id)).toBeUndefined();
    expect(restored.entityManager.getEntity(third.id)).toBeUndefined();

    const spawned = restoredPools.spawn<Unit>('unit', { hp: 9 });
    expect(spawned.id).toBe(third.id);
    expect(spawned).toBe(byId.get(third.id));
    expect(spawned.hp).toBe(9);
    const after = restoredPools.spawn<Unit>('unit', { hp: 4 });
    expect(after.id).toBe(first.id);
  });

  it('rejects a pool restore when an owned entity is missing', () => {
    const source = poolingWorld();
    const pools = source.pools;
    if (pools === null) {
      throw new Error('expected pools');
    }
    const unit = pools.spawn<Unit>('unit', { hp: 1 });
    const bytes = finish((writer) => {
      StateHelpers.writePools(writer, source);
    });
    const restored = poolingWorld();
    const reader = new BinaryStateReader(bytes);
    expect(() => StateHelpers.readPools(reader, restored)).toThrow(
      `readPools: missing entity ${String(unit.id)} for pool 'unit'`
    );
  });
});
