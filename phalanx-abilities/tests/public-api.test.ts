import { describe, expect, it } from 'vitest';
import { GameWorld } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import { manualTickProvider } from './support/manualTickProvider.js';
import {
  AbilityOwner,
  createAbilitySystem,
  defineAbility,
  defineAbilitySystem,
  defineAttribute,
  defineEffect,
} from '../src';

describe('public ability system API', () => {
  it('attaches an initialized AbilityOwner with world.addComponent', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    const abilities = createAbilitySystem(world, {
      definitions: defineAbilitySystem({
        attributes: [
          defineAttribute({
            id: 'Health',
            default: FP.FromInt(100),
            min: FP.FromInt(0),
            max: FP.FromInt(100),
            clamp: 'both',
          }),
          defineAttribute({
            id: 'MoveSpeedMultiplier',
            default: FP.FromInt(1),
            min: FP.FromInt(0),
            max: FP.FromInt(10),
            clamp: 'both',
          }),
        ],
      }),
    });
    world.registerSystems([...abilities.tickSystems], []);

    const unit = world.createEntity();
    world.addComponent(unit, AbilityOwner, {
      attributes: {
        Health: FP.FromInt(80),
      },
      tags: ['Team.Blue'],
    });
    world.entityManager.addEntity(unit);

    expect(FP.ToFloat(abilities.getAttribute(unit.id, 'Health').base)).toBe(80);
    expect(
      FP.ToFloat(abilities.getAttribute(unit.id, 'MoveSpeedMultiplier').base)
    ).toBe(1);
    expect(abilities.hasTag(unit.id, 'Team.Blue')).toBe(true);

    world.processAllTicks(1);

    expect(FP.ToFloat(abilities.getAttribute(unit.id, 'Health').current)).toBe(
      80
    );

    world.dispose();
  });

  it('activates only abilities granted by the component', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    const abilities = createAbilitySystem(world, {
      definitions: defineAbilitySystem({
        attributes: [
          defineAttribute({
            id: 'Health',
            default: FP.FromInt(100),
            min: FP.FromInt(0),
            max: FP.FromInt(100),
            clamp: 'both',
          }),
        ],
        effects: [
          defineEffect({
            id: 'Effect.SelfDamage',
            type: 'Instant',
            modifiers: [
              { attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-10) },
            ],
          }),
        ],
        abilities: [
          defineAbility({
            id: 'Ability.SelfDamage',
            target: { kind: 'Self' },
            selfEffectIds: ['Effect.SelfDamage'],
          }),
        ],
      }),
    });
    world.registerSystems([...abilities.tickSystems], []);

    const untrained = world.createEntity();
    world.addComponent(untrained, AbilityOwner);
    world.entityManager.addEntity(untrained);

    expect(abilities.activateAbility(untrained.id, 'Ability.SelfDamage')).toBe(
      true
    );
    world.processAllTicks(1);
    expect(
      FP.ToFloat(abilities.getAttribute(untrained.id, 'Health').current)
    ).toBe(100);

    const trained = world.createEntity();
    world.addComponent(trained, AbilityOwner, {
      abilities: ['Ability.SelfDamage'],
    });
    world.entityManager.addEntity(trained);

    expect(abilities.activateAbility(trained.id, 'Ability.SelfDamage')).toBe(
      true
    );
    world.processAllTicks(2);
    expect(
      FP.ToFloat(abilities.getAttribute(trained.id, 'Health').current)
    ).toBe(90);

    world.dispose();
  });

  it('throws near spawn code when the init references unknown ids', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    createAbilitySystem(world, {
      definitions: defineAbilitySystem({
        attributes: [
          defineAttribute({
            id: 'Health',
            default: FP.FromInt(100),
            min: FP.FromInt(0),
            max: FP.FromInt(100),
            clamp: 'both',
          }),
        ],
      }),
    });

    const unit = world.createEntity();
    expect(() =>
      world.addComponent(unit, AbilityOwner, {
        attributes: { NotRegistered: FP.FromInt(1) },
      })
    ).toThrow("AttributeRegistry does not contain 'NotRegistered'");

    world.dispose();
  });
});
