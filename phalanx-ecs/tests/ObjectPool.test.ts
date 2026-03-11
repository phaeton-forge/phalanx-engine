import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectPool } from '../src/pool/ObjectPool';
import type { IPoolable } from '../src/pool/IPoolable';

class TestPoolable implements IPoolable {
  public value: number = 0;
  public resetCount: number = 0;

  reset(): void {
    this.value = 0;
    this.resetCount++;
  }
}

describe('ObjectPool', () => {
  it('creates objects via factory when pool is empty', () => {
    let factoryCalls = 0;
    const pool = new ObjectPool<TestPoolable>(() => {
      factoryCalls++;
      return new TestPoolable();
    });

    const obj = pool.acquire();
    expect(obj).toBeInstanceOf(TestPoolable);
    expect(factoryCalls).toBe(1);
    expect(pool.availableCount).toBe(0);
  });

  it('reuses objects after release (LIFO)', () => {
    let factoryCalls = 0;
    const pool = new ObjectPool<TestPoolable>(() => {
      factoryCalls++;
      return new TestPoolable();
    });

    const obj1 = pool.acquire();
    obj1.value = 42;
    pool.release(obj1);
    expect(pool.availableCount).toBe(1);

    const obj2 = pool.acquire();
    expect(obj2).toBe(obj1);
    expect(obj2.value).toBe(0); // reset was called
    expect(factoryCalls).toBe(1);
  });

  it('calls reset() on release', () => {
    const pool = new ObjectPool<TestPoolable>(() => new TestPoolable());

    const obj = pool.acquire();
    obj.value = 100;
    pool.release(obj);
    expect(obj.value).toBe(0);
    expect(obj.resetCount).toBe(1);
  });

  it('respects maxSize limit', () => {
    const pool = new ObjectPool<TestPoolable>(() => new TestPoolable(), {
      maxSize: 2,
    });

    const a = pool.acquire();
    const b = pool.acquire();
    const c = pool.acquire();

    pool.release(a);
    pool.release(b);
    pool.release(c); // should be discarded

    expect(pool.availableCount).toBe(2);
  });

  it('maxSize 0 means unlimited', () => {
    const pool = new ObjectPool<TestPoolable>(() => new TestPoolable(), {
      maxSize: 0,
    });

    const objects: TestPoolable[] = [];
    for (let i = 0; i < 100; i++) {
      objects.push(pool.acquire());
    }
    for (const obj of objects) {
      pool.release(obj);
    }
    expect(pool.availableCount).toBe(100);
  });

  it('prewarm fills the pool', () => {
    const pool = new ObjectPool<TestPoolable>(() => new TestPoolable());

    pool.prewarm(10);
    expect(pool.availableCount).toBe(10);
    expect(pool.totalCreated).toBe(10);

    // prewarm to lower count does nothing
    pool.prewarm(5);
    expect(pool.availableCount).toBe(10);
  });

  it('drain clears the pool', () => {
    const pool = new ObjectPool<TestPoolable>(() => new TestPoolable());
    pool.prewarm(10);
    pool.drain();
    expect(pool.availableCount).toBe(0);
  });

  it('tracks stats correctly', () => {
    const pool = new ObjectPool<TestPoolable>(() => new TestPoolable());

    // First acquire = miss
    const obj1 = pool.acquire();
    expect(pool.stats.missCount).toBe(1);
    expect(pool.stats.acquireCount).toBe(1);

    pool.release(obj1);
    expect(pool.stats.releaseCount).toBe(1);

    // Second acquire = from pool, no miss
    pool.acquire();
    expect(pool.stats.missCount).toBe(1);
    expect(pool.stats.acquireCount).toBe(2);
  });

  it('growth strategy "grow" creates batch', () => {
    const pool = new ObjectPool<TestPoolable>(() => new TestPoolable(), {
      growthStrategy: 'grow',
      growthBatchSize: 4,
    });

    // First acquire triggers batch creation (4 total: 3 in pool + 1 returned)
    pool.acquire();
    expect(pool.availableCount).toBe(3);
    expect(pool.totalCreated).toBe(4);
  });

  it('uses LIFO order (stack)', () => {
    const pool = new ObjectPool<TestPoolable>(() => new TestPoolable());

    const a = pool.acquire();
    const b = pool.acquire();
    pool.release(a);
    pool.release(b);

    expect(pool.acquire()).toBe(b); // last in, first out
    expect(pool.acquire()).toBe(a);
  });

  it('growth strategy "create" creates single object', () => {
    const pool = new ObjectPool<TestPoolable>(() => new TestPoolable(), {
      growthStrategy: 'create',
    });

    pool.acquire();
    expect(pool.availableCount).toBe(0);
    expect(pool.totalCreated).toBe(1);
  });
});
