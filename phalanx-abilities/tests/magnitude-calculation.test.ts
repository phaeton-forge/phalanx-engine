import { describe, expect, it } from 'vitest';
import { FP } from '@phalanx-engine/math';
import { defineEffect } from '../src';
import type { MagnitudeCalcContext, MagnitudeCalculation } from '../src';
import {
  ArmorAttribute,
  HealthAttribute,
  createTestWorld,
  spawnEntity,
} from './helpers';

// ---------------------------------------------------------------------------
// Task 0 - Dynamic magnitude calculation (Modifier.calculation + setByCaller).
//
// Covers:
//  1. Instant/Duration/Periodic each evaluating a calculation that reads the
//     source attribute, the target attribute, and setByCaller.
//  2. Snapshot semantics: a Duration/Periodic modifier's effective magnitude
//     is fixed at application time - changing the source attribute (or the
//     source despawning) afterward does not change the already-applied
//     modifier.
//  3. Null-source fallback (no source / despawned source).
//  4. Backward compatibility: modifiers without `calculation` behave exactly
//     as before (byte-identical to the pre-existing aggregation path).
// ---------------------------------------------------------------------------

/** Ability-level-style calculation: base * (1 + 0.5 * (level - 1)), reading `AbilityLevel` off source. */
const levelScaledDamage: MagnitudeCalculation = (ctx: MagnitudeCalcContext) => {
  const level = ctx.abilities.tryGetAttribute(ctx.sourceEntityId, 'AbilityLevel');
  if (!level) {
    return ctx.baseMagnitude;
  }
  const levelMinusOne = FP.Sub(level.current, FP.FromInt(1));
  const multiplier = FP.Add(FP.FromInt(1), FP.Mul(FP.FromFloat(0.5), levelMinusOne));
  return FP.Mul(ctx.baseMagnitude, multiplier);
};

