import { describe, expect, it } from 'vitest';
import { FP } from 'phalanx-math';
import { defineEffect, gameplayCueKey } from '../src';
import { GAMEPLAY_CUE_EVENT } from '../src/events';
import type { CueEvent } from '../src';
import {
  ArmorAttribute,
  HealthAttribute,
  addEntity,
  createTestWorld,
  spawnEntity,
} from './helpers';

describe('gameplay cues', () => {
  it('pushes OnApplied for an Instant effect using the string[] shortcut', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects-retain-cues',
      attributes: [HealthAttribute, ArmorAttribute],
      effects: [
        defineEffect({
          id: 'Effect.AutoAttack.Damage',
          type: 'Instant',
          modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-10) }],
          cues: ['Cue.AutoAttack.Hit'],
        }),
      ],
    });
    const source = spawnEntity(world, abilities);
    const target = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.applyEffect(target.id, 'Effect.AutoAttack.Damage', source.id);
    world.processAllTicks(2);

    expect(abilities.gameplayCueBuffer.events).toEqual([
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
    const { world, abilities, cueLog } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      cues: 'dispatch',
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
    const source = spawnEntity(world, abilities);
    const target = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.applyEffect(target.id, 'Effect.ArmorShred', source.id);
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
    expect(abilities.gameplayCueBuffer.events).toEqual([]);

    world.processAllTicks(3);
    expect(cueLog).toHaveLength(1);
    expect(abilities.gameplayCueBuffer.events).toEqual([]);

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
    expect(abilities.gameplayCueBuffer.events).toEqual([]);
    world.dispose();
  });

  it('pushes OnPeriodic exactly on scheduled periodic landings', () => {
    const { world, abilities, cueLog } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      cues: 'dispatch',
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
    const source = spawnEntity(world, abilities);
    const target = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.applyEffect(target.id, 'Effect.Poison', source.id);
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
    const { world, abilities, cueLog } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      cues: 'dispatch',
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
    const source = spawnEntity(world, abilities);
    const target = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.applyEffect(target.id, 'Effect.BurningWeapon', source.id);
    abilities.applyEffect(target.id, 'Effect.ShortcutPeriodic', source.id);
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
      const { world, abilities, cueLog } = createTestWorld({
        pipeline: 'effects',
        attributes: [HealthAttribute, ArmorAttribute],
        cues: 'dispatch',
        effects: [
          defineEffect({ id: 'Effect.First', type: 'Instant', cues: ['Cue.First'] }),
          defineEffect({ id: 'Effect.Second', type: 'Instant', cues: ['Cue.Second'] }),
        ],
      });
      const source = spawnEntity(world, abilities);
      const firstTarget = spawnEntity(world, abilities);
      const secondTarget = spawnEntity(world, abilities);
      abilities.applyEffect(firstTarget.id, 'Effect.First', source.id);
      abilities.applyEffect(firstTarget.id, 'Effect.Second', source.id);
      abilities.applyEffect(secondTarget.id, 'Effect.First', source.id);
      abilities.applyEffect(secondTarget.id, 'Effect.Second', source.id);
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
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      cues: 'dispatch',
      effects: [defineEffect({ id: 'Effect.Signal', type: 'Instant', cues: ['Cue.X'] })],
    });
    const globalEvents: CueEvent[] = [];
    const perCueEvents: CueEvent[] = [];
    world.eventBus.on<CueEvent>(GAMEPLAY_CUE_EVENT, (event) => globalEvents.push(event));
    world.eventBus.on<CueEvent>(gameplayCueKey('Cue.X'), (event) => perCueEvents.push(event));
    const source = spawnEntity(world, abilities);
    const target = spawnEntity(world, abilities);

    abilities.applyEffect(target.id, 'Effect.Signal', source.id);
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
    expect(abilities.gameplayCueBuffer.events).toEqual([]);
    world.dispose();
  });

  it('cleans the cue buffer even without CueDispatchSystem', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects', attributes: [HealthAttribute, ArmorAttribute], cues: 'buffer',
      effects: [defineEffect({ id: 'Effect.Cleanup', type: 'Instant', cues: ['Cue.Cleanup'] })],
    });
    const entity = spawnEntity(world, abilities);

    abilities.applyEffect(entity.id, 'Effect.Cleanup', entity.id);
    world.processAllTicks(1);

    expect(abilities.gameplayCueBuffer.events).toEqual([]);
    world.dispose();
  });

  it('does not push OnApplied for a tag-gated rejected effect', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
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
    const entity = spawnEntity(world, abilities);
    abilities.addTag(entity.id, 'State.Invulnerable');

    abilities.applyEffect(entity.id, 'Effect.BlockedDamage', entity.id);
    world.processAllTicks(1);

    expect(abilities.gameplayCueBuffer.events).toEqual([]);
    world.dispose();
  });

  it('pushes OnExpired when removeEffectsByTag forces removal', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects-retain-cues',
      attributes: [HealthAttribute, ArmorAttribute],
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
    const source = spawnEntity(world, abilities);
    const target = spawnEntity(world, abilities);
    abilities.applyEffect(target.id, 'Effect.RemovableShield', source.id);
    world.processAllTicks(1);
    abilities.gameplayCueBuffer.events.length = 0;

    expect(abilities.removeEffectsByTag(target.id, 'State.Shielded')).toBe(1);
    world.processAllTicks(2);

    expect(abilities.gameplayCueBuffer.events).toEqual([
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
      const { world, abilities, cueLog } = createTestWorld({
        pipeline: 'effects',
        attributes: [HealthAttribute, ArmorAttribute],
        cues: 'dispatch',
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
      const source = spawnEntity(world, abilities);
      const target = spawnEntity(world, abilities);
      for (let tick = 1; tick <= 100; tick++) {
        if (tick % 10 === 1) {
          abilities.applyEffect(target.id, 'Effect.Hit', source.id);
        }
        if (tick % 20 === 2) {
          abilities.applyEffect(target.id, 'Effect.Dot', source.id);
        }
        if (tick % 25 === 3) {
          abilities.applyEffect(target.id, 'Effect.Buff', source.id);
        }
        if (tick % 30 === 4) {
          abilities.applyEffect(target.id, 'Effect.ImmediateDot', source.id);
        }
        if (tick % 40 === 5) {
          abilities.applyEffect(target.id, 'Effect.ShortcutPeriodic', source.id);
        }
        world.processAllTicks(tick);
      }
      world.dispose();
      return cueLog;
    };

    expect(runScenario()).toEqual(runScenario());
  });
});

function periodicEvent(tick: number, sourceEntityId: number, targetEntityId: number): CueEvent {
  return {
    tick,
    cueId: 'Cue.Poison.Tick',
    sourceEntityId,
    targetEntityId,
    phase: 'OnPeriodic',
  };
}

