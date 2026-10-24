import { describe, expect, it } from 'vitest';
import { Entity, GameWorld } from '@phalanx-engine/ecs';
import {
  AbilityOwner,
  ActiveEffects,
  Attributes,
  GameplayTags,
  createAbilitySystem,
  defineAbilitySystem,
} from '../src/index.js';
import { manualTickProvider } from './support/manualTickProvider.js';

describe('world.addComponent with ability components', () => {
  it.each([AbilityOwner, Attributes, ActiveEffects, GameplayTags])(
    'rejects $name: attach it with abilities.initComponent',
    (component) => {
      const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
      createAbilitySystem(world, {
        definitions: defineAbilitySystem({ attributes: [] }),
      });
      const entity = world.createEntity((id) => new Entity(id));
      world.entityManager.addEntity(entity);

      expect(() => world.addComponent(entity, component)).toThrow(
        `world.addComponent: '${component.name}' is owned by abilities; attach it with abilities.initComponent(init)`
      );
    }
  );

  it('registers the components without their own save sections', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    createAbilitySystem(world, {
      definitions: defineAbilitySystem({ attributes: [] }),
    });
    expect(world.saveSections.map((section) => section.key)).toEqual([
      'abilities',
    ]);
  });
});
