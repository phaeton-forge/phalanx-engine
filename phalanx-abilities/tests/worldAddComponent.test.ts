import { describe, expect, it } from 'vitest';
import { Entity, GameWorld } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import {
  AbilityOwner,
  ActiveEffects,
  Attributes,
  GameplayTags,
  attributesOf,
  createAbilitySystem,
  defineAbilitySystem,
  defineAttribute,
} from '../src/index.js';
import { manualTickProvider } from './support/manualTickProvider.js';

const OWNED = [AbilityOwner, Attributes, ActiveEffects, GameplayTags];

function setup(): { world: GameWorld; entity: Entity } {
  const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
  createAbilitySystem(world, {
    definitions: defineAbilitySystem({
      attributes: [
        defineAttribute({ id: 'Health', default: FP.FromInt(100) }),
        defineAttribute({ id: 'Armor', default: FP.FromInt(3) }),
      ],
    }),
  });
  const entity = world.createEntity();
  return { world, entity };
}

describe('world.addComponent with ability components', () => {
  it('attaches all four components for AbilityOwner and indexes them', () => {
    const { world, entity } = setup();
    world.addComponent(entity, AbilityOwner, {
      attributes: { Health: FP.FromInt(80) },
    });
    for (const component of OWNED) {
      expect(entity.hasComponent(component.type)).toBe(true);
      expect(
        world.entityManager.queryEntities(component.type).map((e) => e.id)
      ).toEqual([entity.id]);
    }
    const attributes = attributesOf(entity);
    expect(attributes?.base[0]).toBe(FP.ToRaw(FP.FromInt(80)));
    expect(attributes?.base[1]).toBe(FP.ToRaw(FP.FromInt(3)));
  });

  it.each(OWNED)('rejects AbilityOwner when $name is present', (present) => {
    const { world, entity } = setup();
    world.addComponent(entity, present === AbilityOwner ? Attributes : present);
    const name = present === AbilityOwner ? 'Attributes' : present.name;
    expect(() => world.addComponent(entity, AbilityOwner)).toThrow(
      `world.addComponent: entity ${String(entity.id)} already has '${name}'`
    );
  });

  it('seeds standalone Attributes from the registry with overrides', () => {
    const { world, entity } = setup();
    world.addComponent(entity, Attributes, { Armor: FP.FromInt(7) });
    const attributes = attributesOf(entity);
    expect(attributes?.base[0]).toBe(FP.ToRaw(FP.FromInt(100)));
    expect(attributes?.base[1]).toBe(FP.ToRaw(FP.FromInt(7)));
    expect(Array.from(attributes?.dirty ?? [])).toEqual([1, 1]);
  });

  it('removes all four components with AbilityOwner', () => {
    const { world, entity } = setup();
    world.addComponent(entity, AbilityOwner);
    expect(world.removeComponent(entity, AbilityOwner)).toBe(true);
    for (const component of OWNED) {
      expect(entity.hasComponent(component.type)).toBe(false);
      expect(world.entityManager.queryEntities(component.type)).toEqual([]);
    }
  });

  it.each([Attributes, ActiveEffects, GameplayTags])(
    'refuses to remove $name while AbilityOwner is attached',
    (component) => {
      const { world, entity } = setup();
      world.addComponent(entity, AbilityOwner);
      expect(() => world.removeComponent(entity, component)).toThrow(
        `world.removeComponent: cannot remove '${component.name}' from entity ${String(entity.id)} while 'AbilityOwner' is attached; remove AbilityOwner instead`
      );
      expect(entity.hasComponent(component.type)).toBe(true);
    }
  );

  it('removes a standalone component when no owner is attached', () => {
    const { world, entity } = setup();
    world.addComponent(entity, GameplayTags);
    expect(world.removeComponent(entity, GameplayTags)).toBe(true);
    expect(entity.hasComponent(GameplayTags.type)).toBe(false);
  });

  it('registers the components without their own save sections', () => {
    const { world } = setup();
    expect(world.saveSections.map((section) => section.key)).toEqual([
      'abilities',
    ]);
  });
});
