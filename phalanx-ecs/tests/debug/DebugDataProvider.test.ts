import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Entity, resetEntityIdCounter } from '../../src/Entity';
import { EntityManager } from '../../src/EntityManager';
import { SoAComponent } from '../../src/SoAComponent';
import { defineSoASchema } from '../../src/SoASchema';
import { PoolManager } from '../../src/pool/PoolManager';
import { DebugDataProvider } from '../../src/debug/DebugDataProvider';
import type { IComponent } from '../../src/Component';
import type { IPoolableEntity } from '../../src/pool/IPoolableEntity';
import type { DebugSnapshot } from '../../src/debug/types';

class PoolableEntity extends Entity implements IPoolableEntity {
  onSpawn(): void {}
  onDespawn(): void {}
}

// ── Test fixtures ──────────────────────────────────────────────────

const HealthType = Symbol('Health');
const ArmorType = Symbol('Armor');

class HealthComponent implements IComponent {
  readonly type = HealthType;
  constructor(public hp: number = 100) {}
}

class ArmorComponent implements IComponent {
  readonly type = ArmorType;
  constructor(public armor: number = 10) {}
}

const PhysicsSoASchema = defineSoASchema(
  { velocityX: 'i64', velocityY: 'i64', radius: 'f64', isStatic: 'u8' },
  'PhysicsBody',
);

class PhysicsBodyComponent extends SoAComponent<typeof PhysicsSoASchema.definition> {
  public readonly type = Symbol('PhysicsBody');
  static readonly soaSchema = PhysicsSoASchema;

  constructor(entityId: number, radius: number = 1.0) {
    super(PhysicsSoASchema, entityId, {
      velocityX: 0n,
      velocityY: 0n,
      radius,
      isStatic: 0,
    });
  }
}

// ── Helper ─────────────────────────────────────────────────────

function createProvider(
  em: EntityManager,
  pools: PoolManager | null = null,
  interval = 0,
): DebugDataProvider {
  return new DebugDataProvider(em, pools, { updateInterval: interval });
}

// ── Tests ──────────────────────────────────────────────────────

