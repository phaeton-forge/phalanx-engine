import { describe, it, expect, beforeEach } from 'vitest';
import {
  Entity,
  EntityManager,
  EntityPool,
  PoolManager,
  resetEntityIdCounter,
  type IPoolableEntity,
} from '../src';

class UnitEntity extends Entity implements IPoolableEntity<{ hp: number }> {
  public hp = 0;

  onSpawn(args: { hp: number }): void {
    this.hp = args.hp;
  }

  onDespawn(): void {
    this.hp = 0;
  }
}

describe('pool state accessors', () => {
  beforeEach(() => {
    resetEntityIdCounter();
  });

  it('owned ids stay in creation order and the free list is oldest-first', () => {
    const pool = new EntityPool(() => new Entity());
    pool.prewarm(3);

    const owned = pool.ownedIds();
    expect(owned).toEqual(pool.freeListIds());
    expect(owned).toHaveLength(3);

    const acquired = pool.acquire();
    expect(acquired.id).toBe(owned[2]);
    expect(pool.freeListIds()).toEqual([owned[0], owned[1]]);
    expect(pool.ownedIds()).toEqual(owned);

    pool.release(acquired);
    expect(pool.freeListIds()).toEqual(owned);
    expect(pool.acquire().id).toBe(owned[2]);
  });

  it('drops an entity that release disposes because maxSize is full', () => {
    const pool = new EntityPool(() => new Entity(), { maxSize: 1 });
    const first = pool.acquire();
    const second = pool.acquire();

    pool.release(first);
    pool.release(second);

    expect(pool.freeListIds()).toEqual([first.id]);
    expect(pool.ownedIds()).toEqual([first.id]);
    expect(second.isDestroyed).toBe(true);
  });

  it('drain forgets free-list entities and keeps checked-out ones', () => {
    const pool = new EntityPool(() => new Entity());
    pool.prewarm(2);
    const checkedOut = pool.acquire();
    const freed = pool.freeListIds()[0];

    pool.drain();

    expect(pool.freeListIds()).toEqual([]);
    expect(pool.ownedIds()).toEqual([checkedOut.id]);
    expect(pool.ownedIds()).not.toContain(freed);
  });

  it('PoolManager reports registration order, owned ids, and LIFO free list', () => {
    const manager = new PoolManager(new EntityManager());
    manager.registerEntityType('unit', {
      factory: () => new UnitEntity(),
    });
    manager.registerEntityType('bolt', {
      factory: () => new UnitEntity(),
    });
    manager.prewarm('unit', 3);

    expect(manager.typeKeys()).toEqual(['unit', 'bolt']);
    const owned = manager.ownedIds('unit');
    expect(manager.freeListIds('unit')).toEqual(owned);
    expect(manager.freeListIds('bolt')).toEqual([]);

    const spawned = manager.spawn<UnitEntity>('unit', { hp: 4 });
    expect(spawned.id).toBe(owned[2]);
    expect(spawned.hp).toBe(4);
    expect(manager.freeListIds('unit')).toEqual([owned[0], owned[1]]);
    expect(manager.ownedIds('unit')).toEqual(owned);

    manager.despawn(spawned);
    expect(manager.freeListIds('unit')).toEqual(owned);
    expect(() => manager.ownedIds('missing')).toThrow(/not registered/);
  });
});
