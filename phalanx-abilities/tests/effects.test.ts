import { describe, expect, it } from 'vitest';
import { FP } from '@phalanx-engine/math';
import { getActiveEffectsComponent, NO_SOURCE_ENTITY_ID, defineEffect } from '../src';
import {
  ArmorAttribute,
  HealthAttribute,
  addEntity,
  createTestWorld,
  spawnEntity,
} from './helpers';

describe('effect application', () => {
  it('applies an Instant effect to base on the same tick (single tick visibility)', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      effects: [
        defineEffect({
          id: 'Effect.Damage',
          type: 'Instant',
          modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-10) }],
        }),
      ],
    });
    const entity = spawnEntity(world, abilities);
    // Settle defaults so dirty starts clean.
    world.processAllTicks(1);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(100);

    abilities.applyEffect(entity.id, 'Effect.Damage', entity.id);

    // Application + aggregation both run on tick 2.
    world.processAllTicks(2);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').base)).toBe(90);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(90);

    world.dispose();
  });

  it('queues a Duration effect and reflects it via aggregation; expires on schedule', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
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
    const entity = spawnEntity(world, abilities);
    world.processAllTicks(1);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Armor').current)).toBe(50);

    abilities.applyEffect(entity.id, 'Effect.ArmorShred', entity.id);

    // Tick 2: application inserts the instance with enteredOnTick=2 and
    // remainingTicks=3, aggregation produces Armor=30, tagsGranted is now
    // present. EffectTickSystem deliberately does NOT decrement an instance
    // on its application tick (otherwise durationTicks=1 would be invisible).
    world.processAllTicks(2);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Armor').current)).toBe(30);
    expect(abilities.hasTag(entity.id, 'State.Debuff.ArmorShred')).toBe(true);

    // Tick 3: remaining 3 -> 2.
    world.processAllTicks(3);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Armor').current)).toBe(30);

    // Tick 4: remaining 2 -> 1.
    world.processAllTicks(4);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Armor').current)).toBe(30);

    // Tick 5: remaining 1 -> 0, expires, tag revoked, Armor recomputes to 50.
    world.processAllTicks(5);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Armor').current)).toBe(50);
    expect(abilities.hasTag(entity.id, 'State.Debuff.ArmorShred')).toBe(false);

    world.dispose();
  });

  it('drops effects gated by tagsBlocked and grants tagsGranted on accepted ones', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      effects: [
        defineEffect({
          id: 'Effect.Damage',
          type: 'Instant',
          modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-10) }],
          tagsBlocked: ['State.Invulnerable'],
        }),
      ],
    });
    const entity = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.addTag(entity.id, 'State.Invulnerable');
    abilities.applyEffect(entity.id, 'Effect.Damage', entity.id);
    world.processAllTicks(2);
    // Effect was dropped: Health unchanged.
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').base)).toBe(100);

    abilities.removeTag(entity.id, 'State.Invulnerable');
    abilities.applyEffect(entity.id, 'Effect.Damage', entity.id);
    world.processAllTicks(3);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').base)).toBe(90);

    world.dispose();
  });

  it('honors tagsRequired (effect drops when missing, applies when present)', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      effects: [
        defineEffect({
          id: 'Effect.ExecuteWounded',
          type: 'Instant',
          modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-50) }],
          tagsRequired: ['State.Wounded'],
        }),
      ],
    });
    const entity = spawnEntity(world, abilities);
    world.processAllTicks(1);

    // No `State.Wounded` yet: must be dropped.
    abilities.applyEffect(entity.id, 'Effect.ExecuteWounded', entity.id);
    world.processAllTicks(2);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').base)).toBe(100);

    abilities.addTag(entity.id, 'State.Wounded');
    abilities.applyEffect(entity.id, 'Effect.ExecuteWounded', entity.id);
    world.processAllTicks(3);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').base)).toBe(50);

    world.dispose();
  });

  it('removeEffectsByTag flags matching instances for expiry on the next tick', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
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
    const entity = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.applyEffect(entity.id, 'Effect.ArmorShred', entity.id);
    world.processAllTicks(2);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Armor').current)).toBe(30);
    expect(abilities.hasTag(entity.id, 'State.Debuff.ArmorShred')).toBe(true);

    const flagged = abilities.removeEffectsByTag(entity.id, 'State.Debuff.ArmorShred');
    expect(flagged).toBe(1);

    // Tick 3 runs EffectTickSystem: the flagged instance reaches 0 and is removed,
    // the tag is revoked, and aggregation recomputes Armor without the modifier.
    world.processAllTicks(3);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Armor').current)).toBe(50);
    expect(abilities.hasTag(entity.id, 'State.Debuff.ArmorShred')).toBe(false);

    world.dispose();
  });

  it('removeEffectsByDefId only removes matching defId instances', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
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
    const entity = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.applyEffect(entity.id, 'Effect.Slow', entity.id);
    abilities.applyEffect(entity.id, 'Effect.Poison', entity.id);
    world.processAllTicks(2);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Armor').current)).toBe(35);

    const flagged = abilities.removeEffectsByDefId(entity.id, 'Effect.Slow');
    expect(flagged).toBe(1);

    world.processAllTicks(3);
    // Slow gone, Poison still active.
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Armor').current)).toBe(45);
    expect(abilities.hasTag(entity.id, 'State.Slowed')).toBe(false);
    expect(abilities.hasTag(entity.id, 'State.Poisoned')).toBe(true);

    world.dispose();
  });

  it('does not revoke a tag while another active instance still grants it', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
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
    const entity = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.applyEffect(entity.id, 'Effect.MarkShort', entity.id);
    abilities.applyEffect(entity.id, 'Effect.MarkLong', entity.id);
    world.processAllTicks(2);
    expect(abilities.hasTag(entity.id, 'State.Marked')).toBe(true);

    // Advance until Effect.MarkShort expires: durationTicks=2 means it survives
    // ticks 2 and 3, expires on tick 4. Effect.MarkLong is still active.
    world.processAllTicks(3);
    world.processAllTicks(4);
    expect(abilities.hasTag(entity.id, 'State.Marked')).toBe(true);

    // After MarkLong also expires (tick 7), the tag is revoked.
    world.processAllTicks(5);
    world.processAllTicks(6);
    world.processAllTicks(7);
    expect(abilities.hasTag(entity.id, 'State.Marked')).toBe(false);

    world.dispose();
  });

  it('allocates monotonic instance ids in apply order (FIFO is enforced)', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
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
    const entity = spawnEntity(world, abilities);
    world.processAllTicks(1);
    const before = abilities.instanceIdCounter;

    // Apply in order: 10 first, then 50. Highest-instanceId Override wins.
    abilities.applyEffect(entity.id, 'Effect.OverrideHealth.10', entity.id);
    abilities.applyEffect(entity.id, 'Effect.OverrideHealth.50', entity.id);
    world.processAllTicks(2);

    expect(abilities.instanceIdCounter).toBe(before + 2);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(50);

    world.dispose();
  });

  it('applyEffect throws on unknown effect id or missing entity', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute], effects: [] });
    const entity = addEntity(world);

    expect(() => abilities.applyEffect(entity.id, 'Effect.DoesNotExist', entity.id)).toThrow(
      "EffectRegistry does not contain 'Effect.DoesNotExist'"
    );
    expect(() => abilities.applyEffect(9999, 'Effect.DoesNotExist', entity.id)).toThrow(
      'Entity 9999 does not exist'
    );

    world.dispose();
  });

  it('a durationTicks=1 effect is visible on its application tick and gone the next', () => {
    // Regression guard: an earlier implementation decremented every instance
    // on the same tick it was inserted, which made durationTicks=1 effects
    // expire before AttributeAggregationSystem ever observed them.
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      effects: [
        defineEffect({
          id: 'Effect.OneTickBuff',
          type: 'Duration',
          durationTicks: 1,
          modifiers: [{ attributeId: 'Armor', op: 'Add', magnitude: FP.FromInt(25) }],
          tagsGranted: ['State.Buff.OneTick'],
        }),
      ],
    });
    const entity = spawnEntity(world, abilities);
    world.processAllTicks(1);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Armor').current)).toBe(50);

    abilities.applyEffect(entity.id, 'Effect.OneTickBuff', entity.id);

    // Tick 2 (application tick): aggregation must see the buff exactly once.
    world.processAllTicks(2);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Armor').current)).toBe(75);
    expect(abilities.hasTag(entity.id, 'State.Buff.OneTick')).toBe(true);

    // Tick 3 (next tick): decrement 1 -> 0, expire, tag revoked, Armor recompute.
    world.processAllTicks(3);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Armor').current)).toBe(50);
    expect(abilities.hasTag(entity.id, 'State.Buff.OneTick')).toBe(false);

    world.dispose();
  });

  it('Periodic effects do not contribute to AttributeAggregationSystem continuously', () => {
    // Periodic effects fire their modifiers Instant-style on each scheduled
    // tick (handled by EffectTickSystem in Stage 4). They must NOT also be
    // applied as continuous modifiers by AttributeAggregationSystem —
    // otherwise every DoT tick would double-count. We assert that property
    // here by checking the gap between application tick and the first
    // scheduled firing: tagsGranted is on (lifecycle works), but the periodic
    // modifier has not landed yet, so Armor.current still reads the
    // un-shredded value. Dedicated periodic behavior tests live in
    // periodic-effects.test.ts.
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      effects: [
        defineEffect({
          id: 'Effect.Poison.Periodic.Slow',
          type: 'Periodic',
          durationTicks: 100,
          periodTicks: 10,
          modifiers: [{ attributeId: 'Armor', op: 'Add', magnitude: FP.FromInt(-30) }],
          tagsGranted: ['State.Debuff.Poisoned'],
          // executePeriodicOnApplication defaults to false: no immediate hit.
        }),
      ],
    });
    const entity = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.applyEffect(entity.id, 'Effect.Poison.Periodic.Slow', entity.id);
    // Apply tick = 2 -> nextPeriodTick = 12.
    world.processAllTicks(2);

    // Tag granted, no periodic landing yet (would be on tick 12).
    expect(abilities.hasTag(entity.id, 'State.Debuff.Poisoned')).toBe(true);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Armor').current)).toBe(50);

    // Tick 11: still before first scheduled firing.
    world.processAllTicks(11);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Armor').current)).toBe(50);

    world.dispose();
  });

  it('expiring an effect does not revoke a tag that is also held ad hoc', () => {
    // Regression: previously revokeTags deleted the granted tag directly from
    // the unified set without checking ad-hoc ownership, so an expiring effect
    // could drop a manually managed (faction/team-like) tag.
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      effects: [
        defineEffect({
          id: 'Effect.GrantsMarked',
          type: 'Duration',
          durationTicks: 1,
          tagsGranted: ['State.Marked'],
          modifiers: [],
        }),
      ],
    });
    const entity = spawnEntity(world, abilities);
    abilities.addTag(entity.id, 'State.Marked');
    expect(abilities.hasTag(entity.id, 'State.Marked')).toBe(true);

    abilities.applyEffect(entity.id, 'Effect.GrantsMarked', entity.id);
    world.processAllTicks(1);
    expect(abilities.hasTag(entity.id, 'State.Marked')).toBe(true);

    // Tick 2: the effect expires. The ad-hoc grant must keep the tag alive.
    world.processAllTicks(2);
    expect(abilities.hasTag(entity.id, 'State.Marked')).toBe(true);

    world.dispose();
  });

  it('removeTag preserves an effect-granted tag and only clears ad-hoc ownership', () => {
    // Regression: previously removeTag deleted from the single Set, so calling
    // it while an effect granted the same tag silently dropped the effect’s
    // contribution and the tag never came back on later ticks.
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      effects: [
        defineEffect({
          id: 'Effect.GrantsBuff',
          type: 'Duration',
          durationTicks: 5,
          tagsGranted: ['State.Buffed'],
          modifiers: [],
        }),
      ],
    });
    const entity = spawnEntity(world, abilities);

    abilities.addTag(entity.id, 'State.Buffed');
    abilities.applyEffect(entity.id, 'Effect.GrantsBuff', entity.id);
    world.processAllTicks(1);
    expect(abilities.hasTag(entity.id, 'State.Buffed')).toBe(true);

    // Caller clears their ad-hoc ownership while the effect still grants it.
    const cleared = abilities.removeTag(entity.id, 'State.Buffed');
    expect(cleared).toBe(true);
    // Tag stays — the effect's grant is still in force.
    expect(abilities.hasTag(entity.id, 'State.Buffed')).toBe(true);

    // A second removeTag call now returns false (no ad-hoc to clear) and the
    // tag is still held by the effect.
    expect(abilities.removeTag(entity.id, 'State.Buffed')).toBe(false);
    expect(abilities.hasTag(entity.id, 'State.Buffed')).toBe(true);

    world.dispose();
  });

  it('a misconfigured effect throws atomically and leaves no tag grants behind', () => {
    // Regression: previously tagsGranted was applied before durationTicks /
    // modifier-attribute validation, so a throwing effect could leave the
    // entity with leaked tag grants.
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      effects: [
        // Duration with no durationTicks — invalid; should throw at apply time.
        defineEffect({
          id: 'Effect.BadDuration',
          type: 'Duration',
          tagsGranted: ['State.LeakSentinel'],
          modifiers: [],
        }),
        // Modifier references an attribute that the test world does not register.
        defineEffect({
          id: 'Effect.BadModifierAttr',
          type: 'Instant',
          tagsGranted: ['State.LeakSentinel2'],
          modifiers: [
            { attributeId: 'NonExistentAttribute', op: 'Add', magnitude: FP.FromInt(-1) },
          ],
        }),
      ],
    });
    const entity = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.applyEffect(entity.id, 'Effect.BadDuration', entity.id);
    expect(() => world.processAllTicks(2)).toThrow();
    expect(abilities.hasTag(entity.id, 'State.LeakSentinel')).toBe(false);

    abilities.applyEffect(entity.id, 'Effect.BadModifierAttr', entity.id);
    expect(() => world.processAllTicks(3)).toThrow();
    expect(abilities.hasTag(entity.id, 'State.LeakSentinel2')).toBe(false);

    world.dispose();
  });

  it('applyEffect omits sourceEntityId and records the sentinel NO_SOURCE_ENTITY_ID', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      effects: [
        defineEffect({
          id: 'Effect.Sourceless',
          type: 'Duration',
          durationTicks: 10,
          modifiers: [{ attributeId: 'Armor', op: 'Add', magnitude: FP.FromInt(-5) }],
          tagsGranted: ['State.Sourceless'],
        }),
      ],
    });
    const entity = spawnEntity(world, abilities);

    // No source argument — valid call.
    abilities.applyEffect(entity.id, 'Effect.Sourceless');
    world.processAllTicks(1);

    const activeEffects = getActiveEffectsComponent(world.entityManager.getEntity(entity.id)!)!;
    expect(activeEffects.queue.length).toBe(1);
    expect(activeEffects.queue[0].sourceEntityId).toBe(NO_SOURCE_ENTITY_ID);
    expect(abilities.hasTag(entity.id, 'State.Sourceless')).toBe(true);

    world.dispose();
  });

  it('reapplying a Duration effect after expiry restores tag and modifier', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
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
    const entity = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.applyEffect(entity.id, 'Effect.ShortShred', entity.id);
    world.processAllTicks(2);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Armor').current)).toBe(35);

    // durationTicks=2: survives ticks 2 and 3, expires on tick 4.
    world.processAllTicks(3);
    world.processAllTicks(4);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Armor').current)).toBe(50);
    expect(abilities.hasTag(entity.id, 'State.Debuff.Shred')).toBe(false);

    abilities.applyEffect(entity.id, 'Effect.ShortShred', entity.id);
    world.processAllTicks(5);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Armor').current)).toBe(35);
    expect(abilities.hasTag(entity.id, 'State.Debuff.Shred')).toBe(true);

    world.dispose();
  });
});

