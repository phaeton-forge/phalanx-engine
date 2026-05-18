import { describe, expect, it } from 'vitest';
import { Entity, GameWorld, resetEntityIdCounter } from 'phalanx-ecs';
import type { GameSystem } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import {
  AbilitiesComponentType,
  AbilitySystemFacade,
  AttributeAggregationSystem,
  CueBufferCleanupSystem,
  CueDispatchSystem,
  EffectApplicationSystem,
  EffectTickSystem,
  GAMEPLAY_CUE_EVENT,
  createAbilitySystemRegistries,
  createAbilitySystemRuntime,
  defineAttribute,
  defineEffect,
  gameplayCueKey,
} from '../src';
import type { AbilitySystemRegistries, AbilitySystemRuntime, CueEvent } from '../src';

describe('gameplay cues', () => {
  it('pushes OnApplied for an Instant effect using the string[] shortcut', () => {
    const { world, facade, runtime } = createTestWorld({
      effects: [
        defineEffect({
          id: 'Effect.AutoAttack.Damage',
          type: 'Instant',
          modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-10) }],
          cues: ['Cue.AutoAttack.Hit'],
        }),
      ],
    });
    const source = addEntity(world);
    const target = addEntity(world);
    facade.initAttributesForEntity(target.id);
    world.processAllTicks(1);

    facade.applyEffect(target.id, 'Effect.AutoAttack.Damage', source.id);
    world.processAllTicks(2);

    expect(runtime.gameplayCueBuffer.events).toEqual([
      {
        tick: 2,
        cueId: 'Cue.AutoAttack.Hit',
        sourceEntityId: source.id,
        targetEntityId: target.id,
        phase: 'OnApplied',
      },
    ]);
    world.dispose();
  });

  it('dispatches OnApplied and OnExpired for a Duration effect with cleanup between ticks', () => {
    const { world, facade, cueLog } = createTestWorld({
      dispatchCues: true,
      cleanupCues: true,
      effects: [
        defineEffect({
          id: 'Effect.ArmorShred',
          type: 'Duration',
          durationTicks: 2,
          modifiers: [{ attributeId: 'Armor', op: 'Add', magnitude: FP.FromInt(-20) }],
          cues: {
            onApplied: ['Cue.ArmorShred.Apply'],
            onExpired: ['Cue.ArmorShred.Expire'],
          },
        }),
      ],
    });
    const source = addEntity(world);
    const target = addEntity(world);
    facade.initAttributesForEntity(target.id);
    world.processAllTicks(1);

    facade.applyEffect(target.id, 'Effect.ArmorShred', source.id);
    world.processAllTicks(2);
    expect(cueLog).toEqual([
      {
        tick: 2,
        cueId: 'Cue.ArmorShred.Apply',
        sourceEntityId: source.id,
        targetEntityId: target.id,
        phase: 'OnApplied',
      },
    ]);
    expect(facade.gameplayCueBufferInternal.events).toEqual([]);

    world.processAllTicks(3);
    expect(cueLog).toHaveLength(1);
    expect(facade.gameplayCueBufferInternal.events).toEqual([]);

    world.processAllTicks(4);
    expect(cueLog).toEqual([
      {
        tick: 2,
        cueId: 'Cue.ArmorShred.Apply',
        sourceEntityId: source.id,
        targetEntityId: target.id,
        phase: 'OnApplied',
      },
      {
        tick: 4,
        cueId: 'Cue.ArmorShred.Expire',
        sourceEntityId: source.id,
        targetEntityId: target.id,
        phase: 'OnExpired',
      },
    ]);
    expect(facade.gameplayCueBufferInternal.events).toEqual([]);
    world.dispose();
  });

  it('pushes OnPeriodic exactly on scheduled periodic landings', () => {
    const { world, facade, cueLog } = createTestWorld({
      dispatchCues: true,
      cleanupCues: true,
      effects: [
        defineEffect({
          id: 'Effect.Poison',
          type: 'Periodic',
          durationTicks: 6,
          periodTicks: 2,
          modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-3) }],
          cues: { onPeriodic: ['Cue.Poison.Tick'] },
        }),
      ],
    });
    const source = addEntity(world);
    const target = addEntity(world);
    facade.initAttributesForEntity(target.id);
    world.processAllTicks(1);

    facade.applyEffect(target.id, 'Effect.Poison', source.id);
    for (let tick = 2; tick <= 8; tick++) {
      world.processAllTicks(tick);
    }

    expect(cueLog).toEqual([
      periodicEvent(4, source.id, target.id),
      periodicEvent(6, source.id, target.id),
      periodicEvent(8, source.id, target.id),
    ]);
    world.dispose();
  });

  it('pushes immediate OnPeriodic only from structured cues', () => {
    const { world, facade, cueLog } = createTestWorld({
      dispatchCues: true,
      cleanupCues: true,
      effects: [
        defineEffect({
          id: 'Effect.BurningWeapon',
          type: 'Periodic',
          durationTicks: 3,
          periodTicks: 2,
          executePeriodicOnApplication: true,
          modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-2) }],
          cues: {
            onApplied: ['Cue.Burning.Apply'],
            onPeriodic: ['Cue.Burning.Tick'],
          },
        }),
        defineEffect({
          id: 'Effect.ShortcutPeriodic',
          type: 'Periodic',
          durationTicks: 3,
          periodTicks: 2,
          executePeriodicOnApplication: true,
          modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-1) }],
          cues: ['Cue.Shortcut.ApplyOnly'],
        }),
      ],
    });
    const source = addEntity(world);
    const target = addEntity(world);
    facade.initAttributesForEntity(target.id);
    world.processAllTicks(1);

    facade.applyEffect(target.id, 'Effect.BurningWeapon', source.id);
    facade.applyEffect(target.id, 'Effect.ShortcutPeriodic', source.id);
    world.processAllTicks(2);

    expect(cueLog).toEqual([
      {
        tick: 2,
        cueId: 'Cue.Burning.Apply',
        sourceEntityId: source.id,
        targetEntityId: target.id,
        phase: 'OnApplied',
      },
      {
        tick: 2,
        cueId: 'Cue.Burning.Tick',
        sourceEntityId: source.id,
        targetEntityId: target.id,
        phase: 'OnPeriodic',
      },
      {
        tick: 2,
        cueId: 'Cue.Shortcut.ApplyOnly',
        sourceEntityId: source.id,
        targetEntityId: target.id,
        phase: 'OnApplied',
      },
    ]);
    world.dispose();
  });

  it('preserves deterministic entity and pending-add cue order', () => {
    const runScenario = (): CueEvent[] => {
      const { world, facade, cueLog } = createTestWorld({
        dispatchCues: true,
        cleanupCues: true,
        effects: [
          defineEffect({ id: 'Effect.First', type: 'Instant', cues: ['Cue.First'] }),
          defineEffect({ id: 'Effect.Second', type: 'Instant', cues: ['Cue.Second'] }),
        ],
      });
      const source = addEntity(world);
      const firstTarget = addEntity(world);
      const secondTarget = addEntity(world);
      facade.applyEffect(firstTarget.id, 'Effect.First', source.id);
      facade.applyEffect(firstTarget.id, 'Effect.Second', source.id);
      facade.applyEffect(secondTarget.id, 'Effect.First', source.id);
      facade.applyEffect(secondTarget.id, 'Effect.Second', source.id);
      world.processAllTicks(1);
      world.dispose();
      return cueLog;
    };

    const firstRun = runScenario();
    const secondRun = runScenario();

    expect(firstRun.map((event) => event.cueId)).toEqual([
      'Cue.First',
      'Cue.Second',
      'Cue.First',
      'Cue.Second',
    ]);
    expect(firstRun.map((event) => event.targetEntityId)).toEqual([
      firstRun[0].targetEntityId,
      firstRun[0].targetEntityId,
      firstRun[2].targetEntityId,
      firstRun[2].targetEntityId,
    ]);
    expect(firstRun).toEqual(secondRun);
  });

  it('dispatches each cue on global and per-cue EventBus keys', () => {
    const { world, facade } = createTestWorld({
      dispatchCues: true,
      cleanupCues: true,
      effects: [defineEffect({ id: 'Effect.Signal', type: 'Instant', cues: ['Cue.X'] })],
    });
    const globalEvents: CueEvent[] = [];
    const perCueEvents: CueEvent[] = [];
    world.eventBus.on<CueEvent>(GAMEPLAY_CUE_EVENT, (event) => globalEvents.push(event));
    world.eventBus.on<CueEvent>(gameplayCueKey('Cue.X'), (event) => perCueEvents.push(event));
    const source = addEntity(world);
    const target = addEntity(world);

    facade.applyEffect(target.id, 'Effect.Signal', source.id);
    world.processAllTicks(1);

    expect(globalEvents).toHaveLength(1);
    expect(perCueEvents).toHaveLength(1);
    expect(globalEvents[0]).toBe(perCueEvents[0]);
    expect(globalEvents[0]).toEqual({
      tick: 1,
      cueId: 'Cue.X',
      sourceEntityId: source.id,
      targetEntityId: target.id,
      phase: 'OnApplied',
    });
    expect(facade.gameplayCueBufferInternal.events).toEqual([]);
    world.dispose();
  });

  it('cleans the cue buffer even without CueDispatchSystem', () => {
    const { world, facade } = createTestWorld({
      cleanupCues: true,
      effects: [defineEffect({ id: 'Effect.Cleanup', type: 'Instant', cues: ['Cue.Cleanup'] })],
    });
    const entity = addEntity(world);

    facade.applyEffect(entity.id, 'Effect.Cleanup', entity.id);
    world.processAllTicks(1);

    expect(facade.gameplayCueBufferInternal.events).toEqual([]);
    world.dispose();
  });

  it('does not push OnApplied for a tag-gated rejected effect', () => {
    const { world, facade, runtime } = createTestWorld({
      effects: [
        defineEffect({
          id: 'Effect.BlockedDamage',
          type: 'Instant',
          modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-10) }],
          tagsBlocked: ['State.Invulnerable'],
          cues: ['Cue.Blocked.ShouldNotFire'],
        }),
      ],
    });
    const entity = addEntity(world);
    facade.initAttributesForEntity(entity.id);
    facade.addTag(entity.id, 'State.Invulnerable');

    facade.applyEffect(entity.id, 'Effect.BlockedDamage', entity.id);
    world.processAllTicks(1);

    expect(runtime.gameplayCueBuffer.events).toEqual([]);
    world.dispose();
  });

  it('pushes OnExpired when removeEffectsByTag forces removal', () => {
    const { world, facade, runtime } = createTestWorld({
      effects: [
        defineEffect({
          id: 'Effect.RemovableShield',
          type: 'Duration',
          durationTicks: 100,
          modifiers: [{ attributeId: 'Armor', op: 'Add', magnitude: FP.FromInt(10) }],
          tagsGranted: ['State.Shielded'],
          cues: { onExpired: ['Cue.Shield.Removed'] },
        }),
      ],
    });
    const source = addEntity(world);
    const target = addEntity(world);
    facade.initAttributesForEntity(target.id);

    facade.applyEffect(target.id, 'Effect.RemovableShield', source.id);
    world.processAllTicks(1);
    runtime.gameplayCueBuffer.events.length = 0;

    expect(facade.removeEffectsByTag(target.id, 'State.Shielded')).toBe(1);
    world.processAllTicks(2);

    expect(runtime.gameplayCueBuffer.events).toEqual([
      {
        tick: 2,
        cueId: 'Cue.Shield.Removed',
        sourceEntityId: source.id,
        targetEntityId: target.id,
        phase: 'OnExpired',
      },
    ]);
    world.dispose();
  });

  it('produces identical cue logs across independent deterministic runs', () => {
    const runScenario = (): CueEvent[] => {
      const { world, facade, cueLog } = createTestWorld({
        dispatchCues: true,
        cleanupCues: true,
        effects: [
          defineEffect({ id: 'Effect.Hit', type: 'Instant', cues: ['Cue.Hit'] }),
          defineEffect({
            id: 'Effect.Dot',
            type: 'Periodic',
            durationTicks: 5,
            periodTicks: 2,
            modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-1) }],
            cues: { onApplied: ['Cue.Dot.Apply'], onPeriodic: ['Cue.Dot.Tick'] },
          }),
          defineEffect({
            id: 'Effect.Buff',
            type: 'Duration',
            durationTicks: 4,
            modifiers: [{ attributeId: 'Armor', op: 'Add', magnitude: FP.FromInt(5) }],
            cues: { onApplied: ['Cue.Buff.Apply'], onExpired: ['Cue.Buff.Expire'] },
          }),
          defineEffect({
            id: 'Effect.ImmediateDot',
            type: 'Periodic',
            durationTicks: 3,
            periodTicks: 2,
            executePeriodicOnApplication: true,
            modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-2) }],
            cues: { onPeriodic: ['Cue.Immediate.Tick'] },
          }),
          defineEffect({
            id: 'Effect.ShortcutPeriodic',
            type: 'Periodic',
            durationTicks: 3,
            periodTicks: 2,
            modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-1) }],
            cues: ['Cue.Shortcut.Apply'],
          }),
        ],
      });
      const source = addEntity(world);
      const target = addEntity(world);
      facade.initAttributesForEntity(target.id);

      for (let tick = 1; tick <= 100; tick++) {
        if (tick % 10 === 1) {
          facade.applyEffect(target.id, 'Effect.Hit', source.id);
        }
        if (tick % 20 === 2) {
          facade.applyEffect(target.id, 'Effect.Dot', source.id);
        }
        if (tick % 25 === 3) {
          facade.applyEffect(target.id, 'Effect.Buff', source.id);
        }
        if (tick % 30 === 4) {
          facade.applyEffect(target.id, 'Effect.ImmediateDot', source.id);
        }
        if (tick % 40 === 5) {
          facade.applyEffect(target.id, 'Effect.ShortcutPeriodic', source.id);
        }
        world.processAllTicks(tick);
      }
      world.dispose();
      return cueLog;
    };

    expect(runScenario()).toEqual(runScenario());
  });
});

