import { FP } from 'phalanx-math';
import { defineAbility, defineAbilitySystem, defineAttribute, defineEffect } from 'phalanx-abilities';

/** Uniform move speed for all units (world units per second). */
export const UNIT_MOVE_SPEED = 13;

/**
 * Highest max-health value among all unit types in the roster (spheres: 90,
 * cube: 120, support: 70). Used as the static upper bound for the Health attribute so the
 * aggregation-system clamp acts as a second safety net against overheal.
 */
export const MAX_UNIT_HEALTH = 120;

/** Attack cooldown: 40 ticks = 2 s at 20 TPS */
export const ATTACK_COOLDOWN_TICKS = 40;

/** Beam effect duration in ticks */
export const BEAM_EFFECT_DURATION_TICKS = 3;

/** Damage a sphere unit deals per auto-attack (= |Effect.Damage.Sphere| magnitude). */
export const SPHERE_ATTACK_DAMAGE = 18;

/**
 * Support healing aura. Heals 40% of a sphere's auto-attack damage per pulse,
 * where one pulse spans {@link ATTACK_COOLDOWN_TICKS} (40 ticks = 2s @ 20 TPS).
 */
export const HEAL_PULSE_TICKS = 20;
export const HEAL_PER_PULSE = SPHERE_ATTACK_DAMAGE * 0.4;
/** Healing aura radius (world units); allies inside are healed each pulse. */
export const HEAL_AURA_RADIUS = 16;
/**
 * Duration of the aura "active" marker effect. Effectively the whole match —
 * re-applying is unnecessary because a support unit auras for its entire life.
 */
export const HEAL_AURA_DURATION_TICKS = 36_000; // 30 min @ 20 TPS

/** Cube beam: enemies attack this many times slower (AttackSpeedMultiplier = 1/X). */
export const CUBE_ENEMY_SLOW_FACTOR = 0.5; // 2x slower
/** Cube beam: allies attack this many times faster. */
export const CUBE_ALLY_SPEED_BUFF_FACTOR = 3;
/** Max simultaneous beam targets per side (enemies / allies). */
export const CUBE_MAX_BEAM_TARGETS = 2;
/** Beam debuff/buff lasts until manually removed (match duration). */
export const CUBE_BEAM_EFFECT_DURATION_TICKS = HEAL_AURA_DURATION_TICKS;

export const CUBE_SLOW_TAG = 'State.Debuff.CubeSlow';
export const CUBE_SPEED_BUFF_TAG = 'State.Buff.CubeSpeed';

export const combatDefs = defineAbilitySystem({
  attributes: [
    defineAttribute({
      id: 'Health',
      default: FP.FromInt(100),
      min: FP.FromInt(0),
      max: FP.FromInt(MAX_UNIT_HEALTH), // tightest static upper bound across all unit types
      clamp: 'both',
    }),
    defineAttribute({
      id: 'MaxHealth',
      default: FP.FromInt(100),
      min: FP.FromInt(0),
      max: FP.FromInt(1000),
      clamp: 'none',
    }),
    defineAttribute({
      id: 'AttackSpeedMultiplier',
      default: FP.FromInt(1),
      min: FP.FromFloat(0.1),
      max: FP.FromFloat(5),
      clamp: 'both',
    }),
  ],
  effects: [
    defineEffect({
      id: 'Effect.AutoAttack.Cooldown',
      type: 'Duration',
      durationTicks: ATTACK_COOLDOWN_TICKS,
      modifiers: [],
      tagsGranted: ['Cooldown.Ability.AutoAttack'],
    }),
    defineEffect({
      id: 'Effect.Death',
      type: 'Instant',
      modifiers: [],
      tagsGranted: ['State.Death'],
      cues: ['Cue.Death'],
    }),
    defineEffect({
      id: 'Effect.Damage.Sphere',
      type: 'Instant',
      modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromFloat(-18) }],
      cues: ['Cue.Damage.Sphere'],
    }),
    defineEffect({
      id: 'Effect.Heal.Tick',
      type: 'Instant',
      modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromFloat(HEAL_PER_PULSE) }],
      cues: { onApplied: ['Cue.Heal.Cross'] },
    }),
    defineEffect({
      id: 'Effect.HealAura.Active',
      type: 'Duration',
      durationTicks: HEAL_AURA_DURATION_TICKS,
      modifiers: [],
      tagsGranted: ['State.HealAura.Active'],
    }),
    defineEffect({
      id: 'Effect.Cube.SlowDebuff',
      type: 'Duration',
      durationTicks: CUBE_BEAM_EFFECT_DURATION_TICKS,
      modifiers: [
        {
          attributeId: 'AttackSpeedMultiplier',
          op: 'Multiply',
          magnitude: FP.FromFloat(CUBE_ENEMY_SLOW_FACTOR),
        },
      ],
      tagsGranted: [CUBE_SLOW_TAG],
      cues: ['Cue.Beam.Red'],
    }),
    defineEffect({
      id: 'Effect.Cube.SpeedBuff',
      type: 'Duration',
      durationTicks: CUBE_BEAM_EFFECT_DURATION_TICKS,
      modifiers: [
        {
          attributeId: 'AttackSpeedMultiplier',
          op: 'Multiply',
          magnitude: FP.FromFloat(CUBE_ALLY_SPEED_BUFF_FACTOR),
        },
      ],
      tagsGranted: [CUBE_SPEED_BUFF_TAG],
      cues: ['Cue.Beam.Yellow'],
    }),
  ],
  abilities: [
    defineAbility({
      id: 'Ability.AutoAttack',
      target: { kind: 'Entity', origin: { kind: 'Caller' } },
      hookId: 'Hook.AutoAttack',
    }),
    defineAbility({
      id: 'Ability.HealAura',
      target: { kind: 'Self' },
      selfEffectIds: ['Effect.HealAura.Active'],
    }),
  ],
});
