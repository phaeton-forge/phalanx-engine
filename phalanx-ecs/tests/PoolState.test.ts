import { describe, it, expect } from 'vitest';
import {
  Entity,
  EntityManager,
  EntityPool,
  PoolManager,
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

function plainEntities(): () => Entity {
  let next = 0;
  return () => {
    next += 1;
    return new Entity(next);
  };
}

describe('pool state accessors', () => {
  it('owned ids stay in creation order and the free list is oldest-first', () => {
    const pool = new EntityPool(plainEntities());
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
    const pool = new EntityPool(plainEntities(), { maxSize: 1 });
    const first = pool.acquire();
    const second = pool.acquire();

    pool.release(first);
    pool.release(second);

    expect(pool.freeListIds()).toEqual([first.id]);
    expect(pool.ownedIds()).toEqual([first.id]);
    expect(second.isDestroyed).toBe(true);
  });

  it('drain forgets free-list entities and keeps checked-out ones', () => {
    const pool = new EntityPool(plainEntities());
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
      factory: (id) => new UnitEntity(id),
    });
    manager.registerEntityType('bolt', {
      factory: (id) => new UnitEntity(id),
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

  it('restore puts a non-empty free list back so the next spawn id matches', () => {
    const manager = new PoolManager(new EntityManager());
    manager.registerEntityType('unit', {
      factory: (id) => new UnitEntity(id),
    });
    const first = manager.spawn<UnitEntity>('unit', { hp: 1 });
    const second = manager.spawn<UnitEntity>('unit', { hp: 2 });
    const third = manager.spawn<UnitEntity>('unit', { hp: 3 });
    manager.despawn(first);
    manager.despawn(third);

    const free = manager.freeListIds('unit');
    expect(free).toEqual([first.id, third.id]);
    const expectedId = free[free.length - 1];

    const restored = new PoolManager(new EntityManager());
    restored.registerEntityType('unit', {
      factory: (id) => new UnitEntity(id),
    });
    const copies = [first, second, third].map((entity) =>
      restored.createForRestore('unit', entity.id)
    );
    restored.restore('unit', copies, free);

    const spawned = restored.spawn<UnitEntity>('unit', { hp: 9 });
    expect(spawned.id).toBe(expectedId);
    expect(spawned).toBe(copies[2]);
    expect(spawned.hp).toBe(9);

    const next = restored.spawn<UnitEntity>('unit', { hp: 4 });
    expect(next.id).toBe(first.id);
    expect(() => restored.restore('missing', [], [])).toThrow(/not registered/);
  });

  it('drops an entity disposed outside despawn', () => {
    const manager = new PoolManager(new EntityManager());
    manager.registerEntityType('unit', {
      factory: (id) => new UnitEntity(id),
    });
    const live = manager.spawn<UnitEntity>('unit', { hp: 1 });
    const dead = manager.spawn<UnitEntity>('unit', { hp: 2 });
    const deadId = dead.id;
    dead.dispose();

    expect(dead.isDestroyed).toBe(true);
    expect(manager.ownedIds('unit')).toEqual([live.id]);
    expect(manager.ownedIds('unit')).not.toContain(deadId);

    manager.despawn(live);
    const freedId = live.id;
    live.dispose();
    expect(manager.ownedIds('unit')).toEqual([]);
    expect(manager.freeListIds('unit')).toEqual([]);
    expect(manager.freeListIds('unit')).not.toContain(freedId);

    const spawned = manager.spawn<UnitEntity>('unit', { hp: 3 });
    expect(spawned.id).not.toBe(freedId);
    expect(spawned.id).not.toBe(deadId);
  });
});
