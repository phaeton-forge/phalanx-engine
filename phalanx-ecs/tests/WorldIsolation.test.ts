import { describe, expect, it } from 'vitest';
import {
  Entity,
  GameWorld,
  defineComponent,
  type IPoolableEntity,
  type ITickFrameProvider,
} from '../src';

const Counter = defineComponent(
  'Counter',
  { n: 'i64' },
  {
    defaults: { n: 1n },
  }
);

function manualProvider(): ITickFrameProvider {
  return {
    onTick: () => () => {},
    onFrame: () => () => {},
  };
}

class CounterEntity extends Entity {
  public constructor(id: number) {
    super(id);
    this.addComponent(Counter.create(id));
  }
}

class PooledCounter extends Entity implements IPoolableEntity<bigint> {
  public constructor(id: number) {
    super(id);
    this.addComponent(Counter.create(id));
  }

  public onSpawn(n: bigint): void {
    const store = this._owner?.getSoAStore(Counter.schema);
    const index = store?.indexOf(this.id) ?? -1;
    if (store !== undefined && index >= 0) store.arrays.n[index] = n;
  }

  public onDespawn(): void {}
}

function openWorld(): GameWorld {
  const world = new GameWorld({
    tickFrameProvider: manualProvider(),
    pooling: {
      entityTypes: {
        counter: { factory: (id) => new PooledCounter(id) },
      },
      autoPrewarm: false,
    },
  });
  world.registerComponent(Counter);
  return world;
}

function spawnCounter(world: GameWorld): CounterEntity {
  const entity = world.createEntity((id) => new CounterEntity(id));
  world.entityManager.addEntity(entity);
  return entity;
}

describe('world isolation', () => {
  it('writes rows into the creating world when two worlds interleave', () => {
    const a = openWorld();
    const a1 = spawnCounter(a);
    const b = openWorld();
    const b1 = spawnCounter(b);
    const a2 = spawnCounter(a);
    a.addComponent(a2, Counter, { n: 7n });
    b.addComponent(b1, Counter, { n: 9n });
    const pooled = a.pools?.spawn<PooledCounter>('counter', 5n);

    expect(a1.id).toBe(1);
    expect(b1.id).toBe(1);
    expect(a.entityManager.getSoAStore(Counter.schema)?.entityIds()).toEqual([
      1, 2, 3,
    ]);
    expect(b.entityManager.getSoAStore(Counter.schema)?.entityIds()).toEqual([
      1,
    ]);
    expect(a.getComponent(a1, Counter)).toEqual({ n: 1n });
    expect(a.getComponent(a2, Counter)).toEqual({ n: 7n });
    expect(
      pooled === undefined ? undefined : a.getComponent(pooled, Counter)
    ).toEqual({
      n: 5n,
    });
    expect(b.getComponent(b1, Counter)).toEqual({ n: 9n });

    a.dispose();
    b.dispose();
  });

  it('keeps the other world working after one is disposed', () => {
    const a = openWorld();
    const b = openWorld();
    spawnCounter(a);
    const b1 = spawnCounter(b);
    a.dispose();

    const b2 = spawnCounter(b);
    b.addComponent(b2, Counter, { n: 4n });
    const pooled = b.pools?.spawn<PooledCounter>('counter', 6n);
    expect(b.getComponent(b1, Counter)).toEqual({ n: 1n });
    expect(b.getComponent(b2, Counter)).toEqual({ n: 4n });
    expect(
      pooled === undefined ? undefined : b.getComponent(pooled, Counter)
    ).toEqual({
      n: 6n,
    });
    expect(b.entityManager.getSoAStore(Counter.schema)?.entityIds()).toEqual([
      1, 2, 3,
    ]);
    b.dispose();
  });

  it('rejects adding an entity owned by another world', () => {
    const a = openWorld();
    const b = openWorld();
    const entity = a.createEntity((id) => new CounterEntity(id));
    expect(() => b.entityManager.addEntity(entity)).toThrow(
      /belongs to another world/
    );
    expect(b.entityManager.getSoAStore(Counter.schema)?.entityIds()).toEqual(
      []
    );
    a.dispose();
    b.dispose();
  });

  it('leaves the owner unset when a row is bound to another world', () => {
    const a = openWorld();
    const b = openWorld();
    const entity = new Entity(1);
    entity.addComponent(Counter.create(1, {}, a.entityManager));
    expect(() => b.entityManager.addEntity(entity)).toThrow(
      /SoA row in another world/
    );
    expect(entity._owner).toBeNull();
    a.entityManager.addEntity(entity);
    expect(entity._owner).toBe(a.entityManager);
    a.dispose();
    b.dispose();
  });

  it('runs SoA onCreate once the row is in a store', () => {
    const world = openWorld();
    const seen: number[] = [];
    const Hooked = defineComponent(
      'Hooked',
      { n: 'i32' },
      {
        onCreate: () => {
          seen.push(
            world.entityManager.getSoAStore(Hooked.schema)?.indexOf(7) ?? -2
          );
        },
      }
    );
    const entity = new Entity(7);
    entity.addComponent(Hooked.create(7));
    expect(seen).toEqual([]);
    world.entityManager.addEntity(entity);
    expect(seen).toEqual([0]);
    world.dispose();
  });
});
