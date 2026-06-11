import { describe, it, expect, beforeEach } from 'vitest';
import {
  Entity,
  EntityManager,
  PoolManager,
  resetEntityIdCounter,
  type IPoolableComponent,
  type IPoolableEntity,
} from '../src';

const HookType = Symbol('Hook');
const OrderType = Symbol('Order');

function resetHookState(): void {
  HookRecordingComponent.spawnCalls = 0;
  HookRecordingComponent.despawnCalls = 0;
  TestPoolableEntity.entitySpawnArgs = [];
  TestPoolableEntity.entityDespawnCalls = 0;
}

class HookRecordingComponent implements IPoolableComponent {
  readonly type = HookType;
  static spawnCalls = 0;
  static despawnCalls = 0;

  onSpawn(): void {
    HookRecordingComponent.spawnCalls++;
  }

  onDespawn(): void {
    HookRecordingComponent.despawnCalls++;
  }
}

class TestPoolableEntity extends Entity implements IPoolableEntity<{ hp: number }> {
  static entitySpawnArgs: number[] = [];
  static entityDespawnCalls = 0;
  public hp = 0;

  constructor() {
    super();
    this.addComponent(new HookRecordingComponent());
  }

  onSpawn(args: { hp: number }): void {
    TestPoolableEntity.entitySpawnArgs.push(args.hp);
    this.hp = args.hp;
  }

  onDespawn(): void {
    TestPoolableEntity.entityDespawnCalls++;
    this.hp = 0;
  }
}

class VoidPoolableEntity extends Entity implements IPoolableEntity {
  onSpawn(): void {}
  onDespawn(): void {}
}

const hookOrder: string[] = [];

class OrderComponent implements IPoolableComponent {
  readonly type = OrderType;

  onSpawn(): void {
    hookOrder.push('component-onSpawn');
  }

  onDespawn(): void {
    hookOrder.push('component-onDespawn');
  }
}

class OrderEntity extends Entity implements IPoolableEntity {
  constructor() {
    super();
    this.addComponent(new OrderComponent());
  }

  onSpawn(): void {
    hookOrder.push('entity-onSpawn');
  }

  onDespawn(): void {
    hookOrder.push('entity-onDespawn');
  }
}

