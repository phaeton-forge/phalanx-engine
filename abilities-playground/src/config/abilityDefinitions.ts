import { FP } from '@phalanx-engine/math';
import {
  defineAbility,
  defineAbilitySystem,
  defineAttribute,
  defineEffect,
} from '@phalanx-engine/abilities';

/** Uniform move speed for all units (world units per second). */
export const UNIT_MOVE_SPEED = 13;

/**
 * Highest max-health value among all unit types in the roster (spheres: 100,
 * cube: 120, support: 70, volt: 200). Used as the static upper bound for the
 * Health attribute so the aggregation-system clamp acts as a second safety net
 * against overheal.
 */
export const MAX_UNIT_HEALTH = 200;

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
export const HEAL_PER_PULSE = SPHERE_ATTACK_DAMAGE * 0.5;
/** Healing aura radius (world units); allies inside are healed each pulse. */
export const HEAL_AURA_RADIUS = 18;
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

export const ROCKET_MAX_HEALTH = 100;
/** Missile impact damage per hit — three hits to destroy a sphere (100 HP). */
export const ROCKET_ATTACK_DAMAGE = 32;
export const ROCKET_COOLDOWN_TICKS = 50;
export const ROCKET_MAX_TARGETS = 2;
export const ROCKET_DETECTION_RANGE = 70;
export const ROCKET_STOP_RANGE = 60;

/** Volt attack cooldown in ticks (40 ticks = 2 s @ 20 TPS). */
export const VOLT_ATTACK_COOLDOWN_TICKS = 40;
/** Volt hostile detection radius (world units). */
export const VOLT_DETECTION_RANGE = 45;

/**
 * Number of times the random jump process repeats after the first target is hit.
 * Total targets struck = 1 (closest initial) + CHAIN_LIGHTNING_RANDOM_JUMPS.
 */
export const CHAIN_LIGHTNING_RANDOM_JUMPS = 3;

/** Total number of targets that can be hit by one cast. */
export const CHAIN_LIGHTNING_MAX_TARGETS = 1 + CHAIN_LIGHTNING_RANDOM_JUMPS;

/** Max distance between two chain links in fixed-point units. */
export const CHAIN_LIGHTNING_JUMP_RADIUS = FP.FromFloat(20);

/** Damage dealt on the first hit. */
export const CHAIN_LIGHTNING_BASE_DAMAGE = 40;

/** Damage multiplier applied per successive jump. */
export const CHAIN_LIGHTNING_DAMAGE_FALLOFF = FP.FromFloat(0.75);

/** How long each lightning bolt remains visible (seconds). */
export const CHAIN_LIGHTNING_LIFETIME_SECONDS = 0.9;

/** Ticks between successive chain-lightning jumps (4 ticks = 0.2 s @ 20 TPS). */
export const CHAIN_LIGHTNING_JUMP_DELAY_TICKS = 4;

/** Width of each lightning bolt in pixels. */
export const CHAIN_LIGHTNING_LINE_WIDTH = 3;

/** Tag applied while the unit is on cooldown. */
export const VOLT_COOLDOWN_TAG = 'Cooldown.Ability.VoltAttack';

/**
 * Tag granted to a rocket while its volley ability is on cooldown. The ability
 * is `Self`-targeted and fires a multi-target hook; the cooldown (and its tag)
 * are owned entirely by phalanx-abilities — no per-rocket timer component.
 */
export const MISSILE_VOLLEY_COOLDOWN_TAG = 'Cooldown.Ability.MissileVolley';

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
      modifiers: [
        { attributeId: 'Health', op: 'Add', magnitude: FP.FromFloat(-18) },
      ],
      cues: ['Cue.Damage.Sphere'],
    }),
    defineEffect({
      id: 'Effect.Damage.Missile',
      type: 'Instant',
      modifiers: [
        {
          attributeId: 'Health',
          op: 'Add',
          magnitude: FP.FromFloat(-ROCKET_ATTACK_DAMAGE),
        },
      ],
      cues: ['Cue.Missile.Impact'],
    }),
    defineEffect({
      id: 'Effect.MissileVolley.Cooldown',
      type: 'Duration',
      durationTicks: ROCKET_COOLDOWN_TICKS,
      modifiers: [],
      tagsGranted: [MISSILE_VOLLEY_COOLDOWN_TAG],
    }),
    defineEffect({
      id: 'Effect.Volt.Cooldown',
      type: 'Duration',
      durationTicks: VOLT_ATTACK_COOLDOWN_TICKS,
      modifiers: [],
      tagsGranted: [VOLT_COOLDOWN_TAG],
    }),
    defineEffect({
      id: 'Effect.Damage.Volt.Primary',
      type: 'Instant',
      modifiers: [
        {
          attributeId: 'Health',
          op: 'Add',
          magnitude: FP.FromFloat(-CHAIN_LIGHTNING_BASE_DAMAGE),
        },
      ],
      cues: ['Cue.ChainLightning.Primary'],
    }),
    defineEffect({
      id: 'Effect.Damage.Volt.Jump1',
      type: 'Instant',
      modifiers: [
        {
          attributeId: 'Health',
          op: 'Add',
          magnitude: FP.FromFloat(-CHAIN_LIGHTNING_BASE_DAMAGE * 0.75),
        },
      ],
      cues: ['Cue.ChainLightning.Jump'],
    }),
    defineEffect({
      id: 'Effect.Damage.Volt.Jump2',
      type: 'Instant',
      modifiers: [
        {
          attributeId: 'Health',
          op: 'Add',
          magnitude: FP.FromFloat(-CHAIN_LIGHTNING_BASE_DAMAGE * 0.75 * 0.75),
        },
      ],
      cues: ['Cue.ChainLightning.Jump'],
    }),
    defineEffect({
      id: 'Effect.Damage.Volt.Jump3',
      type: 'Instant',
      modifiers: [
        {
          attributeId: 'Health',
          op: 'Add',
          magnitude: FP.FromFloat(
            -CHAIN_LIGHTNING_BASE_DAMAGE * 0.75 * 0.75 * 0.75
          ),
        },
      ],
      cues: ['Cue.ChainLightning.Jump'],
    }),
    defineEffect({
      id: 'Effect.Heal.Tick',
      type: 'Instant',
      modifiers: [
        {
          attributeId: 'Health',
          op: 'Add',
          magnitude: FP.FromFloat(HEAL_PER_PULSE),
        },
      ],
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
    defineAbility({
      id: 'Ability.MissileVolley',
      target: { kind: 'Self' },
      hookId: 'Hook.MissileVolley',
      cooldownEffectId: 'Effect.MissileVolley.Cooldown',
      activationBlockedTags: [MISSILE_VOLLEY_COOLDOWN_TAG],
    }),
    defineAbility({
      id: 'Ability.Volt.ChainLightning',
      target: { kind: 'Self' },
      hookId: 'Hook.Volt.ChainLightning',
      cooldownEffectId: 'Effect.Volt.Cooldown',
      activationBlockedTags: [VOLT_COOLDOWN_TAG],
    }),
  ],
});
