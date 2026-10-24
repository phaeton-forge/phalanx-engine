import { describe, it, expect, beforeEach } from 'vitest';
import { Entity } from '../src/Entity';
import { EntityManager } from '../src/EntityManager';
import { defineSoASchema } from '../src/SoASchema';
import type { IComponent } from '../src/Component';

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

const TestSoASchema = defineSoASchema(
  { posX: 'f64', posY: 'f64', flags: 'u8' },
  'TestTransform'
);

function addTestRow(manager: EntityManager, entityId: number): void {
  manager
    .getOrCreateSoAStore(TestSoASchema)
    .add(entityId, { posX: 0, posY: 0, flags: 0 });
}

// ── Entity accessor tests ──────────────────────────────────────────

describe('Entity debug accessors', () => {
  it('getComponentTypes returns empty array for entity with no components', () => {
    const entity = new Entity(1);
    expect(entity.getComponentTypes()).toEqual([]);
  });

  it('getComponentTypes returns all attached component type symbols', () => {
    const entity = new Entity(1);
    entity.addComponent(new HealthComponent());
    entity.addComponent(new ArmorComponent());

    const types = entity.getComponentTypes();
    expect(types).toHaveLength(2);
    expect(types).toContain(HealthType);
    expect(types).toContain(ArmorType);
  });

  it('getComponents returns a read-only map of all components', () => {
    const entity = new Entity(1);
    const health = new HealthComponent(75);
    entity.addComponent(health);

    const components = entity.getComponents();
    expect(components.size).toBe(1);
    expect(components.get(HealthType)).toBe(health);
  });

  it('getComponents reflects additions and removals', () => {
    const entity = new Entity(1);
    entity.addComponent(new HealthComponent());
    expect(entity.getComponents().size).toBe(1);

    entity.addComponent(new ArmorComponent());
    expect(entity.getComponents().size).toBe(2);

    entity.removeComponent(HealthType);
    expect(entity.getComponents().size).toBe(1);
    expect(entity.getComponents().has(ArmorType)).toBe(true);
  });
});

// ── EntityManager accessor tests ───────────────────────────────────

describe('EntityManager debug accessors', () => {
  let em: EntityManager;

  beforeEach(() => {
    em = new EntityManager();
  });

  it('getAllSoAStores returns empty map when no SoA stores exist', () => {
    const stores = em.getAllSoAStores();
    expect(stores.size).toBe(0);
  });

  it('getAllSoAStores returns registered SoA stores', () => {
    const entity = new Entity(1);
    em.addEntity(entity);

    // Adding a row creates the store
    addTestRow(em, entity.id);

    const stores = em.getAllSoAStores();
    expect(stores.size).toBe(1);

    const store = stores.get(TestSoASchema.type);
    expect(store).toBeDefined();
    expect(store!.count).toBe(1);
  });

  it('getComponentTypeStats returns correct counts', () => {
    const e1 = new Entity(1);
    e1.addComponent(new HealthComponent());
    e1.addComponent(new ArmorComponent());
    em.addEntity(e1);

    const e2 = new Entity(2);
    e2.addComponent(new HealthComponent());
    em.addEntity(e2);

    const stats = em.getComponentTypeStats();
    expect(stats.get(HealthType)).toBe(2);
    expect(stats.get(ArmorType)).toBe(1);
  });

  it('getComponentTypeStats has no entry for a type no entity used', () => {
    const stats = em.getComponentTypeStats();
    expect(stats.get(HealthType)).toBeUndefined();
    expect(stats.get(ArmorType)).toBeUndefined();
  });
});