interface TestWorldOpts {
  effects: readonly ReturnType<typeof defineEffect>[];
  dispatchCues?: boolean;
  cleanupCues?: boolean;
}

interface TestWorld {
  world: GameWorld;
  facade: AbilitySystemFacade;
  registries: AbilitySystemRegistries;
  runtime: AbilitySystemRuntime;
  cueLog: CueEvent[];
}

function createTestWorld(opts: TestWorldOpts): TestWorld {
  resetEntityIdCounter();
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
  const cueLog: CueEvent[] = [];
  if (opts.dispatchCues === true) {
    world.eventBus.on<CueEvent>(GAMEPLAY_CUE_EVENT, (event) => cueLog.push(event));
  }

  const tickSystems: GameSystem[] = [
    new EffectApplicationSystem(registries, runtime),
    new EffectTickSystem(registries, runtime),
    new AttributeAggregationSystem(registries),
  ];
  if (opts.dispatchCues === true) {
    tickSystems.push(new CueDispatchSystem(runtime));
  }
  if (opts.cleanupCues === true) {
    tickSystems.push(new CueBufferCleanupSystem(runtime));
  }
  world.registerSystems(tickSystems, []);

  const facade = new AbilitySystemFacade(world.entityManager, registries, runtime);
  return { world, facade, registries, runtime, cueLog };
}

function addEntity(world: GameWorld): Entity {
  const entity = new Entity();
  world.entityManager.addEntity(entity);
  return entity;
}

function periodicEvent(tick: number, sourceEntityId: number, targetEntityId: number): CueEvent {
  return {
    tick,
    cueId: 'Cue.Poison.Tick',
    sourceEntityId,
    targetEntityId,
    phase: 'OnPeriodic',
  };
}

