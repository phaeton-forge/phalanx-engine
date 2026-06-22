import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIdCounter, nextEntityId } from '../src/Entity';
import type { IComponent } from '../src/Component';

const TestType = Symbol('TestComponent');

class TestComponent implements IComponent {
  readonly type = TestType;
  constructor(public value: number = 0) {}
}

describe('Entity pool support', () => {
  beforeEach(() => {
    resetEntityIdCounter();
  });

  it('nextEntityId returns sequential IDs', () => {
    const id1 = nextEntityId();
    const id2 = nextEntityId();
    expect(id1).toBe(1);
    expect(id2).toBe(2);
  });

  it('nextEntityId shares counter with Entity constructor', () => {
    const entity = new Entity();
    expect(entity.id).toBe(1);
    expect(nextEntityId()).toBe(2);
  });

  it('_setId changes entity ID', () => {
    const entity = new Entity();
    expect(entity.id).toBe(1);
    entity._setId(999);
    expect(entity.id).toBe(999);
  });

  it('_revive clears destroyed flag', () => {
    const entity = new Entity();
    entity.destroy();
    expect(entity.isDestroyed).toBe(true);
    entity._revive();
    expect(entity.isDestroyed).toBe(false);
  });

  it('_inPool is false by default', () => {
    const entity = new Entity();
    expect(entity._inPool).toBe(false);
  });

  it('_poolTypeKey is undefined by default', () => {
    const entity = new Entity();
    expect(entity._poolTypeKey).toBeUndefined();
  });

  it('_poolTypeKey can be set', () => {
    const entity = new Entity();
    entity._poolTypeKey = 'projectile';
    expect(entity._poolTypeKey).toBe('projectile');
  });

  it('backward compat: dispose still works', () => {
    const entity = new Entity();
    entity.addComponent(new TestComponent());
    entity.dispose();
    expect(entity.isDestroyed).toBe(true);
    expect(entity.hasComponent(TestType)).toBe(false);
  });

  it('resetEntityIdCounter resets the counter', () => {
    new Entity(); // id 1
    new Entity(); // id 2
    resetEntityIdCounter();
    const entity = new Entity();
    expect(entity.id).toBe(1);
  });
});
