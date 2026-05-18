import { describe, expect, it } from 'vitest';
import { Entity, GameWorld } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import {
  AbilitiesComponentType,
  AbilitySystemFacade,
  AttributeAggregationSystem,
  EffectApplicationSystem,
  EffectTickSystem,
  createAbilitySystemRegistries,
  createAbilitySystemRuntime,
  defineAttribute,
  defineEffect,
} from '../src';
import type { AbilitySystemRegistries, AbilitySystemRuntime } from '../src';

describe('effect application', () => {
  it('applies an Instant effect to base on the same tick (single tick visibility)', () => {
    const { world, facade } = createTestWorld({
      effects: [
        defineEffect({
          id: 'Effect.Damage',
          type: 'Instant',
          modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-10) }],
        }),
      ],
    });
    const entity = addEntity(world);
    facade.initAttributesForEntity(entity.id);
    // Settle defaults so dirty starts clean.
    world.processAllTicks(1);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Health').current)).toBe(100);

    facade.applyEffect(entity.id, 'Effect.Damage', entity.id);

    // Application + aggregation both run on tick 2.
    world.processAllTicks(2);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Health').base)).toBe(90);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Health').current)).toBe(90);

    world.dispose();
  });

  it('queues a Duration effect and reflects it via aggregation; expires on schedule', () => {
    const { world, facade } = createTestWorld({
      effects: [
        defineEffect({
          id: 'Effect.ArmorShred',
          type: 'Duration',
          durationTicks: 3,
          modifiers: [{ attributeId: 'Armor', op: 'Add', magnitude: FP.FromInt(-20) }],
          tagsGranted: ['State.Debuff.ArmorShred'],
        }),
      ],
    });
    const entity = addEntity(world);
    facade.initAttributesForEntity(entity.id);
    world.processAllTicks(1);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Armor').current)).toBe(50);

    facade.applyEffect(entity.id, 'Effect.ArmorShred', entity.id);

    // Tick 2: application applies modifier + dirty, aggregation produces Armor=30,
    // tagsGranted is now present. EffectTickSystem decrements remaining 3 -> 2.
    world.processAllTicks(2);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Armor').current)).toBe(30);
    expect(facade.hasTag(entity.id, 'State.Debuff.ArmorShred')).toBe(true);

    // Tick 3: remaining 2 -> 1.
    world.processAllTicks(3);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Armor').current)).toBe(30);

    // Tick 4: remaining 1 -> 0, expires, tag revoked, Armor recomputes to 50.
    world.processAllTicks(4);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Armor').current)).toBe(50);
    expect(facade.hasTag(entity.id, 'State.Debuff.ArmorShred')).toBe(false);

    world.dispose();
  });

  it('drops effects gated by tagsBlocked and grants tagsGranted on accepted ones', () => {
    const { world, facade } = createTestWorld({
      effects: [
        defineEffect({
          id: 'Effect.Damage',
          type: 'Instant',
          modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-10) }],
          tagsBlocked: ['State.Invulnerable'],
        }),
      ],
    });
    const entity = addEntity(world);
    facade.initAttributesForEntity(entity.id);
    world.processAllTicks(1);

    facade.addTag(entity.id, 'State.Invulnerable');
    facade.applyEffect(entity.id, 'Effect.Damage', entity.id);
    world.processAllTicks(2);
    // Effect was dropped: Health unchanged.
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Health').base)).toBe(100);

    facade.removeTag(entity.id, 'State.Invulnerable');
    facade.applyEffect(entity.id, 'Effect.Damage', entity.id);
    world.processAllTicks(3);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Health').base)).toBe(90);

    world.dispose();
  });

  it('honors tagsRequired (effect drops when missing, applies when present)', () => {
    const { world, facade } = createTestWorld({
      effects: [
        defineEffect({
          id: 'Effect.ExecuteWounded',
          type: 'Instant',
          modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-50) }],
          tagsRequired: ['State.Wounded'],
        }),
      ],
    });
    const entity = addEntity(world);
    facade.initAttributesForEntity(entity.id);
    world.processAllTicks(1);

    // No `State.Wounded` yet: must be dropped.
    facade.applyEffect(entity.id, 'Effect.ExecuteWounded', entity.id);
    world.processAllTicks(2);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Health').base)).toBe(100);

    facade.addTag(entity.id, 'State.Wounded');
    facade.applyEffect(entity.id, 'Effect.ExecuteWounded', entity.id);
    world.processAllTicks(3);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Health').base)).toBe(50);

    world.dispose();
  });

  it('removeEffectsByTag flags matching instances for expiry on the next tick', () => {
    const { world, facade } = createTestWorld({
      effects: [
        defineEffect({
          id: 'Effect.ArmorShred',
          type: 'Duration',
          durationTicks: 100,
          modifiers: [{ attributeId: 'Armor', op: 'Add', magnitude: FP.FromInt(-20) }],
          tagsGranted: ['State.Debuff.ArmorShred'],
        }),
      ],
    });
    const entity = addEntity(world);
    facade.initAttributesForEntity(entity.id);
    world.processAllTicks(1);

    facade.applyEffect(entity.id, 'Effect.ArmorShred', entity.id);
    world.processAllTicks(2);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Armor').current)).toBe(30);
    expect(facade.hasTag(entity.id, 'State.Debuff.ArmorShred')).toBe(true);

    const flagged = facade.removeEffectsByTag(entity.id, 'State.Debuff.ArmorShred');
    expect(flagged).toBe(1);

    // Tick 3 runs EffectTickSystem: the flagged instance reaches 0 and is removed,
    // the tag is revoked, and aggregation recomputes Armor without the modifier.
    world.processAllTicks(3);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Armor').current)).toBe(50);
    expect(facade.hasTag(entity.id, 'State.Debuff.ArmorShred')).toBe(false);

    world.dispose();
  });

  it('removeEffectsByDefId only removes matching defId instances', () => {
    const { world, facade } = createTestWorld({
      effects: [
        defineEffect({
          id: 'Effect.Slow',
          type: 'Duration',
          durationTicks: 100,
          modifiers: [{ attributeId: 'Armor', op: 'Add', magnitude: FP.FromInt(-10) }],
          tagsGranted: ['State.Slowed'],
        }),
        defineEffect({
          id: 'Effect.Poison',
          type: 'Duration',
          durationTicks: 100,
          modifiers: [{ attributeId: 'Armor', op: 'Add', magnitude: FP.FromInt(-5) }],
          tagsGranted: ['State.Poisoned'],
        }),
      ],
    });
    const entity = addEntity(world);
    facade.initAttributesForEntity(entity.id);
    world.processAllTicks(1);

    facade.applyEffect(entity.id, 'Effect.Slow', entity.id);
    facade.applyEffect(entity.id, 'Effect.Poison', entity.id);
    world.processAllTicks(2);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Armor').current)).toBe(35);

    const flagged = facade.removeEffectsByDefId(entity.id, 'Effect.Slow');
    expect(flagged).toBe(1);

    world.processAllTicks(3);
    // Slow gone, Poison still active.
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Armor').current)).toBe(45);
    expect(facade.hasTag(entity.id, 'State.Slowed')).toBe(false);
    expect(facade.hasTag(entity.id, 'State.Poisoned')).toBe(true);

    world.dispose();
  });

  it('does not revoke a tag while another active instance still grants it', () => {
    const { world, facade } = createTestWorld({
      effects: [
        defineEffect({
          id: 'Effect.MarkShort',
          type: 'Duration',
          durationTicks: 2,
          tagsGranted: ['State.Marked'],
          modifiers: [],
        }),
        defineEffect({
          id: 'Effect.MarkLong',
          type: 'Duration',
          durationTicks: 5,
          tagsGranted: ['State.Marked'],
          modifiers: [],
        }),
      ],
    });
    const entity = addEntity(world);
    facade.initAttributesForEntity(entity.id);
    world.processAllTicks(1);

    facade.applyEffect(entity.id, 'Effect.MarkShort', entity.id);
    facade.applyEffect(entity.id, 'Effect.MarkLong', entity.id);
    world.processAllTicks(2);
    expect(facade.hasTag(entity.id, 'State.Marked')).toBe(true);

    // Advance until Effect.MarkShort expires: durationTicks=2 means it survives
    // ticks 2 and 3, expires on tick 4. Effect.MarkLong is still active.
    world.processAllTicks(3);
    world.processAllTicks(4);
    expect(facade.hasTag(entity.id, 'State.Marked')).toBe(true);

    // After MarkLong also expires (tick 7), the tag is revoked.
    world.processAllTicks(5);
    world.processAllTicks(6);
    world.processAllTicks(7);
    expect(facade.hasTag(entity.id, 'State.Marked')).toBe(false);

    world.dispose();
  });

  it('allocates monotonic instance ids in apply order (FIFO is enforced)', () => {
    const { world, facade, runtime } = createTestWorld({
      effects: [
        defineEffect({
          id: 'Effect.OverrideHealth.10',
          type: 'Duration',
          durationTicks: 100,
          modifiers: [{ attributeId: 'Health', op: 'Override', magnitude: FP.FromInt(10) }],
        }),
        defineEffect({
          id: 'Effect.OverrideHealth.50',
          type: 'Duration',
          durationTicks: 100,
          modifiers: [{ attributeId: 'Health', op: 'Override', magnitude: FP.FromInt(50) }],
        }),
      ],
    });
    const entity = addEntity(world);
    facade.initAttributesForEntity(entity.id);
    world.processAllTicks(1);
    const before = runtime.instanceIdCounter.current;

    // Apply in order: 10 first, then 50. Highest-instanceId Override wins.
    facade.applyEffect(entity.id, 'Effect.OverrideHealth.10', entity.id);
    facade.applyEffect(entity.id, 'Effect.OverrideHealth.50', entity.id);
    world.processAllTicks(2);

    expect(runtime.instanceIdCounter.current).toBe(before + 2);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Health').current)).toBe(50);

    world.dispose();
  });

  it('applyEffect throws on unknown effect id or missing entity', () => {
    const { world, facade } = createTestWorld({ effects: [] });
    const entity = addEntity(world);

    expect(() => facade.applyEffect(entity.id, 'Effect.DoesNotExist', entity.id)).toThrow(
      "EffectRegistry does not contain 'Effect.DoesNotExist'"
    );
    expect(() => facade.applyEffect(9999, 'Effect.DoesNotExist', entity.id)).toThrow(
      'Entity 9999 does not exist'
    );

    world.dispose();
  });

  it('reapplying a Duration effect after expiry restores tag and modifier', () => {
    const { world, facade } = createTestWorld({
      effects: [
        defineEffect({
          id: 'Effect.ShortShred',
          type: 'Duration',
          durationTicks: 2,
          modifiers: [{ attributeId: 'Armor', op: 'Add', magnitude: FP.FromInt(-15) }],
          tagsGranted: ['State.Debuff.Shred'],
        }),
      ],
    });
    const entity = addEntity(world);
    facade.initAttributesForEntity(entity.id);
    world.processAllTicks(1);

    facade.applyEffect(entity.id, 'Effect.ShortShred', entity.id);
    world.processAllTicks(2);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Armor').current)).toBe(35);

    // durationTicks=2: survives ticks 2 and 3, expires on tick 4.
    world.processAllTicks(3);
    world.processAllTicks(4);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Armor').current)).toBe(50);
    expect(facade.hasTag(entity.id, 'State.Debuff.Shred')).toBe(false);

    facade.applyEffect(entity.id, 'Effect.ShortShred', entity.id);
    world.processAllTicks(5);
    expect(FP.ToFloat(facade.getAttribute(entity.id, 'Armor').current)).toBe(35);
    expect(facade.hasTag(entity.id, 'State.Debuff.Shred')).toBe(true);

    world.dispose();
  });
});

