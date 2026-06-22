import { describe, expect, it } from 'vitest';
import { FP } from 'phalanx-math';
import { AbilitiesComponentType, defineEffect } from '../src';
import type { AbilitySystemComponent } from '../src';
import {
  ArmorAttribute,
  HealthAttribute,
  createTestWorld,
  spawnEntity,
} from './helpers';
import {GameWorld} from "phalanx-ecs";

// ---------------------------------------------------------------------------
// Stage 4 — Periodic effects.
//
// What we are verifying here, beyond the lifecycle parts already covered in
// effects.test.ts:
//
//  1. A Periodic effect fires its modifiers Instant-style on each scheduled
//     tick (`currentTick >= nextPeriodTick`), against `base`, with `current`
//     observable on the same tick through AttributeAggregationSystem.
//  2. The first firing is one full `periodTicks` after the application tick
//     when `executePeriodicOnApplication` is omitted/false.
//  3. With `executePeriodicOnApplication: true` the payload also fires once
//     at apply time, then resumes the regular schedule one period later.
//  4. The total number of firings over an effect's lifetime is exactly
//     `floor(durationTicks / periodTicks)` (without on-application) or one
//     more than that (with on-application).
//  5. Lifetime countdown and tag revocation work the same as Duration.
//  6. Forced removal via `removeEffectsByTag` cancels future firings, but
//     does NOT trigger an extra firing on the way out.
//  7. Misconfigured Periodic defs (missing/non-positive `periodTicks`) are
//     rejected at application time, atomically — no tag leakage.
//  8. `nextPeriodTick` advances by `periodTicks` once per firing — verifiable
//     by inspecting `ActiveEffectsComponent.queue` directly.
//
// These tests intentionally avoid asserting on `base` directly when the
// public surface (`getAttribute(...).current`) can express the same thing,
// since `current` is what user code reads.
// ---------------------------------------------------------------------------

