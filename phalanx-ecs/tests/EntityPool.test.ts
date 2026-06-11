import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, EntityPool, resetEntityIdCounter } from '../src';

describe('EntityPool', () => {
  beforeEach(() => {
    resetEntityIdCounter();
  });

  it('creates entities via factory', () => {
    let factoryCalls = 0;
    const pool = new EntityPool(() => {
      factoryCalls++;
      return new Entity();
    });

    const entity = pool.acquire();
    expect(entity).toBeInstanceOf(Entity);
    expect(factoryCalls).toBe(1);
  });

  it('keeps the same ID when reusing an entity', () => {
    const pool = new EntityPool(() => new Entity());

    const e1 = pool.acquire();
    const id1 = e1.id;

    pool.release(e1);
    const e2 = pool.acquire();

    expect(e2).toBe(e1);
    expect(e2.id).toBe(id1);
  });

  it('revives entity on acquire', () => {
    const pool = new EntityPool(() => new Entity());

    const entity = pool.acquire();
    entity.destroy();
    expect(entity.isDestroyed).toBe(true);

    pool.release(entity);
    const reused = pool.acquire();
    expect(reused.isDestroyed).toBe(false);
  });

  it('preserves attached components across release/acquire', () => {
    const TestType = Symbol('Test');
    const pool = new EntityPool(() => {
      const entity = new Entity();
      entity.addComponent({ type: TestType });
      return entity;
    });

    const entity = pool.acquire();
    expect(entity.hasComponent(TestType)).toBe(true);

    pool.release(entity);
    const reused = pool.acquire();

    expect(reused).toBe(entity);
    expect(reused.hasComponent(TestType)).toBe(true);
  });

  it('prewarm creates dormant entities', () => {
    const pool = new EntityPool(() => new Entity());

    pool.prewarm(5);
    expect(pool.availableCount).toBe(5);
    expect(pool.stats.totalCreated).toBe(5);
  });

  it('tracks stats', () => {
    const pool = new EntityPool(() => new Entity());

    const e1 = pool.acquire();
    expect(pool.stats.acquireCount).toBe(1);
    expect(pool.stats.missCount).toBe(1);

    pool.release(e1);
    expect(pool.stats.releaseCount).toBe(1);

    pool.acquire();
    expect(pool.stats.acquireCount).toBe(2);
    expect(pool.stats.missCount).toBe(1);
  });

  it('respects maxSize', () => {
    const pool = new EntityPool(() => new Entity(), { maxSize: 2 });

    const a = pool.acquire();
    const b = pool.acquire();
    const c = pool.acquire();

    pool.release(a);
    pool.release(b);
    pool.release(c);

    expect(pool.availableCount).toBe(2);
  });

  it('drain clears all available', () => {
    const pool = new EntityPool(() => new Entity());
    pool.prewarm(10);
    pool.drain();
    expect(pool.availableCount).toBe(0);
  });

  it('IDs are globally sequential', () => {
    const pool = new EntityPool(() => new Entity());

    const e1 = pool.acquire();
    const id1 = e1.id;

    const regular = new Entity();
    expect(regular.id).toBe(id1 + 1);

    pool.release(e1);
    const e2 = pool.acquire();
    expect(e2.id).toBe(id1);
  });

  it('discards overflow entities via dispose()', () => {
    const pool = new EntityPool(() => new Entity(), { maxSize: 1 });

    const a = pool.acquire();
    const b = pool.acquire();
    pool.release(a);
    pool.release(b);

    expect(pool.availableCount).toBe(1);
    expect(b.isDestroyed).toBe(true);
  });
});
