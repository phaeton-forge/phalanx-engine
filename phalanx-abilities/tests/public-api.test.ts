import { describe, expect, it } from 'vitest';
import { Entity, GameWorld } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import {
  createAbilitySystem,
  defineAbility,
  defineAbilitySystem,
  defineAttribute,
  defineEffect,
} from '../src';

describe('public ability system API', () => {
  it('builds an initialized AbilitySystemComponent for direct entity attachment', () => {
    const world = new GameWorld({});
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

    const unit = new Entity();
    unit.addComponent(
      abilities.initComponent({
        attributes: {
          Health: FP.FromInt(80),
        },
        tags: ['Team.Blue'],
      })
    );
    world.entityManager.addEntity(unit);

    expect(FP.ToFloat(abilities.getAttribute(unit.id, 'Health').base)).toBe(80);
    expect(FP.ToFloat(abilities.getAttribute(unit.id, 'MoveSpeedMultiplier').base)).toBe(1);
    expect(abilities.hasTag(unit.id, 'Team.Blue')).toBe(true);

    world.processAllTicks(1);

    expect(FP.ToFloat(abilities.getAttribute(unit.id, 'Health').current)).toBe(80);

    world.dispose();
  });

  it('activates only abilities granted by the component', () => {
    const world = new GameWorld({});
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
            modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-10) }],
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

    const untrained = new Entity();
    untrained.addComponent(abilities.initComponent());
    world.entityManager.addEntity(untrained);

    expect(abilities.activateAbility(untrained.id, 'Ability.SelfDamage')).toBe(true);
    world.processAllTicks(1);
    expect(FP.ToFloat(abilities.getAttribute(untrained.id, 'Health').current)).toBe(100);

    const trained = new Entity();
    trained.addComponent(
      abilities.initComponent({
        abilities: ['Ability.SelfDamage'],
      })
    );
    world.entityManager.addEntity(trained);

    expect(abilities.activateAbility(trained.id, 'Ability.SelfDamage')).toBe(true);
    world.processAllTicks(2);
    expect(FP.ToFloat(abilities.getAttribute(trained.id, 'Health').current)).toBe(90);

    world.dispose();
  });

  it('throws near spawn code when initComponent references unknown ids', () => {
    const world = new GameWorld({});
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
      }),
    });

    expect(() =>
      abilities.initComponent({
        attributes: { NotRegistered: FP.FromInt(1) },
      })
    ).toThrow("AttributeRegistry does not contain 'NotRegistered'");

    world.dispose();
  });
});
