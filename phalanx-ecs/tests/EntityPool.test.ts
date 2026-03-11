import { describe, it, expect, beforeEach } from 'vitest';
import { EntityPool } from '../src/pool/EntityPool';
import { Entity, resetEntityIdCounter } from '../src/Entity';
import type { IResettableComponent } from '../src/pool/IResettableComponent';

const TestComponentType = Symbol('TestComponent');

class TestComponent implements IResettableComponent {
  public readonly type = TestComponentType;
  public damage: number = 0;

  reset(): void {
    this.damage = 0;
  }

  reinitialize(...args: unknown[]): void {
    this.damage = args[0] as number;
  }
}

describe('EntityPool', () => {
  beforeEach(() => {
    resetEntityIdCounter();
  });

  it('should create entities on acquire when pool is empty', () => {
    const pool = new EntityPool(() => new Entity());
    const entity = pool.acquire();

    expect(entity).toBeInstanceOf(Entity);
    expect(entity.isDestroyed).toBe(false);
  });

  it('should assign fresh IDs on each acquire', () => {
    const pool = new EntityPool(() => new Entity(), { initialSize: 2 });

    const e1 = pool.acquire();
    const e2 = pool.acquire();

    expect(e1.id).not.toBe(e2.id);
    expect(e1.id).toBeGreaterThan(0);
    expect(e2.id).toBeGreaterThan(e1.id);
  });

  it('should reuse entity instances after release', () => {
    const pool = new EntityPool(() => new Entity());

    const e1 = pool.acquire();
    const originalId = e1.id;
    pool.release(e1);

    const e2 = pool.acquire();
    expect(e2).toBe(e1); // same object
    expect(e2.id).not.toBe(originalId); // but new ID
    expect(e2.isDestroyed).toBe(false);
  });

  it('should reset entity components on release', () => {
    const pool = new EntityPool(() => new Entity());

    const entity = pool.acquire();
    entity.addComponent(new TestComponent());
    expect(entity.hasComponent(TestComponentType)).toBe(true);

    pool.release(entity);
    // After release, components are cleared (except templates)
    // Since no templates were set, all components should be gone

    const reused = pool.acquire();
    expect(reused).toBe(entity);
    expect(reused.hasComponent(TestComponentType)).toBe(false);
  });

  it('should preserve template components across release/acquire', () => {
    const pool = new EntityPool(() => new Entity(), {
      componentTemplates: [
        { type: TestComponentType, factory: () => new TestComponent() },
      ],
    });

    const entity = pool.acquire();
    expect(entity.hasComponent(TestComponentType)).toBe(true);

    const comp = entity.getComponent<TestComponent>(TestComponentType)!;
    comp.reinitialize(50);
    expect(comp.damage).toBe(50);

    pool.release(entity);

    const reused = pool.acquire();
    expect(reused).toBe(entity);
    expect(reused.hasComponent(TestComponentType)).toBe(true);

    const reusedComp = reused.getComponent<TestComponent>(TestComponentType)!;
    expect(reusedComp).toBe(comp); // same component instance
    expect(reusedComp.damage).toBe(0); // reset
  });

  it('should prewarm with entities and template components', () => {
    const pool = new EntityPool(() => new Entity(), {
      initialSize: 5,
      componentTemplates: [
        { type: TestComponentType, factory: () => new TestComponent() },
      ],
    });

    expect(pool.availableCount).toBe(5);
  });

  it('should respect maxSize on release', () => {
    const pool = new EntityPool(() => new Entity(), { maxSize: 2 });

    const e1 = pool.acquire();
    const e2 = pool.acquire();
    const e3 = pool.acquire();

    pool.release(e1);
    pool.release(e2);
    pool.release(e3); // should be discarded

    expect(pool.availableCount).toBe(2);
  });

  it('should support batch growth', () => {
    const pool = new EntityPool(() => new Entity(), {
      growthStrategy: 'grow',
      growthBatchSize: 4,
    });

    const entity = pool.acquire(); // triggers batch of 4, pops 1
    expect(entity).toBeInstanceOf(Entity);
    expect(pool.availableCount).toBe(3);
  });

  it('should track stats correctly', () => {
    const pool = new EntityPool(() => new Entity());

    pool.acquire(); // miss
    pool.acquire(); // miss

    const stats = pool.stats;
    expect(stats.acquireCount).toBe(2);
    expect(stats.missCount).toBe(2);
    expect(stats.totalCreated).toBe(2);
  });

  it('should drain all entities', () => {
    const pool = new EntityPool(() => new Entity(), { initialSize: 5 });
    expect(pool.availableCount).toBe(5);

    pool.drain();
    expect(pool.availableCount).toBe(0);
  });

  it('should maintain deterministic ID ordering', () => {
    resetEntityIdCounter();
    const pool = new EntityPool(() => new Entity(), { initialSize: 3 });

    // Acquire all 3 prewarmed entities — they get fresh sequential IDs
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(pool.acquire().id);
    }

    // IDs should be strictly increasing
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1]);
    }
  });
});
