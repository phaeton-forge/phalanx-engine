import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  defineSoASchema,
  Entity,
  EntityManager,
  PoolManager,
  resetEntityIdCounter,
  SoAComponent,
  type IPoolableEntity,
} from '../src';

// ── Test schema and component ──────────────────────────────────────────

const TestSchema = defineSoASchema({
  x: 'f64',
  y: 'f64',
  health: 'i32',
  flags: 'u8',
  rawValue: 'i64',
}, 'Test');

type TestSchemaDef = typeof TestSchema.definition;

class TestComponent extends SoAComponent<TestSchemaDef> {
  public readonly type = Symbol('Test');
  // Expose protected members for testing
  public getStoreForTest() { return this.store; }
  public getIndexForTest() { return this.getIndex(); }
  static readonly soaSchema = TestSchema;

  constructor(entityId: number, x: number, y: number) {
    super(TestComponent.soaSchema, entityId, {
      x,
      y,
      health: 100,
      flags: 1,
      rawValue: 0n,
    });
  }

  get x(): number { return this.getField('x'); }
  set x(v: number) { this.setField('x', v); }

  get y(): number { return this.getField('y'); }
  set y(v: number) { this.setField('y', v); }

  get health(): number { return this.getField('health'); }
  set health(v: number) { this.setField('health', v); }

  get flags(): number { return this.getField('flags'); }

  get rawValue(): bigint { return this.getField('rawValue'); }
  set rawValue(v: bigint) { this.setField('rawValue', v); }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('EntityManager.getOrCreateSoAStore', () => {
  let em: EntityManager;

  beforeEach(() => {
    em = new EntityManager();
  });

  it('creates a store on first call', () => {
    const store = em.getOrCreateSoAStore(TestSchema);
    expect(store).toBeDefined();
    expect(store.count).toBe(0);
  });

  it('returns the same store on subsequent calls', () => {
    const store1 = em.getOrCreateSoAStore(TestSchema);
    const store2 = em.getOrCreateSoAStore(TestSchema);
    expect(store1).toBe(store2);
  });

  it('respects custom initial capacity', () => {
    const store = em.getOrCreateSoAStore(TestSchema, 2048);
    expect(store.capacity).toBe(2048);
  });

  it('ignores capacity on subsequent calls', () => {
    const store1 = em.getOrCreateSoAStore(TestSchema, 512);
    const store2 = em.getOrCreateSoAStore(TestSchema, 4096);
    expect(store2).toBe(store1);
    expect(store2.capacity).toBe(512);
  });

  it('can be used alongside registerSoAStore', () => {
    em.registerSoAStore(em.getOrCreateSoAStore(TestSchema));
    expect(em.hasSoAStore(TestSchema)).toBe(true);
  });
});

describe('SoAComponent', () => {
  let em: EntityManager;

  beforeEach(() => {
    em = new EntityManager();
    SoAComponent.useEntityManager(em);
  });

  afterEach(() => {
    SoAComponent.resetContext();
  });

  it('throws when no EntityManager context is set', () => {
    SoAComponent.resetContext();
    expect(() => new TestComponent(1, 10, 20)).toThrow(
      'SoAComponent: No EntityManager context'
    );
  });

  it('constructs and stores initial values', () => {
    const comp = new TestComponent(1, 10, 20);
    expect(comp.x).toBe(10);
    expect(comp.y).toBe(20);
    expect(comp.health).toBe(100);
    expect(comp.flags).toBe(1);
    expect(comp.rawValue).toBe(0n);
  });

  it('setField updates the underlying store', () => {
    const comp = new TestComponent(1, 0, 0);
    comp.x = 42;
    comp.y = 99;
    expect(comp.x).toBe(42);
    expect(comp.y).toBe(99);
  });

  it('supports bigint fields', () => {
    const comp = new TestComponent(1, 0, 0);
    comp.rawValue = 1234567890123456789n;
    expect(comp.rawValue).toBe(1234567890123456789n);
  });

  it('lazily creates the store in EntityManager', () => {
    expect(em.hasSoAStore(TestSchema)).toBe(false);
    new TestComponent(1, 0, 0);
    expect(em.hasSoAStore(TestSchema)).toBe(true);
  });

  it('shares the same store across multiple component instances', () => {
    const comp1 = new TestComponent(1, 1, 2);
    const comp2 = new TestComponent(2, 3, 4);
    const store = em.getSoAStore(TestSchema)!;
    expect(store.count).toBe(2);
    expect(comp1.x).toBe(1);
    expect(comp2.x).toBe(3);
  });

  it('handles index cache invalidation after entity removal', () => {
    const comp1 = new TestComponent(1, 10, 20);
    new TestComponent(2, 30, 40);
    const comp3 = new TestComponent(3, 50, 60);

    // Remove entity 2 — triggers swap-and-pop, entity 3 moves to index 1
    const store = em.getSoAStore(TestSchema)!;
    store.remove(2);

    // comp1 should still read correctly
    expect(comp1.x).toBe(10);
    expect(comp1.y).toBe(20);

    // comp3 should still read correctly after its index moved
    expect(comp3.x).toBe(50);
    expect(comp3.y).toBe(60);
  });

  it('resetContext isolates tests', () => {
    SoAComponent.resetContext();
    const em2 = new EntityManager();
    SoAComponent.useEntityManager(em2);

    const comp = new TestComponent(1, 7, 8);
    expect(comp.x).toBe(7);

    // Store was created in em2, not em
    expect(em.hasSoAStore(TestSchema)).toBe(false);
    expect(em2.hasSoAStore(TestSchema)).toBe(true);
  });
});

// ── TransformComponent-like direct store access test ───────────────────

const TransformLikeSchema = defineSoASchema({
  fpX: 'i64',
  fpY: 'i64',
  fpZ: 'i64',
  visX: 'f64',
  visY: 'f64',
  visZ: 'f64',
}, 'TransformLike');

type TransformLikeDef = typeof TransformLikeSchema.definition;

class TransformLikeComponent extends SoAComponent<TransformLikeDef> {
  public readonly type = Symbol('TransformLike');
  private _cachedFp = { x: 0n, y: 0n, z: 0n };
  private _cachedVis = { x: 0, y: 0, z: 0 };