describe('Periodic effects', () => {
  it('fires its payload one period after application (default scheduling)', () => {
    // DoT: -3 Health every 5 ticks, total lifetime 20 ticks => 4 firings.
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      effects: [
        defineEffect({
          id: 'Effect.DoT.Bleed',
          type: 'Periodic',
          durationTicks: 20,
          periodTicks: 5,
          modifiers: [
            { attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-3) },
          ],
          tagsGranted: ['State.Debuff.Bleed'],
        }),
      ],
    });
    const entity = spawnEntity(world, abilities);
    world.processAllTicks(1);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      100
    );

    abilities.applyEffect(entity.id, 'Effect.DoT.Bleed', entity.id);
    // Tick 2: apply tick — instance queued, nextPeriodTick = 7. Tag granted.
    world.processAllTicks(2);
    expect(abilities.hasTag(entity.id, 'State.Debuff.Bleed')).toBe(true);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      100
    );

    // Ticks 3..6: still before first firing.
    for (let t = 3; t <= 6; t++) {
      world.processAllTicks(t);
      expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
        100
      );
    }

    // Tick 7: first firing. -3 Health.
    world.processAllTicks(7);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      97
    );

    // Tick 12: second firing.
    for (let t = 8; t <= 11; t++) world.processAllTicks(t);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      97
    );
    world.processAllTicks(12);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      94
    );

    // Tick 17, 22 — but 22 falls AFTER expiry (apply tick 2, duration 20 =>
    // remainingTicks goes 20→19 at t=3 ... →0 at t=22; expires that tick).
    // The plan's periodic ordering is fire-before-countdown, so the final
    // firing on tick 22 still happens.
    for (let t = 13; t <= 16; t++) world.processAllTicks(t);
    world.processAllTicks(17);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      91
    );

    for (let t = 18; t <= 21; t++) world.processAllTicks(t);
    world.processAllTicks(22);
    // Fourth firing fired, then countdown expired the instance, tag revoked.
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      88
    );
    expect(abilities.hasTag(entity.id, 'State.Debuff.Bleed')).toBe(false);

    // No more firings after expiry.
    for (let t = 23; t <= 30; t++) world.processAllTicks(t);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      88
    );

    world.dispose();
  });


  it('without executePeriodicOnApplication fires durationTicks/periodTicks times exactly', () => {
    // Sanity-count firings via Override: each firing sets Health to a known
    // value, so we can verify by inspecting current after expiry. Use a
    // counter attribute via Add, which is more direct than Override here.
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      effects: [
        defineEffect({
          id: 'Effect.DoT.Count',
          type: 'Periodic',
          durationTicks: 12,
          periodTicks: 4,
          modifiers: [
            { attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-1) },
          ],
        }),
      ],
    });
    const entity = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.applyEffect(entity.id, 'Effect.DoT.Count', entity.id);
    // Apply tick 2. nextPeriodTick = 6. durationTicks=12 means remaining
    // reaches 0 on tick 14. Firings: 6, 10, 14 — three firings = 12/4.
    for (let t = 2; t <= 20; t++) world.processAllTicks(t);

    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      97
    );

    world.dispose();
  });

  it('advances nextPeriodTick by periodTicks per firing (queue-level invariant)', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      effects: [
        defineEffect({
          id: 'Effect.Tick',
          type: 'Periodic',
          durationTicks: 20,
          periodTicks: 4,
          modifiers: [
            { attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-1) },
          ],
        }),
      ],
    });
    const entity = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.applyEffect(entity.id, 'Effect.Tick', entity.id);
    world.processAllTicks(2);
    const queue = activeEffectsOf(world, entity.id).queue;
    expect(queue.length).toBe(1);
    expect(queue[0].nextPeriodTick).toBe(6);

    // After tick 6 (one firing): nextPeriodTick advances to 10.
    world.processAllTicks(3);
    world.processAllTicks(4);
    world.processAllTicks(5);
    world.processAllTicks(6);
    expect(queue[0].nextPeriodTick).toBe(10);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      99
    );

    // After tick 10 (second firing): nextPeriodTick = 14.
    for (let t = 7; t <= 10; t++) world.processAllTicks(t);
    expect(queue[0].nextPeriodTick).toBe(14);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      98
    );

    world.dispose();
  });

  it('removeEffectsByTag cancels future periodic firings without producing an extra landing', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      effects: [
        defineEffect({
          id: 'Effect.DoT.Cancelable',
          type: 'Periodic',
          durationTicks: 50,
          periodTicks: 5,
          modifiers: [
            { attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-5) },
          ],
          tagsGranted: ['State.Debuff.DoT'],
        }),
      ],
    });
    const entity = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.applyEffect(entity.id, 'Effect.DoT.Cancelable', entity.id);
    world.processAllTicks(2); // apply tick, nextPeriodTick = 7
    for (let t = 3; t <= 7; t++) world.processAllTicks(t);
    // One firing at tick 7.
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      95
    );

    // Cancel before the next firing window. removeEffectsByTag sets
    // remainingTicks=0 on the matched instance.
    const flagged = abilities.removeEffectsByTag(entity.id, 'State.Debuff.DoT');
    expect(flagged).toBe(1);

    // Tick 8 runs EffectTickSystem: periodic fire skipped (remainingTicks=0),
    // countdown skipped, expiry pass harvests the instance, tag revoked.
    world.processAllTicks(8);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      95
    );
    expect(abilities.hasTag(entity.id, 'State.Debuff.DoT')).toBe(false);

    // No further firings.
    for (let t = 9; t <= 30; t++) world.processAllTicks(t);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      95
    );

    world.dispose();
  });

  it('rejects a Periodic effect with missing or non-positive periodTicks atomically', () => {
    // Both bad shapes throw at apply time and must not leak tagsGranted.
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      effects: [
        defineEffect({
          id: 'Effect.Periodic.BadMissing',
          type: 'Periodic',
          durationTicks: 5,
          // periodTicks deliberately omitted
          tagsGranted: ['State.LeakSentinel.A'],
          modifiers: [
            { attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-1) },
          ],
        }),
        defineEffect({
          id: 'Effect.Periodic.BadZero',
          type: 'Periodic',
          durationTicks: 5,
          periodTicks: 0,
          tagsGranted: ['State.LeakSentinel.B'],
          modifiers: [
            { attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-1) },
          ],
        }),
        defineEffect({
          id: 'Effect.Periodic.BadNegative',
          type: 'Periodic',
          durationTicks: 5,
          periodTicks: -2,
          tagsGranted: ['State.LeakSentinel.C'],
          modifiers: [
            { attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-1) },
          ],
        }),
      ],
    });
    const entity = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.applyEffect(entity.id, 'Effect.Periodic.BadMissing', entity.id);
    expect(() => world.processAllTicks(2)).toThrow(/invalid periodTicks/);
    expect(abilities.hasTag(entity.id, 'State.LeakSentinel.A')).toBe(false);

    abilities.applyEffect(entity.id, 'Effect.Periodic.BadZero', entity.id);
    expect(() => world.processAllTicks(3)).toThrow(/invalid periodTicks/);
    expect(abilities.hasTag(entity.id, 'State.LeakSentinel.B')).toBe(false);

    abilities.applyEffect(entity.id, 'Effect.Periodic.BadNegative', entity.id);
    expect(() => world.processAllTicks(4)).toThrow(/invalid periodTicks/);
    expect(abilities.hasTag(entity.id, 'State.LeakSentinel.C')).toBe(false);

    world.dispose();
  });

  it('periodic Multiply modifiers compound exactly once per firing', () => {
    // Multiply lets us check the FixedPoint round-tripping at each firing:
    // Health *= 0.5 each period. Starting at 100, after 3 firings should be
    // exactly 12.5 (clamped above 0).
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      effects: [
        defineEffect({
          id: 'Effect.Halver',
          type: 'Periodic',
          durationTicks: 9,
          periodTicks: 3,
          modifiers: [
            {
              attributeId: 'Health',
              op: 'Multiply',
              magnitude: FP.FromFloat(0.5),
            },
          ],
        }),
      ],
    });
    const entity = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.applyEffect(entity.id, 'Effect.Halver', entity.id);
    // Apply tick 2; firings at 5, 8, 11; expires at tick 11 (lands on final
    // firing thanks to fire-before-countdown).
    for (let t = 2; t <= 4; t++) world.processAllTicks(t);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      100
    );

    world.processAllTicks(5);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      50
    );
    world.processAllTicks(6);
    world.processAllTicks(7);
    world.processAllTicks(8);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      25
    );
    world.processAllTicks(9);
    world.processAllTicks(10);
    world.processAllTicks(11);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      12.5
    );

    world.dispose();
  });

  it('periodic with executePeriodicOnApplication=true and durationTicks=periodTicks fires exactly twice', () => {
    // Edge case: a one-period lifetime with on-application produces apply-tick
    // firing AND the regular firing at the lifetime boundary.
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      effects: [
        defineEffect({
          id: 'Effect.Bookends',
          type: 'Periodic',
          durationTicks: 4,
          periodTicks: 4,
          executePeriodicOnApplication: true,
          modifiers: [
            { attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-7) },
          ],
          tagsGranted: ['State.Debuff.Bookends'],
        }),
      ],
    });
    const entity = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.applyEffect(entity.id, 'Effect.Bookends', entity.id);
    // Apply tick = 2. on-application fires once (-7 -> 93). nextPeriodTick = 6.
    world.processAllTicks(2);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      93
    );
    expect(abilities.hasTag(entity.id, 'State.Debuff.Bookends')).toBe(true);

    world.processAllTicks(3);
    world.processAllTicks(4);
    world.processAllTicks(5);
    // No firing yet.
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      93
    );

    // Tick 6: second firing (-7 -> 86), countdown 1→0, expire, tag off.
    world.processAllTicks(6);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      86
    );
    expect(abilities.hasTag(entity.id, 'State.Debuff.Bookends')).toBe(false);

    world.dispose();
  });

  it('two independent periodics on the same entity each follow their own schedule', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      effects: [
        defineEffect({
          id: 'Effect.SlowDoT',
          type: 'Periodic',
          durationTicks: 30,
          periodTicks: 10,
          modifiers: [
            { attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-1) },
          ],
        }),
        defineEffect({
          id: 'Effect.FastDoT',
          type: 'Periodic',
          durationTicks: 30,
          periodTicks: 3,
          modifiers: [
            { attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-1) },
          ],
        }),
      ],
    });
    const entity = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.applyEffect(entity.id, 'Effect.SlowDoT', entity.id);
    abilities.applyEffect(entity.id, 'Effect.FastDoT', entity.id);
    // Apply tick = 2. Slow nextPeriodTick = 12, Fast nextPeriodTick = 5.

    for (let t = 2; t <= 32; t++) world.processAllTicks(t);

    // Expected over ticks 2..32:
    //   Slow fires at 12, 22, 32 (durationTicks=30 means expiry at tick 32,
    //     fire-before-countdown lets the boundary fire happen). => 3 hits.
    //   Fast fires at 5,8,11,14,17,20,23,26,29,32 => 10 hits.
    // Total Health delta: -13 => 87.
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Health').current)).toBe(
      87
    );

    world.dispose();
  });
});

function activeEffectsOf(world: GameWorld, entityId: number) {
  const entity = world.entityManager.getEntity(entityId);
  if (!entity) throw new Error(`entity ${entityId} missing`);
  const component =
    entity.getComponent<AbilitySystemComponent>(AbilitiesComponentType.AbilitySystem)
      ?.activeEffects;
  if (!component) throw new Error(`ability effects missing on ${entityId}`);
  return component;
}
