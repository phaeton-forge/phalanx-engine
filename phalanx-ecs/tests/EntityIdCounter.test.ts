import { describe, it, expect, afterEach } from 'vitest';
import { manualTickProvider } from './support/manualTickProvider.js';
import {
  Entity,
  GameWorld,
  SoAComponent,
  getEntityIdCounter,
  nextEntityId,
  resetEntityIdCounter,
  setEntityIdCounter,
} from '../src';

describe('entity id counter', () => {
  afterEach(() => {
    resetEntityIdCounter();
    SoAComponent.resetContext();
  });

  it('getEntityIdCounter reports the high-water mark', () => {
    expect(getEntityIdCounter()).toBe(0);
    expect(nextEntityId()).toBe(1);
    expect(getEntityIdCounter()).toBe(1);
    const entity = new Entity();
    expect(entity.id).toBe(2);
    expect(getEntityIdCounter()).toBe(2);
  });

  it('setEntityIdCounter restores any integer >= 0 and the next id follows it', () => {
    new Entity();
    new Entity();
    setEntityIdCounter(40);
    expect(getEntityIdCounter()).toBe(40);
    expect(new Entity().id).toBe(41);

    setEntityIdCounter(0);
    expect(getEntityIdCounter()).toBe(0);
    expect(nextEntityId()).toBe(1);
  });

  it('setEntityIdCounter rejects values that are not integers >= 0', () => {
    expect(() => setEntityIdCounter(-1)).toThrow(/integer >= 0/);
    expect(() => setEntityIdCounter(1.5)).toThrow(/integer >= 0/);
    expect(() => setEntityIdCounter(Number.NaN)).toThrow(/integer >= 0/);
    expect(() => setEntityIdCounter(Number.POSITIVE_INFINITY)).toThrow(
      /integer >= 0/
    );
    expect(getEntityIdCounter()).toBe(0);
  });

  it('GameWorld delegates get and set, and construction still resets the counter', () => {
    setEntityIdCounter(9);
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    expect(world.getEntityIdCounter()).toBe(0);
    expect(SoAComponent.currentEntityManager()).toBe(world.entityManager);

    world.setEntityIdCounter(7);
    expect(getEntityIdCounter()).toBe(7);
    expect(world.getEntityIdCounter()).toBe(7);
    expect(new Entity().id).toBe(8);

    world.dispose();
  });

  it('SoAComponent.currentEntityManager is null after resetContext', () => {
    expect(SoAComponent.currentEntityManager()).toBeNull();
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    expect(SoAComponent.currentEntityManager()).toBe(world.entityManager);
    SoAComponent.resetContext();
    expect(SoAComponent.currentEntityManager()).toBeNull();
    world.dispose();
  });
});
