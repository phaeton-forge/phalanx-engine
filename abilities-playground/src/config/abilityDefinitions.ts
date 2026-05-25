import { FP } from 'phalanx-math';
import { defineAbility, defineAbilitySystem, defineAttribute, defineEffect } from 'phalanx-abilities';

/** Uniform move speed for all units (world units per second). */
export const UNIT_MOVE_SPEED = 13;

/** Attack cooldown: 40 ticks = 2 s at 20 TPS */
export const ATTACK_COOLDOWN_TICKS = 40;

/** Beam effect duration in ticks */
export const BEAM_EFFECT_DURATION_TICKS = 3;

/** Healing aura fires every N ticks (1 s at 20 TPS) */
export const HEAL_AURA_PERIOD_TICKS = 20;

/** Healing aura radius in world units */
export const HEAL_AURA_RADIUS = 20;

export const combatDefs = defineAbilitySystem({
  attributes: [
    defineAttribute({
      id: 'Health',
      default: FP.FromInt(100),
      min: FP.FromInt(0),
      max: FP.FromInt(500),
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
      id: 'Effect.Damage.Sphere',
      type: 'Instant',
      modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromFloat(-18) }],
    }),
    defineEffect({
      id: 'Effect.Damage.SphereIlluminated',
      type: 'Instant',
      modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromFloat(-23.4) }],
    }),
    defineEffect({
      id: 'Effect.HealAura.Tick',
      type: 'Instant',
      modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromFloat(5) }],
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
  ],
  abilities: [
    defineAbility({
      id: 'Ability.AutoAttack',
      cooldownEffectId: 'Effect.AutoAttack.Cooldown',
      activationBlockedTags: ['Cooldown.Ability.AutoAttack'],
      target: { kind: 'Entity', origin: { kind: 'Caller' } },
      hookId: 'Hook.AutoAttack',
    }),
  ],
});