  constructor(entityId: number, fpX: bigint, fpY: bigint, fpZ: bigint, visX: number, visY: number, visZ: number) {
    super(TransformLikeSchema, entityId, {
      fpX, fpY, fpZ,
      visX, visY, visZ,
    });
  }

  // Mimic TransformComponent's direct array access pattern
  get fpPosition() {
    const idx = this.getIndex();
    if (idx === -1) return this._cachedFp;
    this._cachedFp.x = this.store.arrays.fpX[idx];
    this._cachedFp.y = this.store.arrays.fpY[idx];
    this._cachedFp.z = this.store.arrays.fpZ[idx];
    return this._cachedFp;
  }

  set fpPosition(v: { x: bigint; y: bigint; z: bigint }) {
    const idx = this.getIndex();
    if (idx === -1) return;
    this.store.arrays.fpX[idx] = v.x;
    this.store.arrays.fpY[idx] = v.y;
    this.store.arrays.fpZ[idx] = v.z;
  }

  get visualPosition() {
    const idx = this.getIndex();
    if (idx === -1) return this._cachedVis;
    this._cachedVis.x = this.store.arrays.visX[idx];
    this._cachedVis.y = this.store.arrays.visY[idx];
    this._cachedVis.z = this.store.arrays.visZ[idx];
    return this._cachedVis;
  }
}

describe('TransformComponent-like direct store access', () => {
  let em: EntityManager;

  beforeEach(() => {
    em = new EntityManager();
    SoAComponent.useEntityManager(em);
  });

  afterEach(() => {
    SoAComponent.resetContext();
  });

  it('reads back initial bigint and float values via direct array access', () => {
    const comp = new TransformLikeComponent(1, 100n, 200n, 300n, 1.5, 2.5, 3.5);
    const fp = comp.fpPosition;
    expect(fp.x).toBe(100n);
    expect(fp.y).toBe(200n);
    expect(fp.z).toBe(300n);
    const vis = comp.visualPosition;
    expect(vis.x).toBe(1.5);
    expect(vis.y).toBe(2.5);
    expect(vis.z).toBe(3.5);
  });

  it('can write and read bigint values via setter', () => {
    const comp = new TransformLikeComponent(1, 0n, 0n, 0n, 0, 0, 0);
    comp.fpPosition = { x: 500n, y: 600n, z: 700n };
    const fp = comp.fpPosition;
    expect(fp.x).toBe(500n);
    expect(fp.y).toBe(600n);
    expect(fp.z).toBe(700n);
  });

  it('multiple entities share the same store with correct values', () => {
    const c1 = new TransformLikeComponent(1, 10n, 20n, 30n, 1, 2, 3);
    const c2 = new TransformLikeComponent(2, 40n, 50n, 60n, 4, 5, 6);

    expect(c1.fpPosition.x).toBe(10n);
    expect(c2.fpPosition.x).toBe(40n);
    expect(c1.visualPosition.x).toBe(1);
    expect(c2.visualPosition.x).toBe(4);
  });

  it('reads correct values after swap-and-pop from store removal', () => {
    const c1 = new TransformLikeComponent(1, 10n, 20n, 30n, 1, 2, 3);
    const c2 = new TransformLikeComponent(2, 40n, 50n, 60n, 4, 5, 6);
    const c3 = new TransformLikeComponent(3, 70n, 80n, 90n, 7, 8, 9);

    // Remove middle entity — triggers swap-and-pop
    const store = em.getSoAStore(TransformLikeSchema)!;
    store.remove(2);

    expect(c1.fpPosition.x).toBe(10n);
    expect(c1.visualPosition.x).toBe(1);
    expect(c3.fpPosition.x).toBe(70n);
    expect(c3.visualPosition.x).toBe(7);
  });
});

// ── Capacity shrinking (memory reclamation for RTS-style churn) ─────────

describe('SoAComponentStore capacity reclamation', () => {
  it('grows but never shrinks by default', () => {
    const store = em().getOrCreateSoAStore(TestSchema, 2);
    for (let id = 1; id <= 100; id++) {
      store.add(id, { x: id, y: 0, health: 100, flags: 0, rawValue: 0n });
    }
    const peak = store.capacity;
    expect(peak).toBeGreaterThanOrEqual(100);

    // Kill almost everyone — default behaviour keeps the high-water-mark capacity
    for (let id = 1; id <= 99; id++) store.remove(id);
    expect(store.count).toBe(1);
    expect(store.capacity).toBe(peak);
  });

  it('shrinkToFit releases memory while preserving live data', () => {
    const store = em().getOrCreateSoAStore(TestSchema, 2);
    for (let id = 1; id <= 100; id++) {
      store.add(id, { x: id, y: id * 2, health: id, flags: 0, rawValue: BigInt(id) });
    }
    for (let id = 1; id <= 90; id++) store.remove(id);

    const before = store.capacity;
    const after = store.shrinkToFit();
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThanOrEqual(store.count);

    // Surviving entities keep their values and dense ordering
    for (const id of store.entityIds()) {
      const idx = store.indexOf(id);
      expect(store.arrays.x[idx]).toBe(id);
      expect(store.arrays.rawValue[idx]).toBe(BigInt(id));
    }
  });

  it('autoShrink reclaims memory automatically as population drops', () => {
    const store = em().getOrCreateSoAStore(TestSchema, { initialCapacity: 4, autoShrink: true });
    for (let id = 1; id <= 200; id++) {
      store.add(id, { x: id, y: 0, health: 100, flags: 0, rawValue: 0n });
    }
    const peak = store.capacity;

    for (let id = 1; id <= 195; id++) store.remove(id);

    expect(store.count).toBe(5);
    expect(store.capacity).toBeLessThan(peak);
    expect(store.capacity).toBeGreaterThanOrEqual(4); // never below initial capacity

    // Remaining rows are intact
    for (const id of store.entityIds()) {
      expect(store.arrays.x[store.indexOf(id)]).toBe(id);
    }
  });

  it('autoShrink never drops below initial capacity', () => {
    const store = em().getOrCreateSoAStore(TestSchema, { initialCapacity: 64, autoShrink: true });
    for (let id = 1; id <= 200; id++) {
      store.add(id, { x: id, y: 0, health: 100, flags: 0, rawValue: 0n });
    }
    for (let id = 1; id <= 199; id++) store.remove(id);
    expect(store.capacity).toBe(64);
  });
});

// Local helper to create a fresh EntityManager per assertion block
function em(): EntityManager {
  return new EntityManager();
}

// ── IPoolableComponent lifecycle (onSpawn / onDespawn) ─────────────────

describe('SoAComponent IPoolableComponent lifecycle', () => {
  let em: EntityManager;

  beforeEach(() => {
    em = new EntityManager();
    SoAComponent.useEntityManager(em);
  });

  afterEach(() => {
    SoAComponent.resetContext();
  });

  it('onDespawn() removes the row and is idempotent on second call', () => {
    const comp = new TestComponent(1, 10, 20);
    const store = em.getSoAStore(TestSchema)!;
    expect(store.count).toBe(1);

    comp.onDespawn();
    expect(store.count).toBe(0);
    expect(comp.getIndexForTest()).toBe(-1);

    comp.onDespawn();
    expect(store.count).toBe(0);
  });

  it('onSpawn() after despawn re-adds the row with constructor defaults', () => {
    const comp = new TestComponent(1, 10, 20);
    comp.x = 99;
    comp.onDespawn();

    comp.onSpawn();

    expect(comp.x).toBe(10);
    expect(comp.y).toBe(20);
    expect(comp.health).toBe(100);
    expect(comp.getIndexForTest()).not.toBe(-1);
    expect(em.getSoAStore(TestSchema)!.count).toBe(1);
  });

  it('onSpawn() on an existing row resets values to defaults without changing count', () => {
    const comp = new TestComponent(1, 10, 20);
    const store = em.getSoAStore(TestSchema)!;
    comp.x = 77;
    comp.health = 5;

    comp.onSpawn();

    expect(store.count).toBe(1);
    expect(comp.x).toBe(10);
    expect(comp.health).toBe(100);
  });

  it('spawn-cycle simulation stays consistent after swap-and-pop index churn', () => {
    const comp1 = new TestComponent(1, 10, 20);
    new TestComponent(2, 30, 40);
    const comp3 = new TestComponent(3, 50, 60);

    comp1.onDespawn();
    comp1.onSpawn();
    comp1.x = 111;

    const store = em.getSoAStore(TestSchema)!;
    store.remove(2);

    expect(comp1.x).toBe(111);
    expect(comp3.x).toBe(50);

    comp1.onDespawn();
    comp1.onSpawn();
    expect(comp1.x).toBe(10);
    expect(comp1.y).toBe(20);
  });
});

// ── PoolManager + SoA integration ────────────────────────────────────

const PooledSoASchema = defineSoASchema({ value: 'i32' }, 'PooledSoA');
type PooledSoASchemaDef = typeof PooledSoASchema.definition;
const PooledSoAType = Symbol('PooledSoA');

class PooledSoAComponent extends SoAComponent<PooledSoASchemaDef> {
  public readonly type = PooledSoAType;
  static readonly soaSchema = PooledSoASchema;

