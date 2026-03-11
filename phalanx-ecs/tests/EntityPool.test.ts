import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIdCounter } from '../src/Entity';
import { EntityPool } from '../src/pool/EntityPool';
import type { IComponent } from '../src/Component';
import type { IResettableComponent } from '../src/pool/IResettableComponent';

const TestType = Symbol('Test');

class TestResettableComponent implements IResettableComponent {
  readonly type = TestType;
  public value: number = 0;

  reset(): void {
    this.value = 0;
  }

  reinitialize(value: number): void {
    this.value = value;
  }
}

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

  it('assigns new ID on acquire', () => {
    const pool = new EntityPool(() => new Entity());

    const e1 = pool.acquire();
    const id1 = e1.id;

    pool.release(e1);
    const e2 = pool.acquire();

    expect(e2).toBe(e1); // same instance
    expect(e2.id).not.toBe(id1); // new ID
    expect(e2.id).toBeGreaterThan(id1);
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

  it('clears components on release via reset()', () => {
    const pool = new EntityPool(() => new Entity());

    const entity = pool.acquire();
    entity.addComponent(new TestResettableComponent());
    expect(entity.hasComponent(TestType)).toBe(true);

    pool.release(entity);

    const reused = pool.acquire();
    expect(reused.hasComponent(TestType)).toBe(false);
  });

  it('prewarm creates entities with template components', () => {
    const pool = new EntityPool(() => new Entity(), {
      componentTemplates: [
        { type: TestType, factory: () => new TestResettableComponent() },
      ],
    });

    pool.prewarm(5);
    expect(pool.availableCount).toBe(5);
    expect(pool.stats.totalCreated).toBe(5);

    // Acquire and verify template component exists
    const entity = pool.acquire();
    expect(entity.hasComponent(TestType)).toBe(true);
  });

  it('tracks stats', () => {
    const pool = new EntityPool(() => new Entity());

    const e1 = pool.acquire();
    expect(pool.stats.acquireCount).toBe(1);
    expect(pool.stats.missCount).toBe(1);

    pool.release(e1);
    expect(pool.stats.releaseCount).toBe(1);

    pool.acquire(); // from pool, no miss
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
    pool.release(c); // should be discarded

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
    expect(e2.id).toBe(id1 + 2);
  });
});