describe('PoolManager', () => {
  let entityManager: EntityManager;
  let manager: PoolManager;

  beforeEach(() => {
    resetEntityIdCounter();
    resetHookState();
    hookOrder.length = 0;
    entityManager = new EntityManager();
    manager = new PoolManager(entityManager);
  });

  it('spawn() returns entity registered in EntityManager with args applied', () => {
    manager.registerEntityType('test', { factory: () => new TestPoolableEntity() });

    const entity = manager.spawn<TestPoolableEntity>('test', { hp: 42 });

    expect(entity).toBeInstanceOf(TestPoolableEntity);
    expect(entity._poolTypeKey).toBe('test');
    expect(entity._inPool).toBe(false);
    expect(entity.hp).toBe(42);
    expect(entityManager.getEntity(entity.id)).toBe(entity);
    expect(TestPoolableEntity.entitySpawnArgs).toEqual([42]);
    expect(HookRecordingComponent.spawnCalls).toBe(1);
  });

  it('runs component onSpawn() before entity onSpawn(args)', () => {
    manager.registerEntityType('order', { factory: () => new OrderEntity() });
    manager.prewarm('order', 1);
    hookOrder.length = 0;

    manager.spawn('order');

    expect(hookOrder).toEqual(['component-onSpawn', 'entity-onSpawn']);
  });

  it('despawn() removes from EntityManager and runs hooks in inverse order', () => {
    manager.registerEntityType('order', { factory: () => new OrderEntity() });
    const entity = manager.spawn('order');
    hookOrder.length = 0;

    manager.despawn(entity);

    expect(entityManager.getEntity(entity.id)).toBeUndefined();
    expect(hookOrder).toEqual(['entity-onDespawn', 'component-onDespawn']);
    expect(entity._inPool).toBe(true);
    expect(manager.getPoolStats('order')!.available).toBe(1);
  });

  it('spawn → despawn → spawn reuses the same instance with the same ID', () => {
    manager.registerEntityType('test', { factory: () => new TestPoolableEntity() });

    const first = manager.spawn<TestPoolableEntity>('test', { hp: 10 });
    const firstId = first.id;
    manager.despawn(first);

    const second = manager.spawn<TestPoolableEntity>('test', { hp: 20 });

    expect(second).toBe(first);
    expect(second.id).toBe(firstId);
    expect(second.hp).toBe(20);
  });

  it('factory creation runs despawn hooks once for prewarmed entities', () => {
    manager.registerEntityType('test', {
      factory: () => new TestPoolableEntity(),
      pool: { initialSize: 3 },
    });

    manager.prewarmAll();

    expect(HookRecordingComponent.despawnCalls).toBe(3);
    expect(TestPoolableEntity.entityDespawnCalls).toBe(3);
    expect(manager.getPoolStats('test')!.available).toBe(3);
  });

  it('double despawn() is a no-op', () => {
    manager.registerEntityType('test', { factory: () => new TestPoolableEntity() });
    const entity = manager.spawn<TestPoolableEntity>('test', { hp: 5 });

    manager.despawn(entity);
    const despawnCallsAfterFirst = TestPoolableEntity.entityDespawnCalls;
    const componentDespawnAfterFirst = HookRecordingComponent.despawnCalls;
    const availableAfterFirst = manager.getPoolStats('test')!.available;

    manager.despawn(entity);

    expect(TestPoolableEntity.entityDespawnCalls).toBe(despawnCallsAfterFirst);
    expect(HookRecordingComponent.despawnCalls).toBe(componentDespawnAfterFirst);
    expect(manager.getPoolStats('test')!.available).toBe(availableAfterFirst);
  });

  it('despawn() on a non-pooled entity throws', () => {
    expect(() => manager.despawn(new Entity())).toThrow(
      'despawn() called on an entity that was not created by PoolManager'
    );
  });

  it('spawn() on unregistered typeKey throws', () => {
    expect(() => manager.spawn('nope')).toThrow("Pool 'nope' is not registered");
  });

  it('throws on duplicate registration', () => {
    manager.registerEntityType('test', { factory: () => new VoidPoolableEntity() });
    expect(() => {
      manager.registerEntityType('test', { factory: () => new VoidPoolableEntity() });
    }).toThrow("Pool 'test' is already registered");
  });

  it('prewarmAll uses initialSize', () => {
    manager.registerEntityType('test', {
      factory: () => new VoidPoolableEntity(),
      pool: { initialSize: 10 },
    });

    manager.prewarmAll();
    expect(manager.getPoolStats('test')!.available).toBe(10);
  });

  it('prewarm specific pool', () => {
    manager.registerEntityType('test', { factory: () => new VoidPoolableEntity() });
    manager.prewarm('test', 5);
    expect(manager.getPoolStats('test')!.available).toBe(5);
  });

  it('prewarm throws for unregistered pool', () => {
    expect(() => manager.prewarm('nope', 10)).toThrow("Pool 'nope' is not registered");
  });

  it('drainAll clears all pools', () => {
    manager.registerEntityType('a', {
      factory: () => new VoidPoolableEntity(),
      pool: { initialSize: 5 },
    });
    manager.registerEntityType('b', {
      factory: () => new VoidPoolableEntity(),
      pool: { initialSize: 3 },
    });
    manager.prewarmAll();
    manager.drainAll();

    expect(manager.getPoolStats('a')!.available).toBe(0);
    expect(manager.getPoolStats('b')!.available).toBe(0);
  });

  it('getStats returns all pool stats', () => {
    manager.registerEntityType('a', { factory: () => new VoidPoolableEntity() });
    manager.registerEntityType('b', { factory: () => new VoidPoolableEntity() });
    manager.spawn('a');
    manager.spawn('b');

    const stats = manager.getStats();
    expect(stats.size).toBe(2);
    expect(stats.get('a')!.acquireCount).toBe(1);
    expect(stats.get('b')!.acquireCount).toBe(1);
  });

  it('getPoolStats returns undefined for unknown pool', () => {
    expect(manager.getPoolStats('nope')).toBeUndefined();
  });

  it('multiple pools operate independently', () => {
    manager.registerEntityType('alpha', {
      factory: () => new VoidPoolableEntity(),
      pool: { initialSize: 3 },
    });
    manager.registerEntityType('beta', {
      factory: () => new VoidPoolableEntity(),
      pool: { initialSize: 5 },
    });

    manager.prewarmAll();

    expect(manager.getPoolStats('alpha')!.available).toBe(3);
    expect(manager.getPoolStats('beta')!.available).toBe(5);

    const a = manager.spawn('alpha');
    const b = manager.spawn('beta');
    expect(a._poolTypeKey).toBe('alpha');
    expect(b._poolTypeKey).toBe('beta');
  });
});