  constructor(entityId: number) {
    super(PooledSoASchema, entityId, { value: 0 });
  }

  get value(): number { return this.getField('value'); }
  set value(v: number) { this.setField('value', v); }
}

interface PooledSoASpawnArgs { value: number }

class PooledSoAEntity extends Entity implements IPoolableEntity<PooledSoASpawnArgs> {
  public readonly soa: PooledSoAComponent;

  constructor() {
    super();
    this.soa = this.addComponent(new PooledSoAComponent(this.id));
  }

  onSpawn(args: PooledSoASpawnArgs): void {
    this.soa.value = args.value;
  }

  onDespawn(): void {}
}

describe('SoAComponent PoolManager integration', () => {
  let em: EntityManager;
  let pools: PoolManager;

  beforeEach(() => {
    resetEntityIdCounter();
    em = new EntityManager();
    SoAComponent.useEntityManager(em);
    pools = new PoolManager(em);
    pools.registerEntityType('soa', { factory: () => new PooledSoAEntity() });
  });

  afterEach(() => {
    SoAComponent.resetContext();
  });

  it('spawn adds row with per-spawn values; despawn removes row; respawn restores defaults then applies args', () => {
    const entity = pools.spawn<PooledSoAEntity>('soa', { value: 42 });
    const id = entity.id;
    const store = em.getSoAStore(PooledSoASchema)!;

    expect(store.indexOf(id)).not.toBe(-1);
    expect(entity.soa.value).toBe(42);

    pools.despawn(entity);
    expect(store.indexOf(id)).toBe(-1);

    const reused = pools.spawn<PooledSoAEntity>('soa', { value: 7 });
    expect(reused).toBe(entity);
    expect(store.indexOf(id)).not.toBe(-1);
    expect(reused.soa.value).toBe(7);
  });
});


