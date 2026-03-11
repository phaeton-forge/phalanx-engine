import { describe, it, expect, beforeEach } from 'vitest';
import { EntityManager } from '../src/EntityManager';
import { Entity, resetEntityIdCounter } from '../src/Entity';
import type { IComponent } from '../src/Component';

const CompA = Symbol('CompA');
const CompB = Symbol('CompB');

class ComponentA implements IComponent {
  public readonly type = CompA;
}

class ComponentB implements IComponent {
  public readonly type = CompB;
}

describe('EntityManager query caching', () => {
  let em: EntityManager;

  beforeEach(() => {
    resetEntityIdCounter();
    em = new EntityManager();
    em.registerComponentTypes([CompA, CompB]);
  });

  it('should return same result array on repeated cached queries (no changes)', () => {
    const e1 = new Entity();
    e1.addComponent(new ComponentA());
    em.addEntity(e1);

    const result1 = em.queryEntitiesCached(CompA);
    const result2 = em.queryEntitiesCached(CompA);

    expect(result1).toEqual(result2);
    expect(result1.length).toBe(1);
    expect(result1[0]).toBe(e1);
  });

  it('should invalidate cache when entity is added', () => {
    const e1 = new Entity();
    e1.addComponent(new ComponentA());
    em.addEntity(e1);

    const result1 = em.queryEntitiesCached(CompA);
    expect(result1.length).toBe(1);

    const e2 = new Entity();
    e2.addComponent(new ComponentA());
    em.addEntity(e2);

    const result2 = em.queryEntitiesCached(CompA);
    expect(result2.length).toBe(2);
  });

  it('should invalidate cache when entity is removed', () => {
    const e1 = new Entity();
    e1.addComponent(new ComponentA());
    em.addEntity(e1);

    const e2 = new Entity();
    e2.addComponent(new ComponentA());
    em.addEntity(e2);

    const result1 = em.queryEntitiesCached(CompA);
    expect(result1.length).toBe(2);

    em.removeEntity(e1);

    const result2 = em.queryEntitiesCached(CompA);
    expect(result2.length).toBe(1);
    expect(result2[0]).toBe(e2);
  });

  it('should invalidate cache when component is added', () => {
    const e1 = new Entity();
    em.addEntity(e1);

    const result1 = em.queryEntitiesCached(CompA);
    expect(result1.length).toBe(0);

    e1.addComponent(new ComponentA());
    em.onComponentAdded(e1, CompA);

    const result2 = em.queryEntitiesCached(CompA);
    expect(result2.length).toBe(1);
  });

  it('should invalidate cache when component is removed', () => {
    const e1 = new Entity();
    e1.addComponent(new ComponentA());
    em.addEntity(e1);

    const result1 = em.queryEntitiesCached(CompA);
    expect(result1.length).toBe(1);

    e1.removeComponent(CompA);
    em.onComponentRemoved(e1, CompA);

    const result2 = em.queryEntitiesCached(CompA);
    expect(result2.length).toBe(0);
  });

  it('should manually invalidate cache', () => {
    const e1 = new Entity();
    e1.addComponent(new ComponentA());
    em.addEntity(e1);

    em.queryEntitiesCached(CompA);
    em.invalidateQueryCache();

    // After manual invalidation, next call rebuilds
    const result = em.queryEntitiesCached(CompA);
    expect(result.length).toBe(1);
  });

  it('should handle multi-component cached queries', () => {
    const e1 = new Entity();
    e1.addComponent(new ComponentA());
    e1.addComponent(new ComponentB());
    em.addEntity(e1);

    const e2 = new Entity();
    e2.addComponent(new ComponentA());
    em.addEntity(e2);

    const resultAB = em.queryEntitiesCached(CompA, CompB);
    expect(resultAB.length).toBe(1);
    expect(resultAB[0]).toBe(e1);

    const resultA = em.queryEntitiesCached(CompA);
    expect(resultA.length).toBe(2);
  });
});
