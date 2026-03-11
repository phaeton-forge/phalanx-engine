import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIdCounter } from '../src/Entity';
import { PoolManager } from '../src/pool/PoolManager';
import type { IResettableComponent } from '../src/pool/IResettableComponent';

const TestType = Symbol('Test');

class TestComponent implements IResettableComponent {
  readonly type = TestType;
  public value: number = 0;

  reset(): void {
    this.value = 0;
  }

  reinitialize(value: number): void {
    this.value = value;
  }
}

describe('PoolManager', () => {
  let manager: PoolManager;

  beforeEach(() => {
    resetEntityIdCounter();
    manager = new PoolManager();
  });

  it('registers and acquires from a named pool', () => {
    manager.registerEntityType('test', {
      factory: () => new Entity(),
    });

    const entity = manager.acquire('test');
    expect(entity).toBeInstanceOf(Entity);
    expect(entity._poolTypeKey).toBe('test');
  });

  it('throws on duplicate registration', () => {
    manager.registerEntityType('test', { factory: () => new Entity() });
    expect(() => {
      manager.registerEntityType('test', { factory: () => new Entity() });
    }).toThrow("Pool 'test' is already registered");
  });

  it('throws on acquire from unregistered pool', () => {
    expect(() => manager.acquire('nope')).toThrow("Pool 'nope' is not registered");
  });

  it('throws on release to unregistered pool', () => {
    expect(() => manager.release('nope', new Entity())).toThrow(
      "Pool 'nope' is not registered"
    );
  });

  it('release and reacquire reuses entity', () => {
    manager.registerEntityType('test', { factory: () => new Entity() });

    const entity = manager.acquire('test');
    const firstId = entity.id;
    manager.release('test', entity);

    const reused = manager.acquire('test');
    expect(reused).toBe(entity);
    expect(reused.id).not.toBe(firstId);
  });

  it('prewarmAll uses initialSize', () => {
    manager.registerEntityType('test', {
      factory: () => new Entity(),
      pool: { initialSize: 10 },
    });

    manager.prewarmAll();
    const stats = manager.getPoolStats('test')!;
    expect(stats.available).toBe(10);
  });

  it('prewarm specific pool', () => {
    manager.registerEntityType('test', { factory: () => new Entity() });
    manager.prewarm('test', 5);
    expect(manager.getPoolStats('test')!.available).toBe(5);
  });

  it('prewarm throws for unregistered pool', () => {
    expect(() => manager.prewarm('nope', 10)).toThrow(
      "Pool 'nope' is not registered"
    );
  });

  it('drainAll clears all pools', () => {
    manager.registerEntityType('a', { factory: () => new Entity(), pool: { initialSize: 5 } });
    manager.registerEntityType('b', { factory: () => new Entity(), pool: { initialSize: 3 } });
    manager.prewarmAll();
    manager.drainAll();

    expect(manager.getPoolStats('a')!.available).toBe(0);
    expect(manager.getPoolStats('b')!.available).toBe(0);
  });

  it('getStats returns all pool stats', () => {
    manager.registerEntityType('a', { factory: () => new Entity() });
    manager.registerEntityType('b', { factory: () => new Entity() });
    manager.acquire('a');
    manager.acquire('b');

    const stats = manager.getStats();
    expect(stats.size).toBe(2);
    expect(stats.get('a')!.acquireCount).toBe(1);
    expect(stats.get('b')!.acquireCount).toBe(1);
  });

  it('getPoolStats returns undefined for unknown pool', () => {
    expect(manager.getPoolStats('nope')).toBeUndefined();
  });

  it('registers with component templates and prewarmed entities have them', () => {
    manager.registerEntityType('test', {
      factory: () => new Entity(),
      pool: { initialSize: 3 },
      components: [
        { type: TestType, factory: () => new TestComponent() },
      ],
    });

    manager.prewarmAll();
    const entity = manager.acquire('test');
    expect(entity.hasComponent(TestType)).toBe(true);

    const comp = entity.getComponent<TestComponent>(TestType)!;
    comp.reinitialize(42);
    expect(comp.value).toBe(42);
  });

  it('multiple pools operate independently', () => {
    manager.registerEntityType('alpha', {
      factory: () => new Entity(),
      pool: { initialSize: 3 },
    });
    manager.registerEntityType('beta', {
      factory: () => new Entity(),
      pool: { initialSize: 5 },
    });

    manager.prewarmAll();

    expect(manager.getPoolStats('alpha')!.available).toBe(3);
    expect(manager.getPoolStats('beta')!.available).toBe(5);

    const a = manager.acquire('alpha');
    const b = manager.acquire('beta');
    expect(a._poolTypeKey).toBe('alpha');
    expect(b._poolTypeKey).toBe('beta');
  });
});
