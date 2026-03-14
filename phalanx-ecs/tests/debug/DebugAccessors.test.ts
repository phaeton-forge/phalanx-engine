import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIdCounter } from '../../src/Entity';
import { EntityManager } from '../../src/EntityManager';
import { SoAComponent } from '../../src/SoAComponent';
import { defineSoASchema } from '../../src/SoASchema';
import type { IComponent } from '../../src/Component';

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
  'TestTransform',
);

class TestSoAComponent extends SoAComponent<typeof TestSoASchema.definition> {
  public readonly type = Symbol('TestSoA');
  static readonly soaSchema = TestSoASchema;

  constructor(entityId: number) {
    super(TestSoASchema, entityId, { posX: 0, posY: 0, flags: 0 });
  }
}

// ── Entity accessor tests ──────────────────────────────────────────

describe('Entity debug accessors', () => {
  beforeEach(() => {
    resetEntityIdCounter();
  });

  it('getComponentTypes returns empty array for entity with no components', () => {
    const entity = new Entity();
    expect(entity.getComponentTypes()).toEqual([]);
  });

  it('getComponentTypes returns all attached component type symbols', () => {
    const entity = new Entity();
    entity.addComponent(new HealthComponent());
    entity.addComponent(new ArmorComponent());

    const types = entity.getComponentTypes();
    expect(types).toHaveLength(2);
    expect(types).toContain(HealthType);
    expect(types).toContain(ArmorType);
  });

  it('getComponents returns a read-only map of all components', () => {
    const entity = new Entity();
    const health = new HealthComponent(75);
    entity.addComponent(health);

    const components = entity.getComponents();
    expect(components.size).toBe(1);
    expect(components.get(HealthType)).toBe(health);
  });

  it('getComponents reflects additions and removals', () => {
    const entity = new Entity();
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
    resetEntityIdCounter();
    em = new EntityManager();
    em.registerComponentTypes([HealthType, ArmorType]);
    SoAComponent.useEntityManager(em);
  });

  it('getAllSoAStores returns empty map when no SoA stores exist', () => {
    const stores = em.getAllSoAStores();
    expect(stores.size).toBe(0);
  });

  it('getAllSoAStores returns registered SoA stores', () => {
    const entity = new Entity();
    em.addEntity(entity);

    // Creating a SoAComponent triggers store creation
    new TestSoAComponent(entity.id);

    const stores = em.getAllSoAStores();
    expect(stores.size).toBe(1);

    const store = stores.get(TestSoASchema.type);
    expect(store).toBeDefined();
    expect(store!.count).toBe(1);
  });

  it('getComponentTypeStats returns correct counts', () => {
    const e1 = new Entity();
    e1.addComponent(new HealthComponent());
    e1.addComponent(new ArmorComponent());
    em.addEntity(e1);

    const e2 = new Entity();
    e2.addComponent(new HealthComponent());
    em.addEntity(e2);

    const stats = em.getComponentTypeStats();
    expect(stats.get(HealthType)).toBe(2);
    expect(stats.get(ArmorType)).toBe(1);
  });

  it('getComponentTypeStats returns zero for unused types', () => {
    const stats = em.getComponentTypeStats();
    expect(stats.get(HealthType)).toBe(0);
    expect(stats.get(ArmorType)).toBe(0);
  });

  afterEach(() => {
    SoAComponent.resetContext();
  });
});
