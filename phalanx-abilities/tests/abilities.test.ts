import { describe, expect, it, vi } from 'vitest';
import { FP } from 'phalanx-math';
import { ABILITY_ACTIVATED_EVENT, defineAbility, defineEffect } from '../src';
import type { AbilityActivatedEvent } from '../src';
import {
  ArmorAttribute,
  HealthAttribute,
  IncomingDamageMultiplierAttribute,
  ManaAttribute,
  createTestWorld,
  spawnCombatEntity,
} from './helpers';

// ---------------------------------------------------------------------------
// Stage 5 — Abilities: cost / cooldown / CanActivate / hooks
//
// These tests cover the activation pipeline end-to-end. Each test sets up a
// minimal world via `createTestWorld`, drives one or more activations through
// the facade, and asserts the observable outcome (attribute deltas, tag
// state, hook invocation, event emission). Failure cases are deliberately
// silent — see `activateAbility` contract — so we verify rejection by
// asserting the side effects DID NOT happen.
// ---------------------------------------------------------------------------

describe('ability activation — happy paths', () => {
  it('queues cost + cooldown + selfEffectIds on the caster on the activation tick', () => {
    const { world, abilities, abilityIds } = createTestWorld({
      pipeline: 'activation',
      attributes: [HealthAttribute, ManaAttribute, ArmorAttribute, IncomingDamageMultiplierAttribute],
      effects: [
        defineEffect({
          id: 'Effect.SpendMana10',
          type: 'Instant',
          modifiers: [{ attributeId: 'Mana', op: 'Add', magnitude: FP.FromInt(-10) }],
        }),
        defineEffect({
          id: 'Effect.Fireball.Cooldown',
          type: 'Duration',
          durationTicks: 30,
          tagsGranted: ['Cooldown.Ability.Fireball'],
        }),
        defineEffect({
          id: 'Effect.Buff.Cast',
          type: 'Duration',
          durationTicks: 60,
          modifiers: [{ attributeId: 'Armor', op: 'Add', magnitude: FP.FromInt(5) }],
          tagsGranted: ['State.Buff.CastSpeed'],
        }),
      ],
      abilities: [
        defineAbility({
          id: 'Ability.Fireball',
          costEffectId: 'Effect.SpendMana10',
          cooldownEffectId: 'Effect.Fireball.Cooldown',
          selfEffectIds: ['Effect.Buff.Cast'],
          target: { kind: 'Self' },
        }),
      ],
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    world.processAllTicks(1);
    expect(FP.ToFloat(abilities.getAttribute(caster.id, 'Mana').current)).toBe(50);

    abilities.activateAbility(caster.id, 'Ability.Fireball');

    // Tick 2: activation drains, cost+cooldown+self enqueued, EffectApplication
    // applies them on the same tick because of system order.
    world.processAllTicks(2);
    expect(FP.ToFloat(abilities.getAttribute(caster.id, 'Mana').current)).toBe(40);
    expect(abilities.hasTag(caster.id, 'Cooldown.Ability.Fireball')).toBe(true);
    expect(abilities.hasTag(caster.id, 'State.Buff.CastSpeed')).toBe(true);
    // Self-effect's Armor buff folded through aggregation.
    expect(FP.ToFloat(abilities.getAttribute(caster.id, 'Armor').current)).toBe(55);

    world.dispose();
  });

  it('emits AbilityActivated on the world event bus when activation succeeds', () => {
    const { world, abilities, abilityIds } = createTestWorld({
      pipeline: 'activation',
      attributes: [HealthAttribute, ManaAttribute, ArmorAttribute, IncomingDamageMultiplierAttribute],
      effects: [
        defineEffect({
          id: 'Effect.Mark',
          type: 'Duration',
          durationTicks: 60,
          modifiers: [
            { attributeId: 'IncomingDamageMultiplier', op: 'Multiply', magnitude: FP.FromFloat(1.25) },
          ],
          tagsGranted: ['State.Marked'],
        }),
      ],
      abilities: [
        defineAbility({
          id: 'Ability.MarkBeam',
          target: { kind: 'Entity', origin: { kind: 'Caller' } },
          targetEffectIds: ['Effect.Mark'],
        }),
      ],
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    const enemy = spawnCombatEntity(world, abilities, abilityIds);
    world.processAllTicks(1);

    const seen: AbilityActivatedEvent[] = [];
    world.eventBus.on<AbilityActivatedEvent>(ABILITY_ACTIVATED_EVENT, e => {
      seen.push(e);
    });

    abilities.activateAbility(caster.id, 'Ability.MarkBeam', { entityId: enemy.id });
    world.processAllTicks(2);

    expect(seen).toHaveLength(1);
    expect(seen[0].abilityId).toBe('Ability.MarkBeam');
    expect(seen[0].casterEntityId).toBe(caster.id);
    expect(seen[0].resolvedTargets).toEqual([enemy.id]);
    expect(seen[0].providedTarget?.entityId).toBe(enemy.id);
    expect(seen[0].tick).toBe(2);

    // targetEffects were enqueued onto the enemy in the same tick and applied
    // by EffectApplicationSystem.
    expect(abilities.hasTag(enemy.id, 'State.Marked')).toBe(true);

    world.dispose();
  });

  it('applies targetEffectIds to the entity returned by TargetSpec resolution', () => {
    const { world, abilities, abilityIds } = createTestWorld({
      pipeline: 'activation',
      attributes: [HealthAttribute, ManaAttribute, ArmorAttribute, IncomingDamageMultiplierAttribute],
      effects: [
        defineEffect({
          id: 'Effect.ArmorShred',
          type: 'Duration',
          durationTicks: 10,
          modifiers: [{ attributeId: 'Armor', op: 'Add', magnitude: FP.FromInt(-20) }],
          tagsGranted: ['State.Debuff.ArmorShred'],
        }),
      ],
      abilities: [
        defineAbility({
          id: 'Ability.ShredBeam',
          target: { kind: 'Entity', origin: { kind: 'Caller' } },
          targetEffectIds: ['Effect.ArmorShred'],
        }),
      ],
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    const enemy = spawnCombatEntity(world, abilities, abilityIds);
    world.processAllTicks(1);
    expect(FP.ToFloat(abilities.getAttribute(enemy.id, 'Armor').current)).toBe(50);

    abilities.activateAbility(caster.id, 'Ability.ShredBeam', { entityId: enemy.id });
    world.processAllTicks(2);

    expect(FP.ToFloat(abilities.getAttribute(enemy.id, 'Armor').current)).toBe(30);
    // Caster is unaffected by a pure-target-effect ability.
    expect(FP.ToFloat(abilities.getAttribute(caster.id, 'Armor').current)).toBe(50);

    world.dispose();
  });

  it('resolves Self targeting to the caster and applies targetEffectIds to self', () => {
    const { world, abilities, abilityIds } = createTestWorld({
      pipeline: 'activation',
      attributes: [HealthAttribute, ManaAttribute, ArmorAttribute, IncomingDamageMultiplierAttribute],
      effects: [
        defineEffect({
          id: 'Effect.SelfHeal',
          type: 'Instant',
          modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(20) }],
        }),
        defineEffect({
          id: 'Effect.TestDamage40',
          type: 'Instant',
          modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-40) }],
        }),
      ],
      abilities: [
        defineAbility({
          id: 'Ability.SelfHeal',
          target: { kind: 'Self' },
          targetEffectIds: ['Effect.SelfHeal'],
        }),
      ],
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    world.processAllTicks(1);
    // Drop the caster's health so a heal is observable (clamp would mask it
    // otherwise — Health defaults to its max).
    abilities.applyEffect(caster.id, 'Effect.TestDamage40', caster.id);
    world.processAllTicks(2);
    expect(FP.ToFloat(abilities.getAttribute(caster.id, 'Health').current)).toBe(60);

    abilities.activateAbility(caster.id, 'Ability.SelfHeal');
    world.processAllTicks(3);
    expect(FP.ToFloat(abilities.getAttribute(caster.id, 'Health').current)).toBe(80);

    world.dispose();
  });
});

describe('ability activation — CanActivate gating', () => {
  it('blocks activation when caster has any activationBlockedTags', () => {
    const { world, abilities, abilityIds } = createTestWorld({
      pipeline: 'activation',
      attributes: [HealthAttribute, ManaAttribute, ArmorAttribute, IncomingDamageMultiplierAttribute],
      effects: [
        defineEffect({
          id: 'Effect.Fireball.Cooldown',
          type: 'Duration',
          durationTicks: 30,
          tagsGranted: ['Cooldown.Ability.Fireball'],
        }),
      ],
      abilities: [
        defineAbility({
          id: 'Ability.Fireball',
          cooldownEffectId: 'Effect.Fireball.Cooldown',
          activationBlockedTags: ['State.Stun'],
          target: { kind: 'Self' },
        }),
      ],
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    world.processAllTicks(1);
    abilities.addTag(caster.id, 'State.Stun');

    abilities.activateAbility(caster.id, 'Ability.Fireball');
    world.processAllTicks(2);

    // Cooldown tag must NOT be granted: activation was rejected, no cooldown
    // effect was enqueued.
    expect(abilities.hasTag(caster.id, 'Cooldown.Ability.Fireball')).toBe(false);

    world.dispose();
  });

  it('blocks activation when caster lacks any tagsRequired', () => {
    const { world, abilities, abilityIds } = createTestWorld({
      pipeline: 'activation',
      attributes: [HealthAttribute, ManaAttribute, ArmorAttribute, IncomingDamageMultiplierAttribute],
      effects: [
        defineEffect({
          id: 'Effect.Stance.Cooldown',
          type: 'Duration',
          durationTicks: 5,
          tagsGranted: ['Cooldown.Ability.Stance'],
        }),
      ],
      abilities: [
        defineAbility({
          id: 'Ability.WarriorStance',
          cooldownEffectId: 'Effect.Stance.Cooldown',
          tagsRequired: ['Class.Warrior'],
          target: { kind: 'Self' },
        }),
      ],
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    world.processAllTicks(1);

    // Missing required tag: activation rejected.
    abilities.activateAbility(caster.id, 'Ability.WarriorStance');
    world.processAllTicks(2);
    expect(abilities.hasTag(caster.id, 'Cooldown.Ability.Stance')).toBe(false);

    // Grant the tag and try again: activation now succeeds.
    abilities.addTag(caster.id, 'Class.Warrior');
    abilities.activateAbility(caster.id, 'Ability.WarriorStance');
    world.processAllTicks(3);
    expect(abilities.hasTag(caster.id, 'Cooldown.Ability.Stance')).toBe(true);

    world.dispose();
  });

  it('blocks activation while the cooldown tag is present, then allows after expiry', () => {
    const { world, abilities, abilityIds } = createTestWorld({
      pipeline: 'activation',
      attributes: [HealthAttribute, ManaAttribute, ArmorAttribute, IncomingDamageMultiplierAttribute],
      effects: [
        defineEffect({
          id: 'Effect.Snipe.Cooldown',
          type: 'Duration',
          durationTicks: 3,
          tagsGranted: ['Cooldown.Ability.Snipe'],
        }),
        defineEffect({
          id: 'Effect.Snipe.Damage',
          type: 'Instant',
          modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-10) }],
        }),
      ],
      abilities: [
        defineAbility({
          id: 'Ability.Snipe',
          cooldownEffectId: 'Effect.Snipe.Cooldown',
          activationBlockedTags: ['Cooldown.Ability.Snipe'],
          target: { kind: 'Entity', origin: { kind: 'Caller' } },
          targetEffectIds: ['Effect.Snipe.Damage'],
        }),
      ],
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    const enemy = spawnCombatEntity(world, abilities, abilityIds);
    world.processAllTicks(1);

    // First cast lands.
    abilities.activateAbility(caster.id, 'Ability.Snipe', { entityId: enemy.id });
    world.processAllTicks(2);
    expect(FP.ToFloat(abilities.getAttribute(enemy.id, 'Health').current)).toBe(90);
    expect(abilities.hasTag(caster.id, 'Cooldown.Ability.Snipe')).toBe(true);

    // Second cast on the next tick is blocked by the cooldown tag.
    abilities.activateAbility(caster.id, 'Ability.Snipe', { entityId: enemy.id });
    world.processAllTicks(3);
    expect(FP.ToFloat(abilities.getAttribute(enemy.id, 'Health').current)).toBe(90);

    // Cooldown expires (durationTicks=3 from tick 2): tick 5 sees the tag
    // gone. Cast again — lands.
    world.processAllTicks(4);
    world.processAllTicks(5);
    expect(abilities.hasTag(caster.id, 'Cooldown.Ability.Snipe')).toBe(false);

    abilities.activateAbility(caster.id, 'Ability.Snipe', { entityId: enemy.id });
    world.processAllTicks(6);
    expect(FP.ToFloat(abilities.getAttribute(enemy.id, 'Health').current)).toBe(80);

    world.dispose();
  });

  it('blocks a same-tick second activation via in-flight cooldown bookkeeping', () => {
    const { world, abilities, abilityIds } = createTestWorld({
      pipeline: 'activation',
      attributes: [HealthAttribute, ManaAttribute, ArmorAttribute, IncomingDamageMultiplierAttribute],
      effects: [
        defineEffect({
          id: 'Effect.Burst.Cooldown',
          type: 'Duration',
          durationTicks: 5,
          tagsGranted: ['Cooldown.Ability.Burst'],
        }),
        defineEffect({
          id: 'Effect.Burst.Damage',
          type: 'Instant',
          modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-10) }],
        }),
      ],
      abilities: [
        defineAbility({
          id: 'Ability.Burst',
          cooldownEffectId: 'Effect.Burst.Cooldown',
          activationBlockedTags: ['Cooldown.Ability.Burst'],
          target: { kind: 'Entity', origin: { kind: 'Caller' } },
          targetEffectIds: ['Effect.Burst.Damage'],
        }),
      ],
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    const enemy = spawnCombatEntity(world, abilities, abilityIds);
    world.processAllTicks(1);

    // Two activations queued on the same tick. Only the first should land
    // because the second sees the in-flight cooldown tag from the first.
    abilities.activateAbility(caster.id, 'Ability.Burst', { entityId: enemy.id });
    abilities.activateAbility(caster.id, 'Ability.Burst', { entityId: enemy.id });
    world.processAllTicks(2);

    expect(FP.ToFloat(abilities.getAttribute(enemy.id, 'Health').current)).toBe(90);
    expect(abilities.hasTag(caster.id, 'Cooldown.Ability.Burst')).toBe(true);

    world.dispose();
  });

  it('rejects activation when cost cannot be afforded', () => {
    const { world, abilities, abilityIds } = createTestWorld({
      pipeline: 'activation',
      attributes: [HealthAttribute, ManaAttribute, ArmorAttribute, IncomingDamageMultiplierAttribute],
      effects: [
        defineEffect({
          id: 'Effect.SpendMana60',
          type: 'Instant',
          modifiers: [{ attributeId: 'Mana', op: 'Add', magnitude: FP.FromInt(-60) }],
        }),
        defineEffect({
          id: 'Effect.Heavy.Cooldown',
          type: 'Duration',
          durationTicks: 30,
          tagsGranted: ['Cooldown.Ability.Heavy'],
        }),
      ],
      abilities: [
        defineAbility({
          id: 'Ability.Heavy',
          costEffectId: 'Effect.SpendMana60',
          cooldownEffectId: 'Effect.Heavy.Cooldown',
          target: { kind: 'Self' },
        }),
      ],
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    world.processAllTicks(1);
    // Default Mana is 50 — cannot afford 60.
    expect(FP.ToFloat(abilities.getAttribute(caster.id, 'Mana').current)).toBe(50);

    abilities.activateAbility(caster.id, 'Ability.Heavy');
    world.processAllTicks(2);

    expect(FP.ToFloat(abilities.getAttribute(caster.id, 'Mana').current)).toBe(50);
    expect(abilities.hasTag(caster.id, 'Cooldown.Ability.Heavy')).toBe(false);

    world.dispose();
  });

  it('rejects a same-tick second activation when its cost would overdraw the caster', () => {
    const { world, abilities, abilityIds } = createTestWorld({
      pipeline: 'activation',
      attributes: [HealthAttribute, ManaAttribute, ArmorAttribute, IncomingDamageMultiplierAttribute],
      effects: [
        defineEffect({
          id: 'Effect.SpendMana30',
          type: 'Instant',
          modifiers: [{ attributeId: 'Mana', op: 'Add', magnitude: FP.FromInt(-30) }],
        }),
      ],
      abilities: [
        defineAbility({
          id: 'Ability.SpendMana',
          costEffectId: 'Effect.SpendMana30',
          target: { kind: 'Self' },
        }),
      ],
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    world.processAllTicks(1);
    // Default Mana 50: one cast (30) is fine, two casts (60) is not.

    abilities.activateAbility(caster.id, 'Ability.SpendMana');
    abilities.activateAbility(caster.id, 'Ability.SpendMana');
    world.processAllTicks(2);

    expect(FP.ToFloat(abilities.getAttribute(caster.id, 'Mana').current)).toBe(20);

    world.dispose();
  });
});

describe('ability activation — hooks', () => {
  it('invokes registered hooks after the application pass with the resolved targets', () => {
    const calls: Array<{
      abilityId: string;
      casterEntityId: number;
      targets: readonly number[];
      tick: number;
      casterHasCooldown: boolean;
    }> = [];
    const { world, abilities, abilityIds } = createTestWorld({
      pipeline: 'activation',
      attributes: [HealthAttribute, ManaAttribute, ArmorAttribute, IncomingDamageMultiplierAttribute],
      effects: [
        defineEffect({
          id: 'Effect.AutoAttack.Cooldown',
          type: 'Duration',
          durationTicks: 30,
          tagsGranted: ['Cooldown.Ability.AutoAttack'],
        }),
      ],
      abilities: [
        defineAbility({
          id: 'Ability.AutoAttack',
          cooldownEffectId: 'Effect.AutoAttack.Cooldown',
          activationBlockedTags: ['Cooldown.Ability.AutoAttack'],
          target: { kind: 'Entity', origin: { kind: 'Caller' } },
          hookId: 'Hook.SpawnProjectile',
        }),
      ],
      hooks: {
        'Hook.SpawnProjectile': (ctx) => {
          calls.push({
            abilityId: ctx.abilityId,
            casterEntityId: ctx.casterEntityId,
            targets: [...ctx.resolvedTargets],
            tick: ctx.tick,
            casterHasCooldown: abilities.hasTag(
              ctx.casterEntityId,
              'Cooldown.Ability.AutoAttack'
            ),
          });
        },
      },
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    const enemy = spawnCombatEntity(world, abilities, abilityIds);
    world.processAllTicks(1);

    abilities.activateAbility(caster.id, 'Ability.AutoAttack', { entityId: enemy.id });
    world.processAllTicks(2);

    expect(calls).toHaveLength(1);
    expect(calls[0].abilityId).toBe('Ability.AutoAttack');
    expect(calls[0].casterEntityId).toBe(caster.id);
    expect(calls[0].targets).toEqual([enemy.id]);
    expect(calls[0].tick).toBe(2);
    expect(calls[0].casterHasCooldown).toBe(true);

    world.dispose();
  });

  it('does not invoke any hook when CanActivate rejects the request', () => {
    let invoked = 0;
    const { world, abilities, abilityIds } = createTestWorld({
      pipeline: 'activation',
      attributes: [HealthAttribute, ManaAttribute, ArmorAttribute, IncomingDamageMultiplierAttribute],
      effects: [
        defineEffect({
          id: 'Effect.AutoAttack.Cooldown',
          type: 'Duration',
          durationTicks: 30,
          tagsGranted: ['Cooldown.Ability.AutoAttack'],
        }),
      ],
      abilities: [
        defineAbility({
          id: 'Ability.AutoAttack',
          cooldownEffectId: 'Effect.AutoAttack.Cooldown',
          activationBlockedTags: ['State.Stun'],
          target: { kind: 'Self' },
          hookId: 'Hook.SpawnProjectile',
        }),
      ],
      hooks: {
        'Hook.SpawnProjectile': () => {
          invoked += 1;
        },
      },
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    world.processAllTicks(1);
    abilities.addTag(caster.id, 'State.Stun');

    abilities.activateAbility(caster.id, 'Ability.AutoAttack');
    world.processAllTicks(2);

    expect(invoked).toBe(0);

    world.dispose();
  });

  it('throws when an ability references a hookId that was never registered', () => {
    const { world, abilities, abilityIds } = createTestWorld({
      pipeline: 'activation',
      attributes: [HealthAttribute, ManaAttribute, ArmorAttribute, IncomingDamageMultiplierAttribute],
      effects: [],
      abilities: [
        defineAbility({
          id: 'Ability.Ghost',
          target: { kind: 'Self' },
          hookId: 'Hook.DoesNotExist',
        }),
      ],
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    world.processAllTicks(1);

    abilities.activateAbility(caster.id, 'Ability.Ghost');
    expect(() => world.processAllTicks(2)).toThrow(
      "AbilityHooksRegistry does not contain 'Hook.DoesNotExist'"
    );

    world.dispose();
  });
});

describe('ability activation — request lifecycle', () => {
  it('returns false from activateAbility when caster or ability is unknown', () => {
    const { world, abilities, abilityIds } = createTestWorld({
      pipeline: 'activation',
      attributes: [HealthAttribute, ManaAttribute, ArmorAttribute, IncomingDamageMultiplierAttribute],
      effects: [],
      abilities: [
        defineAbility({
          id: 'Ability.Ghost',
          target: { kind: 'Self' },
        }),
      ],
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);

    expect(abilities.activateAbility(999, 'Ability.Ghost')).toBe(false);
    expect(abilities.activateAbility(caster.id, 'Ability.DoesNotExist')).toBe(false);
    expect(abilities.activateAbility(caster.id, 'Ability.Ghost')).toBe(true);

    world.dispose();
  });

  it('defers activation requests enqueued INSIDE the tick to the next tick', () => {
    let hookInvocations = 0;
    const { world, abilities, abilityIds } = createTestWorld({
      pipeline: 'activation',
      attributes: [HealthAttribute, ManaAttribute, ArmorAttribute, IncomingDamageMultiplierAttribute],
      effects: [
        defineEffect({
          id: 'Effect.Reentrant.Cooldown',
          type: 'Duration',
          durationTicks: 5,
          tagsGranted: ['Cooldown.Ability.Reentrant'],
        }),
      ],
      abilities: [
        defineAbility({
          id: 'Ability.Reentrant',
          cooldownEffectId: 'Effect.Reentrant.Cooldown',
          activationBlockedTags: ['Cooldown.Ability.Reentrant'],
          target: { kind: 'Self' },
          hookId: 'Hook.Reentrant',
        }),
      ],
      hooks: {
        'Hook.Reentrant': (ctx) => {
          hookInvocations += 1;
          if (hookInvocations === 1) {
            abilities.activateAbility(ctx.casterEntityId, 'Ability.Reentrant');
          }
        },
      },
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    world.processAllTicks(1);

    abilities.activateAbility(caster.id, 'Ability.Reentrant');

    world.processAllTicks(2);
    expect(hookInvocations).toBe(1);

    // Tick 3 drains the reentrant request. But the cooldown tag from the
    // FIRST activation is still on the caster (durationTicks=5), so this
    // request is rejected: hook is not invoked again.
    world.processAllTicks(3);
    expect(hookInvocations).toBe(1);

    world.dispose();
  });

  it('skips a request whose caster has despawned between enqueue and drain', () => {
    let invoked = 0;
    const { world, abilities, abilityIds } = createTestWorld({
      pipeline: 'activation',
      attributes: [HealthAttribute, ManaAttribute, ArmorAttribute, IncomingDamageMultiplierAttribute],
      effects: [
        defineEffect({
          id: 'Effect.Boom',
          type: 'Instant',
          modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-10) }],
        }),
      ],
      abilities: [
        defineAbility({
          id: 'Ability.Boom',
          target: { kind: 'Self' },
          targetEffectIds: ['Effect.Boom'],
          hookId: 'Hook.Boom',
        }),
      ],
      hooks: {
        'Hook.Boom': () => {
          invoked += 1;
        },
      },
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    world.processAllTicks(1);

    abilities.activateAbility(caster.id, 'Ability.Boom');
    world.entityManager.removeEntity(caster);

    expect(() => world.processAllTicks(2)).not.toThrow();
    expect(invoked).toBe(0);

    world.dispose();
  });

  it('snapshots providedTarget so mutating the caller object after enqueue does not change the request', () => {
    const { world, abilities, abilityIds } = createTestWorld({
      pipeline: 'activation',
      attributes: [HealthAttribute, ManaAttribute, ArmorAttribute, IncomingDamageMultiplierAttribute],
      effects: [
        defineEffect({
          id: 'Effect.Mark',
          type: 'Instant',
          modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-7) }],
        }),
      ],
      abilities: [
        defineAbility({
          id: 'Ability.MarkTarget',
          target: { kind: 'Entity', origin: { kind: 'Caller' } },
          targetEffectIds: ['Effect.Mark'],
        }),
      ],
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    const intendedTarget = spawnCombatEntity(world, abilities, abilityIds);
    const bystander = spawnCombatEntity(world, abilities, abilityIds);
    world.processAllTicks(1);

    const providedTarget = { entityId: intendedTarget.id };
    abilities.activateAbility(caster.id, 'Ability.MarkTarget', providedTarget);

    // Caller mutates the original object before the activation drains. The
    // snapshot in the queue must keep pointing at the intended target.
    providedTarget.entityId = bystander.id;

    world.processAllTicks(2);

    expect(FP.ToFloat(abilities.getAttribute(intendedTarget.id, 'Health').current)).toBe(93);
    expect(FP.ToFloat(abilities.getAttribute(bystander.id, 'Health').current)).toBe(100);

    world.dispose();
  });

  it('compacts the queue even when processOne throws, so processed requests are not replayed', () => {
    // Two abilities share a tick. The first has a misconfigured cooldown
    // effect (no `tagsGranted`) and will throw during processing. The
    // second is well-formed and should NOT be replayed on a later tick
    // after the throw is swallowed by the test — the drain must compact
    // away the throwing request so reprocessing cannot happen.
    const { world, abilities, abilityIds } = createTestWorld({
      pipeline: 'activation',
      attributes: [HealthAttribute, ManaAttribute, ArmorAttribute, IncomingDamageMultiplierAttribute],
      effects: [
        defineEffect({
          id: 'Effect.BadCooldown',
          // Duration with no tagsGranted — isOffCooldown will throw.
          type: 'Duration',
          durationTicks: 10,
        }),
        defineEffect({
          id: 'Effect.GoodCooldown',
          type: 'Duration',
          durationTicks: 10,
          tagsGranted: ['Cooldown.Ability.Good'],
        }),
      ],
      abilities: [
        defineAbility({
          id: 'Ability.Bad',
          cooldownEffectId: 'Effect.BadCooldown',
          target: { kind: 'Self' },
        }),
        defineAbility({
          id: 'Ability.Good',
          cooldownEffectId: 'Effect.GoodCooldown',
          target: { kind: 'Self' },
        }),
      ],
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    world.processAllTicks(1);

    abilities.activateAbility(caster.id, 'Ability.Bad');
    abilities.activateAbility(caster.id, 'Ability.Good');
    expect(abilities.pendingActivationCount).toBe(2);

    // Tick 2 drains. The bad request throws — the good request that was
    // queued AFTER it has not been processed yet and must be preserved
    // for next tick. The bad request must be discarded.
    expect(() => world.processAllTicks(2)).toThrow();
    expect(abilities.pendingActivationCount).toBe(1);
    expect(abilities.pendingActivationAbilityId(0)).toBe('Ability.Good');
    // Bad cooldown tag must not be present (effect was never applied).
    expect(abilities.hasTag(caster.id, 'Cooldown.Ability.Good')).toBe(false);

    // Tick 3: the surviving good request drains cleanly.
    world.processAllTicks(3);
    expect(abilities.pendingActivationCount).toBe(0);
    expect(abilities.hasTag(caster.id, 'Cooldown.Ability.Good')).toBe(true);

    world.dispose();
  });
});

