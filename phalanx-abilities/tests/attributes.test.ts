import { describe, expect, it } from 'vitest';
import { Entity, GameWorld } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import {
  AbilitiesComponentType,
  AbilitySystemFacade,
  ActiveEffectsComponent,
  AttributeAggregationSystem,
  createAbilitySystemRegistries,
  defineAttribute,
  defineEffect,
} from '../src';

describe('attributes and aggregation', () => {
  it('initializes attributes from the registry and reads them through the facade', () => {
    const { world, facade } = createTestWorld();
    const entity = addEntity(world);

    const attributes = facade.initAttributesForEntity(entity.id);

    expect(attributes.base.length).toBe(2);
    expect(attributes.current.length).toBe(2);
    expect([...attributes.dirty]).toEqual([0, 0]);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Health').base)).toBe(100);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Mana').current)).toBe(50);

    world.dispose();
  });

  it('aggregates Add, Multiply, and Override modifiers in instanceId FIFO order', () => {
    const { world, facade, registries } = createTestWorld();
    const entity = addEntity(world);
    const attributes = facade.initAttributesForEntity(entity.id);
    const activeEffects = attachActiveEffects(world, entity);

    registries.effects.register(
      defineEffect({
        id: 'Effect.AddHealth',
        type: 'Duration',
        modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(5) }],
      })
    );
    registries.effects.register(
      defineEffect({
        id: 'Effect.DoubleHealth',
        type: 'Duration',
        modifiers: [{ attributeId: 'Health', op: 'Multiply', magnitude: FP.FromInt(2) }],
      })
    );
    registries.effects.register(
      defineEffect({
        id: 'Effect.OverrideHealth',
        type: 'Duration',
        modifiers: [{ attributeId: 'Health', op: 'Override', magnitude: FP.FromInt(20) }],
      })
    );

    activeEffects.queue.push(
      {
        instanceId: 3,
        defId: 'Effect.OverrideHealth',
        remainingTicks: 10,
        nextPeriodTick: 0,
        sourceEntityId: 1,
      },
      {
        instanceId: 2,
        defId: 'Effect.DoubleHealth',
        remainingTicks: 10,
        nextPeriodTick: 0,
        sourceEntityId: 1,
      },
      {
        instanceId: 1,
        defId: 'Effect.AddHealth',
        remainingTicks: 10,
        nextPeriodTick: 0,
        sourceEntityId: 1,
      }
    );
    attributes.dirty[0] = 1;

    world.processAllTicks(1);

    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Health').current)).toBe(20);
    expect(attributes.dirty[0]).toBe(0);

    world.dispose();
  });

  it('clamps aggregated values by each attribute clamp mode', () => {
    const { world, facade, registries } = createTestWorld();
    const entity = addEntity(world);
    const attributes = facade.initAttributesForEntity(entity.id);
    const activeEffects = attachActiveEffects(world, entity);

    registries.effects.register(
      defineEffect({
        id: 'Effect.BigDelta',
        type: 'Duration',
        modifiers: [
          { attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(150) },
          { attributeId: 'Mana', op: 'Add', magnitude: FP.FromInt(-100) },
        ],
      })
    );

    activeEffects.queue.push({
      instanceId: 1,
      defId: 'Effect.BigDelta',
      remainingTicks: 10,
      nextPeriodTick: 0,
      sourceEntityId: entity.id,
    });
    attributes.dirty[0] = 1;
    attributes.dirty[1] = 1;

    world.processAllTicks(1);

    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Health').current)).toBe(100);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Mana').current)).toBe(0);

    world.dispose();
  });

  it('leaves clean attributes unchanged until their dirty flag is set', () => {
    const { world, facade, registries } = createTestWorld();
    const entity = addEntity(world);
    const attributes = facade.initAttributesForEntity(entity.id);
    const activeEffects = attachActiveEffects(world, entity);

    registries.effects.register(
      defineEffect({
        id: 'Effect.HealthDamage',
        type: 'Duration',
        modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-10) }],
      })
    );
    activeEffects.queue.push({
      instanceId: 1,
      defId: 'Effect.HealthDamage',
      remainingTicks: 10,
      nextPeriodTick: 0,
      sourceEntityId: entity.id,
    });

    world.processAllTicks(1);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Health').current)).toBe(100);

    attributes.dirty[0] = 1;
    world.processAllTicks(2);

    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Health').current)).toBe(90);
    expect(attributes.dirty[0]).toBe(0);

    world.dispose();
  });

  it('uses the highest instanceId Override as the final override', () => {
    const { world, facade, registries } = createTestWorld();
    const entity = addEntity(world);
    const attributes = facade.initAttributesForEntity(entity.id);
    const activeEffects = attachActiveEffects(world, entity);

    registries.effects.register(
      defineEffect({
        id: 'Effect.OverrideLow',
        type: 'Duration',
        modifiers: [{ attributeId: 'Mana', op: 'Override', magnitude: FP.FromInt(10) }],
      })
    );
    registries.effects.register(
      defineEffect({
        id: 'Effect.OverrideHigh',
        type: 'Duration',
        modifiers: [{ attributeId: 'Mana', op: 'Override', magnitude: FP.FromInt(40) }],
      })
    );

    activeEffects.queue.push(
      {
        instanceId: 2,
        defId: 'Effect.OverrideHigh',
        remainingTicks: 10,
        nextPeriodTick: 0,
        sourceEntityId: entity.id,
      },
      {
        instanceId: 1,
        defId: 'Effect.OverrideLow',
        remainingTicks: 10,
        nextPeriodTick: 0,
        sourceEntityId: entity.id,
      }
    );
    attributes.dirty[1] = 1;

    world.processAllTicks(1);

    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Mana').current)).toBe(40);

    world.dispose();
  });
});

function createTestWorld() {
  const registries = createAbilitySystemRegistries();
  registries.attributes.register(
    defineAttribute({
      id: 'Health',
      default: FP.FromInt(100),
      min: FP.FromInt(0),
      max: FP.FromInt(100),
      clamp: 'both',
    })
  );
  registries.attributes.register(
    defineAttribute({
      id: 'Mana',
      default: FP.FromInt(50),
      min: FP.FromInt(0),
      max: FP.FromInt(50),
      clamp: 'both',
    })
  );

  const world = new GameWorld({ componentTypes: [AbilitiesComponentType.Attributes] });
  world.registerSystems([new AttributeAggregationSystem(registries)], []);
  const facade = new AbilitySystemFacade(world.entityManager, registries);

  return { world, facade, registries };
}

function addEntity(world: GameWorld): Entity {
  const entity = new Entity();
  world.entityManager.addEntity(entity);
  return entity;
}

function attachActiveEffects(world: GameWorld, entity: Entity): ActiveEffectsComponent {
  const activeEffects = entity.addComponent(new ActiveEffectsComponent());
  world.entityManager.onComponentAdded(entity, activeEffects.type);
  return activeEffects;
}
