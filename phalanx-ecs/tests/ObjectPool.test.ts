import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectPool } from '../src/pool/ObjectPool';
import type { IPoolable } from '../src/pool/IPoolable';

class TestPoolable implements IPoolable {
  public value: number = 42;
  public resetCount: number = 0;

  reset(): void {
    this.value = 0;
    this.resetCount++;
  }
}

describe('ObjectPool', () => {
  let pool: ObjectPool<TestPoolable>;

  beforeEach(() => {
    pool = new ObjectPool(() => new TestPoolable());
  });

  it('should create a new object when pool is empty', () => {
    const obj = pool.acquire();
    expect(obj).toBeInstanceOf(TestPoolable);
    expect(obj.value).toBe(0); // reset() was called
  });

  it('should reuse released objects', () => {
    const obj1 = pool.acquire();
    obj1.value = 99;
    pool.release(obj1);

    const obj2 = pool.acquire();
    expect(obj2).toBe(obj1); // same instance
    expect(obj2.value).toBe(0); // reset on acquire
  });

  it('should call reset() on release and acquire', () => {
    const obj = pool.acquire();
    expect(obj.resetCount).toBe(1); // reset on first acquire (factory + reset)

    pool.release(obj);
    expect(obj.resetCount).toBe(2); // reset on release

    pool.acquire();
    expect(obj.resetCount).toBe(3); // reset on re-acquire
  });

  it('should prewarm with specified count', () => {
    pool.prewarm(5);
    expect(pool.availableCount).toBe(5);
    expect(pool.totalCreated).toBe(5);
  });

  it('should respect initialSize config', () => {
    const poolWithInit = new ObjectPool(() => new TestPoolable(), {
      initialSize: 10,
    });
    expect(poolWithInit.availableCount).toBe(10);
    expect(poolWithInit.totalCreated).toBe(10);
  });

  it('should respect maxSize on release', () => {
    const poolWithMax = new ObjectPool(() => new TestPoolable(), {
      maxSize: 2,
    });

    const a = poolWithMax.acquire();
    const b = poolWithMax.acquire();
    const c = poolWithMax.acquire();

    poolWithMax.release(a);
    poolWithMax.release(b);
    poolWithMax.release(c); // should be discarded

    expect(poolWithMax.availableCount).toBe(2);
  });

  it('should respect maxSize on prewarm', () => {
    const poolWithMax = new ObjectPool(() => new TestPoolable(), {
      maxSize: 3,
    });
    poolWithMax.prewarm(10);
    expect(poolWithMax.availableCount).toBe(3);
  });

  it('should drain all objects', () => {
    pool.prewarm(5);
    expect(pool.availableCount).toBe(5);

    pool.drain();
    expect(pool.availableCount).toBe(0);
  });

  it('should grow in batch when growthStrategy is grow', () => {
    const batchPool = new ObjectPool(() => new TestPoolable(), {
      growthStrategy: 'grow',
      growthBatchSize: 4,
    });

    // First acquire triggers batch grow of 4, then pops one
    const obj = batchPool.acquire();
    expect(obj).toBeInstanceOf(TestPoolable);
    expect(batchPool.availableCount).toBe(3); // 4 created, 1 acquired
    expect(batchPool.totalCreated).toBe(4);
  });

  it('should track stats correctly', () => {
    const obj1 = pool.acquire(); // miss (empty pool)
    const obj2 = pool.acquire(); // miss

    pool.release(obj1);
    pool.release(obj2);

    pool.acquire(); // hit (pool has 2)

    const stats = pool.stats;
    expect(stats.acquireCount).toBe(3);
    expect(stats.releaseCount).toBe(2);
    expect(stats.missCount).toBe(2);
    expect(stats.available).toBe(1);
    expect(stats.totalCreated).toBe(2);
  });

  it('should use LIFO order (stack)', () => {
    const a = pool.acquire();
    const b = pool.acquire();

    pool.release(a);
    pool.release(b);

    // LIFO: b was pushed last, so it comes out first
    expect(pool.acquire()).toBe(b);
    expect(pool.acquire()).toBe(a);
  });
});
