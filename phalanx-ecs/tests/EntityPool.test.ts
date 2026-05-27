import { describe, it, expect, beforeEach } from 'vitest';
import {
  defineSoASchema,
  Entity,
  EntityManager,
  EntityPool,
  resetEntityIdCounter,
  SoAComponent,
  type IResettableComponent,
} from '../src';

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

const PooledSoASchema = defineSoASchema({
  value: 'i32',
}, 'PooledSoA');

type PooledSoASchemaDef = typeof PooledSoASchema.definition;

const PooledSoAType = Symbol('PooledSoA');

class PooledSoAComponent extends SoAComponent<PooledSoASchemaDef> {
  public readonly type = PooledSoAType;
  static readonly soaSchema = PooledSoASchema;

  constructor(entityId: number) {
    super(PooledSoASchema, entityId, { value: 0 });
  }

  get value(): number { return this.getField('value'); }
  set value(value: number) { this.setField('value', value); }
}

class PooledSoAEntity extends Entity {
  public readonly soaComponent: PooledSoAComponent;

  constructor() {
    super();
    this.soaComponent = new PooledSoAComponent(this.id);
    this.addComponent(this.soaComponent);
  }

  public override reset(): void {
    this._revive();
    this.soaComponent.value = 0;
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

  it('keeps the same ID when reusing an entity', () => {
    const pool = new EntityPool(() => new Entity());

    const e1 = pool.acquire();
    const id1 = e1.id;

    pool.release(e1);
    const e2 = pool.acquire();

    expect(e2).toBe(e1); // same instance
    expect(e2.id).toBe(id1); // stable ID
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

  it('preserves template components across release/acquire', () => {
    const pool = new EntityPool(() => new Entity(), {
      componentTemplates: [
        { type: TestType, factory: () => new TestResettableComponent() },
      ],
    });

    const entity = pool.acquire();
    expect(entity.hasComponent(TestType)).toBe(true);

    const comp = entity.getComponent<TestResettableComponent>(TestType)!;
    comp.reinitialize(42);
    expect(comp.value).toBe(42);

    pool.release(entity);
    const reused = pool.acquire();

    expect(reused).toBe(entity); // same instance
    expect(reused.hasComponent(TestType)).toBe(true);
    const reusedComp = reused.getComponent<TestResettableComponent>(TestType)!;
    expect(reusedComp).toBe(comp); // same component instance
    expect(reusedComp.value).toBe(0); // was reset
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

  it('keeps SoA-backed component rows valid across release/acquire', () => {
    const entityManager = new EntityManager();
    SoAComponent.useEntityManager(entityManager);

    try {
      const pool = new EntityPool(() => new PooledSoAEntity());

      const entity = pool.acquire();
      const id = entity.id;
      entity.soaComponent.value = 42;
      expect(entity.soaComponent.value).toBe(42);

      pool.release(entity);
      const reused = pool.acquire();

      expect(reused).toBe(entity);
      expect(reused.id).toBe(id);
      expect(reused.soaComponent.value).toBe(0);

      reused.soaComponent.value = 99;
      expect(reused.soaComponent.value).toBe(99);
      expect(entityManager.getSoAStore(PooledSoASchema)?.indexOf(id)).not.toBe(-1);
    } finally {
      SoAComponent.resetContext();
    }
  });
});