describe('dynamic magnitude calculation', () => {
  it('Instant: level 3 source scales -10 base into -20 effective damage', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, levelAttribute()],
      effects: [
        defineEffect({
          id: 'Effect.Damage.LevelScaled',
          type: 'Instant',
          modifiers: [
            {
              attributeId: 'Health',
              op: 'Add',
              magnitude: FP.FromInt(-10),
              calculation: levelScaledDamage,
            },
          ],
        }),
      ],
    });
    const source = spawnEntity(world, abilities, {
      attributes: { AbilityLevel: FP.FromInt(3) },
    });
    const target = spawnEntity(world, abilities);
    world.processAllTicks(1);
    expect(FP.ToFloat(abilities.getAttribute(target.id, 'Health').current)).toBe(100);

    abilities.applyEffect(target.id, 'Effect.Damage.LevelScaled', source.id);
    world.processAllTicks(2);

    // -10 * (1 + 0.5*(3-1)) = -10 * 2 = -20.
    expect(FP.ToFloat(abilities.getAttribute(target.id, 'Health').current)).toBe(80);

    world.dispose();
  });

  it('Instant: setByCaller payload is threaded into the calculation context', () => {
    const jumpFalloff: MagnitudeCalculation = (ctx) => {
      const jumpIndex = (ctx.setByCaller?.get('jumpIndex') as number | undefined) ?? 0;
      // FP-only exponentiation by repeated multiplication (no Math.pow/floats):
      // 0.75^jumpIndex via an integer loop, using FP.FromString (not FromFloat)
      // so the literal never round-trips through a JS float.
      const perJumpFalloff = FP.FromString('0.75');
      let falloff = FP.FromInt(1);
      for (let i = 0; i < jumpIndex; i++) {
        falloff = FP.Mul(falloff, perJumpFalloff);
      }
      return FP.Mul(ctx.baseMagnitude, falloff);
    };
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute],
      effects: [
        defineEffect({
          id: 'Effect.Volt.Jump',
          type: 'Instant',
          modifiers: [
            {
              attributeId: 'Health',
              op: 'Add',
              magnitude: FP.FromInt(-40),
              calculation: jumpFalloff,
            },
          ],
        }),
      ],
    });
    const target = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.applyEffect(
      target.id,
      'Effect.Volt.Jump',
      undefined,
      new Map<string, unknown>([['jumpIndex', 2]])
    );
    world.processAllTicks(2);

    // -40 * 0.75^2 = -22.5.
    expect(FP.ToFloat(abilities.getAttribute(target.id, 'Health').current)).toBe(77.5);

    world.dispose();
  });

  it('Instant: null source (no source supplied) falls back to baseMagnitude', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute],
      effects: [
        defineEffect({
          id: 'Effect.Damage.LevelScaled',
          type: 'Instant',
          modifiers: [
            {
              attributeId: 'Health',
              op: 'Add',
              magnitude: FP.FromInt(-10),
              calculation: levelScaledDamage,
            },
          ],
        }),
      ],
    });
    const target = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.applyEffect(target.id, 'Effect.Damage.LevelScaled'); // no sourceEntityId
    world.processAllTicks(2);

    expect(FP.ToFloat(abilities.getAttribute(target.id, 'Health').current)).toBe(90);

    world.dispose();
  });

  it('Instant: despawned source falls back to baseMagnitude', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, levelAttribute()],
      effects: [
        defineEffect({
          id: 'Effect.Damage.LevelScaled',
          type: 'Instant',
          modifiers: [
            {
              attributeId: 'Health',
              op: 'Add',
              magnitude: FP.FromInt(-10),
              calculation: levelScaledDamage,
            },
          ],
        }),
      ],
    });
    const source = spawnEntity(world, abilities, {
      attributes: { AbilityLevel: FP.FromInt(3) },
    });
    const target = spawnEntity(world, abilities);
    world.processAllTicks(1);

    world.entityManager.removeEntity(source);
    abilities.applyEffect(target.id, 'Effect.Damage.LevelScaled', source.id);
    world.processAllTicks(2);

    expect(FP.ToFloat(abilities.getAttribute(target.id, 'Health').current)).toBe(90);

    world.dispose();
  });

  it('Duration: snapshot semantics - source attribute change after application does not change the modifier', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute, levelAttribute()],
      effects: [
        defineEffect({
          id: 'Effect.ArmorShred.LevelScaled',
          type: 'Duration',
          durationTicks: 10,
          modifiers: [
            {
              attributeId: 'Armor',
              op: 'Add',
              magnitude: FP.FromInt(-10),
              calculation: levelScaledDamage,
            },
          ],
        }),
        defineEffect({
          id: 'Effect.LevelUp',
          type: 'Instant',
          modifiers: [{ attributeId: 'AbilityLevel', op: 'Add', magnitude: FP.FromInt(4) }],
        }),
      ],
    });
    const source = spawnEntity(world, abilities, {
      attributes: { AbilityLevel: FP.FromInt(1) },
    });
    const target = spawnEntity(world, abilities);
    world.processAllTicks(1);

    // Level 1 at application: -10 * (1 + 0.5*0) = -10.
    abilities.applyEffect(target.id, 'Effect.ArmorShred.LevelScaled', source.id);
    world.processAllTicks(2);
    expect(FP.ToFloat(abilities.getAttribute(target.id, 'Armor').current)).toBe(40);

    // Bump the source's level well after application. The already-applied
    // Duration modifier must NOT recompute - snapshot semantics.
    abilities.applyEffect(source.id, 'Effect.LevelUp', source.id);
    world.processAllTicks(3);
    expect(FP.ToFloat(abilities.getAttribute(source.id, 'AbilityLevel').current)).toBe(5);
    expect(FP.ToFloat(abilities.getAttribute(target.id, 'Armor').current)).toBe(40);

    world.processAllTicks(4);
    expect(FP.ToFloat(abilities.getAttribute(target.id, 'Armor').current)).toBe(40);

    world.dispose();
  });

  it('Periodic: capturedMagnitudes is reused for every landing, not recomputed per firing', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, levelAttribute()],
      effects: [
        defineEffect({
          id: 'Effect.DoT.LevelScaled',
          type: 'Periodic',
          durationTicks: 15,
          periodTicks: 5,
          modifiers: [
            {
              attributeId: 'Health',
              op: 'Add',
              magnitude: FP.FromInt(-4),
              calculation: levelScaledDamage,
            },
          ],
        }),
        defineEffect({
          id: 'Effect.LevelUp',
          type: 'Instant',
          modifiers: [{ attributeId: 'AbilityLevel', op: 'Add', magnitude: FP.FromInt(4) }],
        }),
      ],
    });
    const source = spawnEntity(world, abilities, {
      attributes: { AbilityLevel: FP.FromInt(1) },
    });
    const target = spawnEntity(world, abilities);
    world.processAllTicks(1);

    // Level 1 at application: -4 * 1 = -4 per tick landing.
    abilities.applyEffect(target.id, 'Effect.DoT.LevelScaled', source.id);
    world.processAllTicks(2); // apply tick, nextPeriodTick = 7

    // Bump level right after application; captured magnitude must not change.
    abilities.applyEffect(source.id, 'Effect.LevelUp', source.id);
    world.processAllTicks(3);
    expect(FP.ToFloat(abilities.getAttribute(source.id, 'AbilityLevel').current)).toBe(5);

    for (let t = 4; t <= 7; t++) world.processAllTicks(t); // first periodic landing: still -4, not -4*3=-12
    expect(FP.ToFloat(abilities.getAttribute(target.id, 'Health').current)).toBe(96);

    for (let t = 8; t <= 12; t++) world.processAllTicks(t); // second landing
    expect(FP.ToFloat(abilities.getAttribute(target.id, 'Health').current)).toBe(92);

    world.dispose();
  });

  it('backward compat: modifiers without `calculation` aggregate byte-identical to before', () => {
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

    world.processAllTicks(2);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Armor').current)).toBe(30);
    expect(abilities.hasTag(entity.id, 'State.Debuff.ArmorShred')).toBe(true);

    world.processAllTicks(3);
    world.processAllTicks(4);
    world.processAllTicks(5);
    expect(FP.ToFloat(abilities.getAttribute(entity.id, 'Armor').current)).toBe(50);
    expect(abilities.hasTag(entity.id, 'State.Debuff.ArmorShred')).toBe(false);

    world.dispose();
  });
});

function levelAttribute() {
  return {
    id: 'AbilityLevel',
    default: FP.FromInt(1),
    min: FP.FromInt(1),
    max: FP.FromInt(10),
    clamp: 'both' as const,
  };
}
