import { describe, it, expect } from 'vitest';
import { Entity } from '../src/Entity';
import type { IComponent } from '../src/Component';

const TestType = Symbol('TestComponent');

class TestComponent implements IComponent {
  readonly type = TestType;
  constructor(public value: number = 0) {}
}

describe('Entity pool support', () => {
  it('stores the id the world assigned', () => {
    const entity = new Entity(4);
    expect(entity.id).toBe(4);
  });

  it('rejects an id that is not an integer >= 1', () => {
    expect(() => new Entity(0)).toThrow(/integer >= 1/);
    expect(() => new Entity(-1)).toThrow(/integer >= 1/);
    expect(() => new Entity(1.5)).toThrow(/integer >= 1/);
  });

  it('_setId changes entity ID', () => {
    const entity = new Entity(1);
    expect(entity.id).toBe(1);
    entity._setId(999);
    expect(entity.id).toBe(999);
  });

  it('_revive clears destroyed flag', () => {
    const entity = new Entity(1);
    entity.destroy();
    expect(entity.isDestroyed).toBe(true);
    entity._revive();
    expect(entity.isDestroyed).toBe(false);
  });

  it('_inPool is false by default', () => {
    const entity = new Entity(1);
    expect(entity._inPool).toBe(false);
  });

  it('_poolTypeKey is undefined by default', () => {
    const entity = new Entity(1);
    expect(entity._poolTypeKey).toBeUndefined();
  });

  it('_poolTypeKey can be set', () => {
    const entity = new Entity(1);
    entity._poolTypeKey = 'projectile';
    expect(entity._poolTypeKey).toBe('projectile');
  });

  it('dispose drops components', () => {
    const entity = new Entity(1);
    entity.addComponent(new TestComponent());
    entity.dispose();
    expect(entity.isDestroyed).toBe(true);
    expect(entity.hasComponent(TestType)).toBe(false);
  });
});
