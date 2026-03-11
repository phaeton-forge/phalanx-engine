import { describe, it, expect, beforeEach } from 'vitest';
import { PoolManager } from '../src/pool/PoolManager';
import { Entity, resetEntityIdCounter } from '../src/Entity';
import type { IResettableComponent } from '../src/pool/IResettableComponent';

const CompTypeA = Symbol('CompA');

class CompA implements IResettableComponent {
  public readonly type = CompTypeA;
  public value: number = 0;

  reset(): void {
    this.value = 0;
  }

  reinitialize(...args: unknown[]): void {
    this.value = args[0] as number;
  }
}

class ProjectileEntity extends Entity {
  public tag: string = 'projectile';

  reset(): void {
    super.reset();
    this.tag = 'projectile';
  }
}

describe('PoolManager', () => {
  let manager: PoolManager;

  beforeEach(() => {
    resetEntityIdCounter();
    manager = new PoolManager();
  });

  it('should register and acquire entity types', () => {
    manager.registerEntityType('projectile', {
      factory: () => new ProjectileEntity(),
      pool: { initialSize: 5 },
    });

    const entity = manager.acquire<ProjectileEntity>('projectile');
    expect(entity).toBeInstanceOf(ProjectileEntity);
    expect(entity.tag).toBe('projectile');
  });

  it('should throw on duplicate registration', () => {
    manager.registerEntityType('projectile', {
      factory: () => new Entity(),
    });

    expect(() => {
      manager.registerEntityType('projectile', {
        factory: () => new Entity(),
      });
    }).toThrow("Pool already registered for type 'projectile'");
  });

  it('should throw on acquire of unregistered type', () => {
    expect(() => {
      manager.acquire('unknown');
    }).toThrow("No pool registered for type 'unknown'");
  });

  it('should throw on release of unregistered type', () => {
    expect(() => {
      manager.release('unknown', new Entity());
    }).toThrow("No pool registered for type 'unknown'");
  });

  it('should acquire and release entities', () => {
    manager.registerEntityType('projectile', {
      factory: () => new ProjectileEntity(),
      pool: { initialSize: 2 },
    });

    const e1 = manager.acquire<ProjectileEntity>('projectile');
    const e2 = manager.acquire<ProjectileEntity>('projectile');

    manager.release('projectile', e1);
    manager.release('projectile', e2);

    // Re-acquire should reuse instances
    const e3 = manager.acquire<ProjectileEntity>('projectile');
    expect(e3 === e1 || e3 === e2).toBe(true);
  });

  it('should support component templates', () => {
    manager.registerEntityType('projectile', {
      factory: () => new ProjectileEntity(),
      pool: { initialSize: 3 },
      components: [
        { type: CompTypeA, factory: () => new CompA() },
      ],
    });

    const entity = manager.acquire<ProjectileEntity>('projectile');
    expect(entity.hasComponent(CompTypeA)).toBe(true);
    const comp = entity.getComponent<CompA>(CompTypeA)!;
    expect(comp.value).toBe(0);
  });

  it('should prewarm a specific pool', () => {
    manager.registerEntityType('effect', {
      factory: () => new Entity(),
    });

    manager.prewarm('effect', 10);
    const stats = manager.getPoolStats('effect')!;
    expect(stats.available).toBe(10);
  });

  it('should drain all pools', () => {
    manager.registerEntityType('projectile', {
      factory: () => new Entity(),
      pool: { initialSize: 5 },
    });
    manager.registerEntityType('effect', {
      factory: () => new Entity(),
      pool: { initialSize: 3 },
    });

    manager.drainAll();

    const allStats = manager.getStats();
    for (const stats of allStats.values()) {
      expect(stats.available).toBe(0);
    }
  });

  it('should report stats per pool', () => {
    manager.registerEntityType('projectile', {
      factory: () => new Entity(),
      pool: { initialSize: 5 },
    });

    manager.acquire('projectile');
    manager.acquire('projectile');

    const stats = manager.getPoolStats('projectile')!;
    expect(stats.acquireCount).toBe(2);
    expect(stats.available).toBe(3);
  });

  it('should check pool existence with hasPool', () => {
    expect(manager.hasPool('projectile')).toBe(false);

    manager.registerEntityType('projectile', {
      factory: () => new Entity(),
    });

    expect(manager.hasPool('projectile')).toBe(true);
  });

  it('should return undefined stats for unregistered pool', () => {
    expect(manager.getPoolStats('unknown')).toBeUndefined();
  });
});
