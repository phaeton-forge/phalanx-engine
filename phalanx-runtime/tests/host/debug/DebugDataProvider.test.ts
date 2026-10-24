import { manualTickProvider } from '../../support/manualTickProvider.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Entity,
  EntityManager,
  GameWorld,
  PoolManager,
  defineSoASchema,
  type IComponent,
  type IPoolableEntity,
} from '@phalanx-engine/ecs';
import { DebugDataProvider } from '../../../src/host/debug/DebugDataProvider.js';
import type { DebugSnapshot } from '../../../src/host/debug/types.js';

class PoolableEntity extends Entity implements IPoolableEntity {
  onSpawn(): void {}
  onDespawn(): void {}
}

// ── Test fixtures ──────────────────────────────────────────────────

const HealthType = Symbol('Health');
const ArmorType = Symbol('Armor');
const GaugeType = Symbol('Gauge');

class HealthComponent implements IComponent {
  readonly type = HealthType;
  constructor(public hp: number = 100) {}
}

class ArmorComponent implements IComponent {
  readonly type = ArmorType;
  constructor(public armor: number = 10) {}
}

class GaugeComponent implements IComponent {
  readonly type = GaugeType;
  private stored: number;

  constructor(stored: number) {
    this.stored = stored;
    Object.defineProperty(this, 'reading', {
      enumerable: true,
      get: () => this.stored,
    });
  }
}

const PhysicsSoASchema = defineSoASchema(
  { velocityX: 'i64', velocityY: 'i64', radius: 'f64', isStatic: 'u8' },
  'PhysicsBody'
);

function addPhysicsRow(
  manager: EntityManager,
  entityId: number,
  radius: number = 1.0
): void {
  manager.getOrCreateSoAStore(PhysicsSoASchema).add(entityId, {
    velocityX: 0n,
    velocityY: 0n,
    radius,
    isStatic: 0,
  });
}

// ── Helper ─────────────────────────────────────────────────────

function createProvider(
  em: EntityManager,
  pools: PoolManager | null = null,
  interval = 0
): DebugDataProvider {
  return new DebugDataProvider(em, pools, { updateInterval: interval });
}

// ── Tests ──────────────────────────────────────────────────────

