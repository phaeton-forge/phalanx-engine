import { describe, expect, it } from 'vitest';
import { Entity, GameWorld } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import {
  AbilitiesComponentType,
  AbilitySystemFacade,
  ActiveEffectsComponent,
  AttributeAggregationSystem,
  createAbilitySystemRegistries,
  createAbilitySystemRuntime,
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
    // Defaults are marked dirty on init so the aggregation system clamps them
    // on the next tick. Before the first tick, every attribute is dirty=1.
    expect([...attributes.dirty]).toEqual([1, 1]);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Health').base)).toBe(100);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Mana').current)).toBe(50);

    // After one tick with no effects, defaults are clamped and dirty is cleared.
    world.processAllTicks(1);
    expect([...attributes.dirty]).toEqual([0, 0]);

    world.dispose();
  });

  it('clamps defaults on the first tick when default violates min/max', () => {
    const registries = createAbilitySystemRegistries();
    registries.attributes.register(
      defineAttribute({
        id: 'Overcap',
        // Default is intentionally outside [min, max] to verify clamp on init.
        default: FP.FromInt(200),
        min: FP.FromInt(0),
        max: FP.FromInt(100),
        clamp: 'both',
      })
    );
    const runtime = createAbilitySystemRuntime();
    const world = new GameWorld({ componentTypes: [AbilitiesComponentType.Attributes] });
    world.registerSystems([new AttributeAggregationSystem(registries)], []);
    const facade = new AbilitySystemFacade(world.entityManager, registries, runtime);

    const entity = addEntity(world);
    facade.initAttributesForEntity(entity.id);
    // Before the tick: base holds the raw (unclamped) default for accounting.
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Overcap').base)).toBe(200);

    world.processAllTicks(1);

    // After one tick: current is clamped to max.
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Overcap').current)).toBe(100);

    world.dispose();
  });

  it('applies each clamp mode (both, min, max, none)', () => {
    const registries = createAbilitySystemRegistries();
    registries.attributes.register(
      defineAttribute({
        id: 'ClampNone',
        default: FP.FromInt(0),
        min: FP.FromInt(0),
        max: FP.FromInt(100),
        clamp: 'none',
      })
    );
    registries.attributes.register(
      defineAttribute({
        id: 'ClampMin',
        default: FP.FromInt(50),
        min: FP.FromInt(0),
        max: FP.FromInt(100),
        clamp: 'min',
      })
    );
    registries.attributes.register(
      defineAttribute({
        id: 'ClampMax',
        default: FP.FromInt(50),
        min: FP.FromInt(0),
        max: FP.FromInt(100),
        clamp: 'max',
      })
    );
    registries.effects.register(
      defineEffect({
        id: 'Effect.PushNone',
        type: 'Duration',
        modifiers: [{ attributeId: 'ClampNone', op: 'Add', magnitude: FP.FromInt(-500) }],
      })
    );
    registries.effects.register(
      defineEffect({
        id: 'Effect.PushBelowMin',
        type: 'Duration',
        modifiers: [{ attributeId: 'ClampMin', op: 'Add', magnitude: FP.FromInt(-200) }],
      })
    );
    registries.effects.register(
      defineEffect({
        id: 'Effect.PushAboveMax',
        type: 'Duration',
        modifiers: [{ attributeId: 'ClampMax', op: 'Add', magnitude: FP.FromInt(200) }],
      })
    );
    const runtime = createAbilitySystemRuntime();
    const world = new GameWorld({ componentTypes: [AbilitiesComponentType.Attributes] });
    world.registerSystems([new AttributeAggregationSystem(registries)], []);
    const facade = new AbilitySystemFacade(world.entityManager, registries, runtime);

    const entity = addEntity(world);
    const attributes = facade.initAttributesForEntity(entity.id);
    const activeEffects = attachActiveEffects(world, entity);
    activeEffects.queue.push(
      {
        instanceId: 1,
        defId: 'Effect.PushNone',
        remainingTicks: 10,
        nextPeriodTick: 0,
        sourceEntityId: entity.id,
      },
      {
        instanceId: 2,
        defId: 'Effect.PushBelowMin',
        remainingTicks: 10,
        nextPeriodTick: 0,
        sourceEntityId: entity.id,
      },
      {
        instanceId: 3,
        defId: 'Effect.PushAboveMax',
        remainingTicks: 10,
        nextPeriodTick: 0,
        sourceEntityId: entity.id,
      }
    );
    attributes.dirty[0] = 1;
    attributes.dirty[1] = 1;
    attributes.dirty[2] = 1;

    world.processAllTicks(1);

    expect(FP.ToFloat(facade.getAttribute(entity.id, 'ClampNone').current)).toBe(-500);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'ClampMin').current)).toBe(0);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'ClampMax').current)).toBe(100);

    world.dispose();
  });

  it('tryGetAttribute returns undefined for missing entity, component, or attribute id', () => {
    const { world, facade } = createTestWorld();

    // Missing entity.
    expect(facade.tryGetAttribute(9999, 'Health')).toBeUndefined();

    // Entity exists but has no AttributesComponent.
    const bare = addEntity(world);
    expect(facade.tryGetAttribute(bare.id, 'Health')).toBeUndefined();

    // Attribute id is not registered.
    const equipped = addEntity(world);
    facade.initAttributesForEntity(equipped.id);
    expect(facade.tryGetAttribute(equipped.id, 'NotRegistered')).toBeUndefined();

    // Sanity: a real attribute reads back.
    expect(FP.ToFloat(facade.tryGetAttribute(equipped.id, 'Health')!.base)).toBe(100);

    world.dispose();
  });

  it('round-trips FixedPoint through raw BigInt storage with bit equality', () => {
    const { world, facade } = createTestWorld();
    const entity = addEntity(world);
    const attributes = facade.initAttributesForEntity(entity.id);

    const sample = FP.FromFloat(12.5);
    const raw = FP.ToRaw(sample);
    attributes.base[0] = raw;
    attributes.current[0] = raw;

    expect(FP.ToRaw(facade.getAttribute(entity.id, 'Health').base)).toBe(raw);
    expect(FP.ToRaw(facade.getAttribute(entity.id, 'Health').current)).toBe(raw);

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

    registries.effects.register(
      defineEffect({
        id: 'Effect.HealthDamage',
        type: 'Duration',
        modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-10) }],
      })
    );

    // Tick 1: defaults clamp into current (init marks dirty); dirty clears.
    world.processAllTicks(1);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Health').current)).toBe(100);
    expect(attributes.dirty[0]).toBe(0);

    // Attach the effect AFTER defaults have settled, without dirtying.
    const activeEffects = attachActiveEffects(world, entity);
    activeEffects.queue.push({
      instanceId: 1,
      defId: 'Effect.HealthDamage',
      remainingTicks: 10,
      nextPeriodTick: 0,
      sourceEntityId: entity.id,
    });

    // Tick 2: dirty is still 0 so the system must NOT recompute Health.
    world.processAllTicks(2);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Health').current)).toBe(100);

    // Once an external caller (future EffectApplicationSystem) marks it dirty,
    // aggregation picks up the queued effect and applies it.
    attributes.dirty[0] = 1;
    world.processAllTicks(3);

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

  const runtime = createAbilitySystemRuntime();
  const world = new GameWorld({ componentTypes: [AbilitiesComponentType.Attributes] });
  world.registerSystems([new AttributeAggregationSystem(registries)], []);
  const facade = new AbilitySystemFacade(world.entityManager, registries, runtime);

  return { world, facade, registries, runtime };
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
