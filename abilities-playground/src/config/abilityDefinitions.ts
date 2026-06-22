import { FP } from 'phalanx-math';
import { defineAbility, defineAbilitySystem, defineAttribute, defineEffect } from 'phalanx-abilities';

/** Uniform move speed for all units (world units per second). */
export const UNIT_MOVE_SPEED = 13;

/**
 * Highest max-health value among all unit types in the roster (spheres: 90,
 * support: 70). Used as the static upper bound for the Health attribute so the
 * aggregation-system clamp acts as a second safety net against overheal.
 */
export const MAX_UNIT_HEALTH = 90;

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
export const HEAL_PER_PULSE = SPHERE_ATTACK_DAMAGE * 0.6;
/** Healing aura radius (world units); allies inside are healed each pulse. */
export const HEAL_AURA_RADIUS = 16;
/**
 * Duration of the aura "active" marker effect. Effectively the whole match —
 * re-applying is unnecessary because a support unit auras for its entire life.
 */
export const HEAL_AURA_DURATION_TICKS = 36_000; // 30 min @ 20 TPS

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
      id: 'MoveSpeed',
      default: FP.FromInt(UNIT_MOVE_SPEED),
      min: FP.FromInt(0),
      max: FP.FromInt(50),
      clamp: 'min',
    }),
    defineAttribute({
      id: 'IncomingDamageMultiplier',
      default: FP.FromInt(1),
      min: FP.FromInt(0),
      max: FP.FromInt(10),
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
      id: 'Effect.Damage.SphereIlluminated',
      type: 'Instant',
      modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromFloat(-23.4) }],
    }),
    defineEffect({
      id: 'Effect.Illuminated',
      type: 'Duration',
      durationTicks: BEAM_EFFECT_DURATION_TICKS,
      modifiers: [{ attributeId: 'IncomingDamageMultiplier', op: 'Multiply', magnitude: FP.FromFloat(1.3) }],
      tagsGranted: ['State.Illuminated'],
    }),
    defineEffect({
      id: 'Effect.Jammed',
      type: 'Duration',
      durationTicks: BEAM_EFFECT_DURATION_TICKS,
      modifiers: [{ attributeId: 'MoveSpeed', op: 'Multiply', magnitude: FP.FromFloat(0.6) }],
      tagsGranted: ['State.Jammed'],
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
  ],
  abilities: [
    defineAbility({
      id: 'Ability.AutoAttack',
      cooldownEffectId: 'Effect.AutoAttack.Cooldown',
      activationBlockedTags: ['Cooldown.Ability.AutoAttack'],
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
