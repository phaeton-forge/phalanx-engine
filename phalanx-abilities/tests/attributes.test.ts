import { describe, expect, it } from 'vitest';
import { GameWorld } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import {
  AbilitiesComponentType,
  createAbilitySystem,
  defineAbilitySystem,
  defineAttribute,
  defineEffect,
} from '../src';
import type { AbilitySystemComponent } from '../src';
import {
  HealthAttribute,
  ManaAttribute,
  addEntity,
  createTestWorld,
  spawnEntity,
} from './helpers';

describe('attributes and aggregation', () => {
  it('initializes attributes from the registry and reads them through the public API', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'attributes',
      attributes: [HealthAttribute, ManaAttribute],
    });
    const entity = spawnEntity(world, abilities);

    const attributes = entity.getComponent<AbilitySystemComponent>(
      AbilitiesComponentType.AbilitySystem
    )!.attributes;

    expect(attributes.base.length).toBe(2);
    expect(attributes.current.length).toBe(2);
    // Defaults are marked dirty on init so the aggregation system clamps them
    // on the next tick. Before the first tick, every attribute is dirty=1.
    expect([...attributes.dirty]).toEqual([1, 1]);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').base)).toBe(100);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Mana').current)).toBe(50);

    // After one tick with no effects, defaults are clamped and dirty is cleared.
    world.processAllTicks(1);
    expect([...attributes.dirty]).toEqual([0, 0]);

    world.dispose();
  });

  it('clamps defaults on the first tick when default violates min/max', () => {
    const world = new GameWorld({});
    const abilities = createAbilitySystem(world, {
      definitions: defineAbilitySystem({
        attributes: [
          defineAttribute({
            id: 'Overcap',
            default: FP.FromInt(200),
            min: FP.FromInt(0),
            max: FP.FromInt(100),
            clamp: 'both',
          }),
        ],
      }),
      pipeline: 'attributes',
    });
    world.registerSystems([...abilities.tickSystems], []);

    const entity = spawnEntity(world, abilities);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Overcap').base)).toBe(200);

    world.processAllTicks(1);

    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Overcap').current)).toBe(100);

    world.dispose();
  });

  it('applies each clamp mode (both, min, max, none)', () => {
    const world = new GameWorld({});
    const abilities = createAbilitySystem(world, {
      definitions: defineAbilitySystem({
        attributes: [
          defineAttribute({
            id: 'ClampNone',
            default: FP.FromInt(0),
            min: FP.FromInt(0),
            max: FP.FromInt(100),
            clamp: 'none',
          }),
          defineAttribute({
            id: 'ClampMin',
            default: FP.FromInt(50),
            min: FP.FromInt(0),
            max: FP.FromInt(100),
            clamp: 'min',
          }),
          defineAttribute({
            id: 'ClampMax',
            default: FP.FromInt(50),
            min: FP.FromInt(0),
            max: FP.FromInt(100),
            clamp: 'max',
          }),
        ],
        effects: [
          defineEffect({
            id: 'Effect.PushNone',
            type: 'Duration',
            modifiers: [{ attributeId: 'ClampNone', op: 'Add', magnitude: FP.FromInt(-500) }],
          }),
          defineEffect({
            id: 'Effect.PushBelowMin',
            type: 'Duration',
            modifiers: [{ attributeId: 'ClampMin', op: 'Add', magnitude: FP.FromInt(-200) }],
          }),
          defineEffect({
            id: 'Effect.PushAboveMax',
            type: 'Duration',
            modifiers: [{ attributeId: 'ClampMax', op: 'Add', magnitude: FP.FromInt(200) }],
          }),
        ],
      }),
      pipeline: 'attributes',
    });
    world.registerSystems([...abilities.tickSystems], []);

    const entity = spawnEntity(world, abilities);
    const component = entity.getComponent<AbilitySystemComponent>(
      AbilitiesComponentType.AbilitySystem
    )!;
    const attributes = component.attributes;
    const activeEffects = component.activeEffects;
    activeEffects.queue.push(
      {
        instanceId: 1,
        defId: 'Effect.PushNone',
        remainingTicks: 10,
        nextPeriodTick: 0,
        sourceEntityId: entity.id,
        enteredOnTick: 0,
      },
      {
        instanceId: 2,
        defId: 'Effect.PushBelowMin',
        remainingTicks: 10,
        nextPeriodTick: 0,
        sourceEntityId: entity.id,
        enteredOnTick: 0,
      },
      {
        instanceId: 3,
        defId: 'Effect.PushAboveMax',
        remainingTicks: 10,
        nextPeriodTick: 0,
        sourceEntityId: entity.id,
        enteredOnTick: 0,
      }
    );
    attributes.dirty[0] = 1;
    attributes.dirty[1] = 1;
    attributes.dirty[2] = 1;

    world.processAllTicks(1);

    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'ClampNone').current)).toBe(-500);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'ClampMin').current)).toBe(0);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'ClampMax').current)).toBe(100);

    world.dispose();
  });

  it('tryGetAttribute returns undefined for missing entity, component, or attribute id', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'attributes',
      attributes: [HealthAttribute, ManaAttribute],
    });

    expect(abilities.tryGetAttribute(9999, 'Health')).toBeUndefined();

    const bare = addEntity(world);
    expect(abilities.tryGetAttribute(bare.id, 'Health')).toBeUndefined();

    const equipped = spawnEntity(world, abilities);
    expect(abilities.tryGetAttribute(equipped.id, 'NotRegistered')).toBeUndefined();

    expect(FP.ToFloat(abilities.tryGetAttribute(equipped.id, 'Health')!.base)).toBe(100);

    world.dispose();
  });

  it('round-trips FixedPoint through raw BigInt storage with bit equality', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'attributes',
      attributes: [HealthAttribute, ManaAttribute],
    });
    const entity = spawnEntity(world, abilities);
    const attributes = entity.getComponent<AbilitySystemComponent>(
      AbilitiesComponentType.AbilitySystem
    )!.attributes;

    const sample = FP.FromFloat(12.5);
    const raw = FP.ToRaw(sample);
    attributes.base[0] = raw;
    attributes.current[0] = raw;

    expect(FP.ToRaw(abilities.getAttribute(entity.id, 'Health').base)).toBe(raw);
    expect(FP.ToRaw(abilities.getAttribute(entity.id, 'Health').current)).toBe(raw);

    world.dispose();
  });

  it('aggregates Add, Multiply, and Override modifiers in instanceId FIFO order', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'attributes',
      attributes: [HealthAttribute, ManaAttribute],
      effects: [
        defineEffect({
          id: 'Effect.AddHealth',
          type: 'Duration',
          modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(5) }],
        }),
        defineEffect({
          id: 'Effect.DoubleHealth',
          type: 'Duration',
          modifiers: [{ attributeId: 'Health', op: 'Multiply', magnitude: FP.FromInt(2) }],
        }),
        defineEffect({
          id: 'Effect.OverrideHealth',
          type: 'Duration',
          modifiers: [{ attributeId: 'Health', op: 'Override', magnitude: FP.FromInt(20) }],
        }),
      ],
    });
    const entity = spawnEntity(world, abilities);
    const component = entity.getComponent<AbilitySystemComponent>(
      AbilitiesComponentType.AbilitySystem
    )!;
    const attributes = component.attributes;
    const activeEffects = component.activeEffects;

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

    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(20);
    expect(attributes.dirty[0]).toBe(0);

    world.dispose();
  });

  it('clamps aggregated values by each attribute clamp mode', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'attributes',
      attributes: [HealthAttribute, ManaAttribute],
      effects: [
        defineEffect({
          id: 'Effect.BigDelta',
          type: 'Duration',
          modifiers: [
            { attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(150) },
            { attributeId: 'Mana', op: 'Add', magnitude: FP.FromInt(-100) },
          ],
        }),
      ],
    });
    const entity = spawnEntity(world, abilities);
    const component = entity.getComponent<AbilitySystemComponent>(
      AbilitiesComponentType.AbilitySystem
    )!;
    const attributes = component.attributes;
    const activeEffects = component.activeEffects;

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

    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(100);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Mana').current)).toBe(0);

    world.dispose();
  });

  it('leaves clean attributes unchanged until their dirty flag is set', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'attributes',
      attributes: [HealthAttribute, ManaAttribute],
      effects: [
        defineEffect({
          id: 'Effect.HealthDamage',
          type: 'Duration',
          modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-10) }],
        }),
      ],
    });
    const entity = spawnEntity(world, abilities);
    const attributes = entity.getComponent<AbilitySystemComponent>(
      AbilitiesComponentType.AbilitySystem
    )!.attributes;

    world.processAllTicks(1);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(100);
    expect(attributes.dirty[0]).toBe(0);

    const activeEffects = entity.getComponent<AbilitySystemComponent>(
      AbilitiesComponentType.AbilitySystem
    )!.activeEffects;
    activeEffects.queue.push({
      instanceId: 1,
      defId: 'Effect.HealthDamage',
      remainingTicks: 10,
      nextPeriodTick: 0,
      sourceEntityId: entity.id,
    });

    // Tick 2: dirty is still 0 so the system must NOT recompute Health.
    world.processAllTicks(2);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(100);

    attributes.dirty[0] = 1;
    world.processAllTicks(3);

    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(90);
    expect(attributes.dirty[0]).toBe(0);

    world.dispose();
  });

  it('uses the highest instanceId Override as the final override', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'attributes',
      attributes: [HealthAttribute, ManaAttribute],
      effects: [
        defineEffect({
          id: 'Effect.OverrideLow',
          type: 'Duration',
          modifiers: [{ attributeId: 'Mana', op: 'Override', magnitude: FP.FromInt(10) }],
        }),
        defineEffect({
          id: 'Effect.OverrideHigh',
          type: 'Duration',
          modifiers: [{ attributeId: 'Mana', op: 'Override', magnitude: FP.FromInt(40) }],
        }),
      ],
    });
    const entity = spawnEntity(world, abilities);
    const component = entity.getComponent<AbilitySystemComponent>(
      AbilitiesComponentType.AbilitySystem
    )!;
    const attributes = component.attributes;
    const activeEffects = component.activeEffects;

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

    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Mana').current)).toBe(40);

    world.dispose();
  });
});