describe('DebugDataProvider', () => {
  let em: EntityManager;

  beforeEach(() => {
    resetEntityIdCounter();
    em = new EntityManager();
    em.registerComponentTypes([HealthType, ArmorType]);
    SoAComponent.useEntityManager(em);
  });

  afterEach(() => {
    SoAComponent.resetContext();
  });

  // ── Snapshot content ────────────────────────────────────────────

  describe('getSnapshot()', () => {
    it('returns correct world summary', () => {
      const e1 = new Entity();
      em.addEntity(e1);
      const e2 = new Entity();
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
      const entity = new Entity();
      entity.addComponent(new HealthComponent(75));
      entity.addComponent(new ArmorComponent(20));
      em.addEntity(entity);

      const snap = createProvider(em).getSnapshot();

      expect(snap.entities).toHaveLength(1);
      expect(snap.entities[0].id).toBe(entity.id);
      expect(snap.entities[0].destroyed).toBe(false);
      expect(snap.entities[0].components).toHaveLength(2);

      const healthSnap = snap.entities[0].components.find(
        (c) => c.typeName === 'Health',
      );
      expect(healthSnap).toBeDefined();
      expect(healthSnap!.data.hp).toBe(75);

      const armorSnap = snap.entities[0].components.find(
        (c) => c.typeName === 'Armor',
      );
      expect(armorSnap).toBeDefined();
      expect(armorSnap!.data.armor).toBe(20);
    });

    it('collects SoA store data with correct field types', () => {
      const entity = new Entity();
      em.addEntity(entity);
      new PhysicsBodyComponent(entity.id, 2.5);

      const snap = createProvider(em).getSnapshot();

      expect(snap.soaStores).toHaveLength(1);
      const store = snap.soaStores[0];
      expect(store.name).toBe('PhysicsBody');
      expect(store.fieldNames).toEqual(['velocityX', 'velocityY', 'radius', 'isStatic']);
      expect(store.fieldTypes.velocityX).toBe('i64');
      expect(store.fieldTypes.radius).toBe('f64');
      expect(store.fieldTypes.isStatic).toBe('u8');
      expect(store.count).toBe(1);
      expect(store.capacity).toBeGreaterThan(0);
      expect(store.bytesPerEntity).toBe(8 + 8 + 8 + 1); // i64 + i64 + f64 + u8 = 25
    });

    it('includes per-entity SoA field values with bigint preserved', () => {
      const entity = new Entity();
      em.addEntity(entity);
      new PhysicsBodyComponent(entity.id, 3.14);

      const snap = createProvider(em).getSnapshot();
      const storeSnap = snap.soaStores[0];

      expect(storeSnap.entities).toHaveLength(1);
      expect(storeSnap.entities[0].entityId).toBe(entity.id);
      expect(storeSnap.entities[0].fields.velocityX).toBe(0n);
      expect(storeSnap.entities[0].fields.radius).toBeCloseTo(3.14);
      expect(storeSnap.entities[0].fields.isStatic).toBe(0);
    });

    it('reports soaStoreCount in world summary', () => {
      const entity = new Entity();
      em.addEntity(entity);
      new PhysicsBodyComponent(entity.id);

      const snap = createProvider(em).getSnapshot();
      expect(snap.world.soaStoreCount).toBe(1);
    });

    it('collects pool stats when PoolManager is provided', () => {
      const pools = new PoolManager(em);
      pools.registerEntityType('projectile', {
        factory: () => new PoolableEntity(),
        pool: { initialSize: 10 },
      });
      pools.prewarmAll();

      const snap = createProvider(em, pools).getSnapshot();

      expect(snap.pools).toHaveLength(1);
      expect(snap.pools[0].typeKey).toBe('projectile');
      expect(snap.pools[0].stats.available).toBe(10);
      expect(snap.pools[0].stats.totalCreated).toBe(10);
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
      const entity = new Entity();
      em.addEntity(entity);

      const provider = new DebugDataProvider(em, null, { updateInterval: 100 });
      const snapshots: DebugSnapshot[] = [];
      provider.subscribe((snap) => snapshots.push(snap));
      provider.start();

      vi.advanceTimersByTime(350);

      expect(snapshots.length).toBe(3);
      expect(snapshots[0].world.entityCount).toBe(1);

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

  // ── GameWorld integration ───────────────────────────────────────

  describe('GameWorld integration', () => {
    // We test this by importing GameWorld directly
    it('GameWorld creates provider when debug is true', async () => {
      // Dynamic import to avoid circular issues in test setup
      const { GameWorld } = await import('../../src/GameWorld');

      const world = new GameWorld({
        componentTypes: [HealthType],
        debug: true,
        debugConfig: { updateInterval: 0 },
      });

      expect(world.debugProvider).not.toBeNull();
      expect(world.debugProvider).toBeInstanceOf(DebugDataProvider);

      // Snapshot works
      const snap = world.debugProvider!.getSnapshot();
      expect(snap.world.entityCount).toBe(0);

      world.dispose();
    });

    it('GameWorld does not create provider when debug is false', async () => {
      const { GameWorld } = await import('../../src/GameWorld');

      const world = new GameWorld({ componentTypes: [HealthType] });
      expect(world.debugProvider).toBeNull();

      world.dispose();
    });

    it('GameWorld provider reflects entities added to the world', async () => {
      const { GameWorld } = await import('../../src/GameWorld');

      const world = new GameWorld({
        componentTypes: [HealthType],
        debug: true,
        debugConfig: { updateInterval: 0 },
      });

      const entity = new Entity();
      entity.addComponent(new HealthComponent(50));
      world.entityManager.addEntity(entity);

      const snap = world.debugProvider!.getSnapshot();
      expect(snap.world.entityCount).toBe(1);
      expect(snap.entities[0].components[0].data.hp).toBe(50);

      world.dispose();
    });
  });
});