describe('DebugDataProvider', () => {
  let em: EntityManager;
  let world: GameWorld;

  beforeEach(() => {
    world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    em = world.entityManager;
  });

  // ── Snapshot content ────────────────────────────────────────────

  describe('getSnapshot()', () => {
    it('returns correct world summary', () => {
      const e1 = new Entity(em.allocateEntityId());
      em.addEntity(e1);
      const e2 = new Entity(em.allocateEntityId());
      em.addEntity(e2);

      const provider = createProvider(em);
      const snap = provider.getSnapshot();

      expect(snap.world.entityCount).toBe(2);
      expect(snap.world.paused).toBe(false);
      expect(snap.timestamp).toBeGreaterThan(0);
    });

    it('reflects paused state', () => {
      const provider = createProvider(em);
      provider.paused = true;
      expect(provider.getSnapshot().world.paused).toBe(true);

      provider.paused = false;
      expect(provider.getSnapshot().world.paused).toBe(false);
    });

    it('collects standard entity components', () => {
      const entity = new Entity(em.allocateEntityId());
      entity.addComponent(new HealthComponent(75));
      entity.addComponent(new ArmorComponent(20));
      em.addEntity(entity);

      const snap = createProvider(em).getSnapshot();

      expect(snap.entities).toHaveLength(1);
      const entitySnap = snap.entities[0];
      if (entitySnap === undefined) {
        throw new Error('expected an entity snapshot');
      }
      expect(entitySnap.id).toBe(entity.id);
      expect(entitySnap.destroyed).toBe(false);
      expect(entitySnap.components).toHaveLength(2);

      const healthSnap = entitySnap.components.find(
        (c) => c.typeName === 'Health'
      );
      expect(healthSnap).toBeDefined();
      expect(healthSnap!.data.hp).toBe(75);
      expect(healthSnap!.data).not.toHaveProperty('type');

      const armorSnap = entitySnap.components.find(
        (c) => c.typeName === 'Armor'
      );
      expect(armorSnap).toBeDefined();
      expect(armorSnap!.data.armor).toBe(20);
    });

    it('copies enumerable getter values', () => {
      const entity = new Entity(em.allocateEntityId());
      entity.addComponent(new GaugeComponent(7));
      em.addEntity(entity);

      const snap = createProvider(em).getSnapshot();
      const entitySnap = snap.entities[0];
      const gauge = entitySnap?.components.find((c) => c.typeName === 'Gauge');
      expect(gauge?.data.reading).toBe(7);
    });

    it('throws when a SoA store has an unexpected shape', () => {
      const stores = new Map<symbol, never>([[Symbol('bad'), {} as never]]);
      vi.spyOn(em, 'getAllSoAStores').mockReturnValue(stores);
      expect(() => createProvider(em).getSnapshot()).toThrow(
        'DebugDataProvider: unexpected SoA store shape'
      );
    });

    it('collects SoA store data with correct field types', () => {
      const entity = new Entity(em.allocateEntityId());
      em.addEntity(entity);
      addPhysicsRow(em, entity.id, 2.5);

      const snap = createProvider(em).getSnapshot();

      expect(snap.soaStores).toHaveLength(1);
      const store = snap.soaStores[0];
      if (store === undefined) {
        throw new Error('expected a store snapshot');
      }
      expect(store.name).toBe('PhysicsBody');
      expect(store.fieldNames).toEqual([
        'velocityX',
        'velocityY',
        'radius',
        'isStatic',
      ]);
      expect(store.fieldTypes.velocityX).toBe('i64');
      expect(store.fieldTypes.radius).toBe('f64');
      expect(store.fieldTypes.isStatic).toBe('u8');
      expect(store.count).toBe(1);
      expect(store.capacity).toBeGreaterThan(0);
      expect(store.bytesPerEntity).toBe(8 + 8 + 8 + 1); // i64 + i64 + f64 + u8 = 25
    });

    it('includes per-entity SoA field values with bigint preserved', () => {
      const entity = new Entity(em.allocateEntityId());
      em.addEntity(entity);
      addPhysicsRow(em, entity.id, 3.14);

      const snap = createProvider(em).getSnapshot();
      const storeSnap = snap.soaStores[0];
      const stored = storeSnap?.entities[0];
      if (storeSnap === undefined || stored === undefined) {
        throw new Error('expected a stored entity');
      }

      expect(storeSnap.entities).toHaveLength(1);
      expect(stored.entityId).toBe(entity.id);
      expect(stored.fields.velocityX).toBe(0n);
      expect(stored.fields.radius).toBeCloseTo(3.14);
      expect(stored.fields.isStatic).toBe(0);
    });

    it('reports soaStoreCount in world summary', () => {
      const entity = new Entity(em.allocateEntityId());
      em.addEntity(entity);
      addPhysicsRow(em, entity.id);

      const snap = createProvider(em).getSnapshot();
      expect(snap.world.soaStoreCount).toBe(1);
    });

    it('collects pool stats when PoolManager is provided', () => {
      const pools = new PoolManager(world);
      pools.registerEntityType('projectile', {
        factory: (id) => new PoolableEntity(id),
        pool: { initialSize: 10 },
      });
      pools.prewarmAll();

      const snap = createProvider(em, pools).getSnapshot();

      expect(snap.pools).toHaveLength(1);
      const pool = snap.pools[0];
      if (pool === undefined) {
        throw new Error('expected a pool snapshot');
      }
      expect(pool.typeKey).toBe('projectile');
      expect(pool.stats.available).toBe(10);
      expect(pool.stats.totalCreated).toBe(10);
    });

    it('returns empty pools array when no PoolManager', () => {
      const snap = createProvider(em, null).getSnapshot();
      expect(snap.pools).toEqual([]);
    });

    it('returns empty entities array for empty world', () => {
      const snap = createProvider(em).getSnapshot();
      expect(snap.entities).toEqual([]);
      expect(snap.soaStores).toEqual([]);
      expect(snap.world.entityCount).toBe(0);
    });
  });

  // ── Observable pattern ──────────────────────────────────────────

  describe('subscribe / push', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('delivers snapshots to subscribers on interval', () => {
      const entity = new Entity(em.allocateEntityId());
      em.addEntity(entity);

      const provider = new DebugDataProvider(em, null, { updateInterval: 100 });
      const snapshots: DebugSnapshot[] = [];
      provider.subscribe((snap) => snapshots.push(snap));
      provider.start();

      vi.advanceTimersByTime(350);

      expect(snapshots.length).toBe(3);
      const first = snapshots[0];
      if (first === undefined) {
        throw new Error('expected a snapshot');
      }
      expect(first.world.entityCount).toBe(1);

      provider.dispose();
    });

    it('does not push when there are no subscribers', () => {
      // This mainly tests that no errors are thrown
      const provider = new DebugDataProvider(em, null, { updateInterval: 100 });
      provider.start();
      vi.advanceTimersByTime(500);
      provider.dispose();
    });

    it('unsubscribe stops delivery to that callback', () => {
      const provider = new DebugDataProvider(em, null, { updateInterval: 100 });
      const snapshots: DebugSnapshot[] = [];
      const unsub = provider.subscribe((snap) => snapshots.push(snap));
      provider.start();

      vi.advanceTimersByTime(150); // 1 push
      expect(snapshots.length).toBe(1);

      unsub();
      vi.advanceTimersByTime(300); // 3 more intervals, but unsubscribed
      expect(snapshots.length).toBe(1);

      provider.dispose();
    });

    it('supports multiple subscribers', () => {
      const provider = new DebugDataProvider(em, null, { updateInterval: 100 });
      const a: DebugSnapshot[] = [];
      const b: DebugSnapshot[] = [];
      provider.subscribe((snap) => a.push(snap));
      provider.subscribe((snap) => b.push(snap));
      provider.start();

      vi.advanceTimersByTime(150);
      expect(a.length).toBe(1);
      expect(b.length).toBe(1);

      provider.dispose();
    });

    it('stop halts pushes but keeps subscribers', () => {
      const provider = new DebugDataProvider(em, null, { updateInterval: 100 });
      const snapshots: DebugSnapshot[] = [];
      provider.subscribe((snap) => snapshots.push(snap));
      provider.start();

      vi.advanceTimersByTime(150);
      expect(snapshots.length).toBe(1);

      provider.stop();
      vi.advanceTimersByTime(500);
      expect(snapshots.length).toBe(1);

      // Re-start still works because subscribers were kept
      provider.start();
      vi.advanceTimersByTime(150);
      expect(snapshots.length).toBe(2);

      provider.dispose();
    });

    it('dispose stops interval and clears subscribers', () => {
      const provider = new DebugDataProvider(em, null, { updateInterval: 100 });
      const snapshots: DebugSnapshot[] = [];
      provider.subscribe((snap) => snapshots.push(snap));
      provider.start();

      vi.advanceTimersByTime(150);
      expect(snapshots.length).toBe(1);

      provider.dispose();
      vi.advanceTimersByTime(500);
      expect(snapshots.length).toBe(1);

      // Re-start after dispose: no subscribers, so no pushes
      provider.start();
      vi.advanceTimersByTime(300);
      expect(snapshots.length).toBe(1);

      provider.dispose();
    });

    it('does not create interval when updateInterval is 0 (pull-only)', () => {
      const provider = new DebugDataProvider(em, null, { updateInterval: 0 });
      const snapshots: DebugSnapshot[] = [];
      provider.subscribe((snap) => snapshots.push(snap));
      provider.start();

      vi.advanceTimersByTime(2000);
      expect(snapshots.length).toBe(0);

      // But getSnapshot still works
      const snap = provider.getSnapshot();
      expect(snap.world.entityCount).toBe(0);

      provider.dispose();
    });

    it('start is idempotent (does not create duplicate intervals)', () => {
      const provider = new DebugDataProvider(em, null, { updateInterval: 100 });
      const snapshots: DebugSnapshot[] = [];
      provider.subscribe((snap) => snapshots.push(snap));

      provider.start();
      provider.start(); // should be no-op
      provider.start(); // should be no-op

      vi.advanceTimersByTime(150);
      expect(snapshots.length).toBe(1); // not 3

      provider.dispose();
    });
  });
});
