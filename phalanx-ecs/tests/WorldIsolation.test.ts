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
    a.add(a2, Counter, { n: 7n });
    b.add(b1, Counter, { n: 9n });
    const pooled = a.pools?.spawn<PooledCounter>('counter', 5n);

    expect(a1.id).toBe(1);
    expect(b1.id).toBe(1);
    expect(a.entityManager.getSoAStore(Counter.schema)?.entityIds()).toEqual([
      1, 2, 3,
    ]);
    expect(b.entityManager.getSoAStore(Counter.schema)?.entityIds()).toEqual([
      1,
    ]);
    expect(a.get(a1, Counter)).toEqual({ n: 1n });
    expect(a.get(a2, Counter)).toEqual({ n: 7n });
    expect(pooled === undefined ? undefined : a.get(pooled, Counter)).toEqual({
      n: 5n,
    });
    expect(b.get(b1, Counter)).toEqual({ n: 9n });

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
    b.add(b2, Counter, { n: 4n });
    const pooled = b.pools?.spawn<PooledCounter>('counter', 6n);
    expect(b.get(b1, Counter)).toEqual({ n: 1n });
    expect(b.get(b2, Counter)).toEqual({ n: 4n });
    expect(pooled === undefined ? undefined : b.get(pooled, Counter)).toEqual({
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
});
