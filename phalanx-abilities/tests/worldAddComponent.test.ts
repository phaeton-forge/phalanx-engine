import { describe, expect, it } from 'vitest';
import { Entity, GameWorld } from '@phalanx-engine/ecs';
import {
  AbilityOwner,
  createAbilitySystem,
  defineAbilitySystem,
} from '../src/index.js';
import { manualTickProvider } from './support/manualTickProvider.js';

describe('world.addComponent with ability components', () => {
  it('rejects AbilityOwner: attach it with abilities.initComponent', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    createAbilitySystem(world, {
      definitions: defineAbilitySystem({ attributes: [] }),
    });
    const entity = world.createEntity((id) => new Entity(id));
    world.entityManager.addEntity(entity);

    expect(() => world.addComponent(entity, AbilityOwner)).toThrow(
      'not registered'
    );
  });
});
