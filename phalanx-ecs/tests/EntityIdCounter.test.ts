import { describe, it, expect, afterEach } from 'vitest';
import { manualTickProvider } from './support/manualTickProvider.js';
import { Entity, EntityManager, GameWorld } from '../src';

describe('entity id counter', () => {
  it('allocateEntityId advances the high-water mark', () => {
    const manager = new EntityManager();
    expect(manager.entityIdHighWater()).toBe(0);
    expect(manager.allocateEntityId()).toBe(1);
    expect(manager.entityIdHighWater()).toBe(1);
    expect(manager.allocateEntityId()).toBe(2);
    expect(manager.entityIdHighWater()).toBe(2);
  });

  it('restoreEntityIdHighWater sets the next id and rejects bad values', () => {
    const manager = new EntityManager();
    manager.allocateEntityId();
    manager.allocateEntityId();
    manager.restoreEntityIdHighWater(40);
    expect(manager.entityIdHighWater()).toBe(40);
    expect(manager.allocateEntityId()).toBe(41);

    manager.restoreEntityIdHighWater(0);
    expect(manager.entityIdHighWater()).toBe(0);
    expect(manager.allocateEntityId()).toBe(1);

    expect(() => manager.restoreEntityIdHighWater(-1)).toThrow(/integer >= 0/);
    expect(() => manager.restoreEntityIdHighWater(1.5)).toThrow(/integer >= 0/);
    expect(() => manager.restoreEntityIdHighWater(Number.NaN)).toThrow(
      /integer >= 0/
    );
    expect(() =>
      manager.restoreEntityIdHighWater(Number.POSITIVE_INFINITY)
    ).toThrow(/integer >= 0/);
    expect(manager.entityIdHighWater()).toBe(1);
  });

  it('claimEntityId does not rewind a hole', () => {
    const manager = new EntityManager();
    manager.claimEntityId(5);
    manager.claimEntityId(2);
    expect(manager.entityIdHighWater()).toBe(5);
    expect(manager.allocateEntityId()).toBe(6);
    expect(() => manager.claimEntityId(0)).toThrow(/integer >= 1/);
    expect(manager.entityIdHighWater()).toBe(6);
  });

  it('each world keeps its own counter and construction does not reset another', () => {
    const worldA = new GameWorld({ tickFrameProvider: manualTickProvider() });
    const first = worldA.createEntity();
    expect(first.id).toBe(1);

    const worldB = new GameWorld({ tickFrameProvider: manualTickProvider() });
    expect(worldB.entityManager.entityIdHighWater()).toBe(0);
    expect(worldB.createEntity().id).toBe(1);
    expect(worldA.entityManager.entityIdHighWater()).toBe(1);
    expect(worldA.createEntity().id).toBe(2);

    worldB.dispose();
    expect(worldA.createEntity().id).toBe(3);
    worldA.dispose();
  });

  it('createEntityWithId keeps the same ids and the same next id', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    const high = world.createEntityWithId(5);
    const hole = world.createEntityWithId(2, (id) => new Entity(id));
    expect(high.id).toBe(5);
    expect(hole.id).toBe(2);
    expect(world.entityManager.getEntity(5)).toBe(high);
    expect(world.entityManager.entityIdHighWater()).toBe(5);
    expect(world.createEntity().id).toBe(6);
    world.dispose();
  });
});