// ---------------------------------------------------------------------------
// Test world helper
// ---------------------------------------------------------------------------

interface TestWorldOpts {
  effects: readonly ReturnType<typeof defineEffect>[];
}

interface TestWorld {
  world: GameWorld;
  facade: AbilitySystemFacade;
  registries: AbilitySystemRegistries;
  runtime: AbilitySystemRuntime;
}

function createTestWorld(opts: TestWorldOpts): TestWorld {
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
      id: 'Armor',
      default: FP.FromInt(50),
      min: FP.FromInt(0),
      max: FP.FromInt(1000),
      clamp: 'min',
    })
  );
  for (const effect of opts.effects) {
    registries.effects.register(effect);
  }

  const runtime = createAbilitySystemRuntime();
  const world = new GameWorld({
    componentTypes: [
      AbilitiesComponentType.Attributes,
      AbilitiesComponentType.ActiveEffects,
      AbilitiesComponentType.GameplayTags,
    ],
  });
  // System order matches the design doc:
  // EffectApplicationSystem -> EffectTickSystem -> AttributeAggregationSystem.
  // Each tick: drain pendingAdd, then decrement/expire, then resolve current.
  world.registerSystems(
    [
      new EffectApplicationSystem(registries, runtime),
      new EffectTickSystem(registries),
      new AttributeAggregationSystem(registries),
    ],
    []
  );
  const facade = new AbilitySystemFacade(world.entityManager, registries, runtime);
  return { world, facade, registries, runtime };
}

function addEntity(world: GameWorld): Entity {
  const entity = new Entity();
  world.entityManager.addEntity(entity);
  return entity;
}
