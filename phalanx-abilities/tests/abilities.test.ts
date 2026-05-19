import { describe, expect, it } from 'vitest';
import { Entity, GameWorld } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import {
  ABILITY_ACTIVATED_EVENT,
  AbilitiesComponentType,
  AbilityActivationSystem,
  AbilityHookExecutorSystem,
  AbilitySystemFacade,
  AttributeAggregationSystem,
  EffectApplicationSystem,
  EffectTickSystem,
  createAbilitySystemRegistries,
  createAbilitySystemRuntime,
  defineAbility,
  defineAttribute,
  defineEffect,
} from '../src';
import type { AbilityActivatedEvent, AbilitySystemRegistries, AbilitySystemRuntime } from '../src';

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
    const { world, facade } = createTestWorld({
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
    const caster = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    world.processAllTicks(1);
    expect(FP.ToFloat(facade.getAttribute(caster.id, 'Mana').current)).toBe(50);

    facade.activateAbility(caster.id, 'Ability.Fireball');

    // Tick 2: activation drains, cost+cooldown+self enqueued, EffectApplication
    // applies them on the same tick because of system order.
    world.processAllTicks(2);
    expect(FP.ToFloat(facade.getAttribute(caster.id, 'Mana').current)).toBe(40);
    expect(facade.hasTag(caster.id, 'Cooldown.Ability.Fireball')).toBe(true);
    expect(facade.hasTag(caster.id, 'State.Buff.CastSpeed')).toBe(true);
    // Self-effect's Armor buff folded through aggregation.
    expect(FP.ToFloat(facade.getAttribute(caster.id, 'Armor').current)).toBe(55);

    world.dispose();
  });

  it('emits AbilityActivated on the world event bus when activation succeeds', () => {
    const { world, facade } = createTestWorld({
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
    const caster = addEntity(world);
    const enemy = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    facade.initAttributesForEntity(enemy.id);
    world.processAllTicks(1);

    const seen: AbilityActivatedEvent[] = [];
    world.eventBus.on<AbilityActivatedEvent>(ABILITY_ACTIVATED_EVENT, e => {
      seen.push(e);
    });

    facade.activateAbility(caster.id, 'Ability.MarkBeam', { entityId: enemy.id });
    world.processAllTicks(2);

    expect(seen).toHaveLength(1);
    expect(seen[0].abilityId).toBe('Ability.MarkBeam');
    expect(seen[0].casterEntityId).toBe(caster.id);
    expect(seen[0].resolvedTargets).toEqual([enemy.id]);
    expect(seen[0].providedTarget?.entityId).toBe(enemy.id);
    expect(seen[0].tick).toBe(2);

    // targetEffects were enqueued onto the enemy in the same tick and applied
    // by EffectApplicationSystem.
    expect(facade.hasTag(enemy.id, 'State.Marked')).toBe(true);

    world.dispose();
  });

  it('applies targetEffectIds to the entity returned by TargetSpec resolution', () => {
    const { world, facade } = createTestWorld({
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
    const caster = addEntity(world);
    const enemy = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    facade.initAttributesForEntity(enemy.id);
    world.processAllTicks(1);
    expect(FP.ToFloat(facade.getAttribute(enemy.id, 'Armor').current)).toBe(50);

    facade.activateAbility(caster.id, 'Ability.ShredBeam', { entityId: enemy.id });
    world.processAllTicks(2);

    expect(FP.ToFloat(facade.getAttribute(enemy.id, 'Armor').current)).toBe(30);
    // Caster is unaffected by a pure-target-effect ability.
    expect(FP.ToFloat(facade.getAttribute(caster.id, 'Armor').current)).toBe(50);

    world.dispose();
  });

  it('resolves Self targeting to the caster and applies targetEffectIds to self', () => {
    const { world, facade } = createTestWorld({
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
    const caster = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    world.processAllTicks(1);
    // Drop the caster's health so a heal is observable (clamp would mask it
    // otherwise — Health defaults to its max).
    facade.applyEffect(caster.id, 'Effect.TestDamage40', caster.id);
    world.processAllTicks(2);
    expect(FP.ToFloat(facade.getAttribute(caster.id, 'Health').current)).toBe(60);

    facade.activateAbility(caster.id, 'Ability.SelfHeal');
    world.processAllTicks(3);
    expect(FP.ToFloat(facade.getAttribute(caster.id, 'Health').current)).toBe(80);

    world.dispose();
  });
});

describe('ability activation — CanActivate gating', () => {
  it('blocks activation when caster has any activationBlockedTags', () => {
    const { world, facade } = createTestWorld({
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
    const caster = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    world.processAllTicks(1);
    facade.addTag(caster.id, 'State.Stun');

    facade.activateAbility(caster.id, 'Ability.Fireball');
    world.processAllTicks(2);

    // Cooldown tag must NOT be granted: activation was rejected, no cooldown
    // effect was enqueued.
    expect(facade.hasTag(caster.id, 'Cooldown.Ability.Fireball')).toBe(false);

    world.dispose();
  });

  it('blocks activation when caster lacks any tagsRequired', () => {
    const { world, facade } = createTestWorld({
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
    const caster = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    world.processAllTicks(1);

    // Missing required tag: activation rejected.
    facade.activateAbility(caster.id, 'Ability.WarriorStance');
    world.processAllTicks(2);
    expect(facade.hasTag(caster.id, 'Cooldown.Ability.Stance')).toBe(false);

    // Grant the tag and try again: activation now succeeds.
    facade.addTag(caster.id, 'Class.Warrior');
    facade.activateAbility(caster.id, 'Ability.WarriorStance');
    world.processAllTicks(3);
    expect(facade.hasTag(caster.id, 'Cooldown.Ability.Stance')).toBe(true);

    world.dispose();
  });

  it('blocks activation while the cooldown tag is present, then allows after expiry', () => {
    const { world, facade } = createTestWorld({
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
    const caster = addEntity(world);
    const enemy = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    facade.initAttributesForEntity(enemy.id);
    world.processAllTicks(1);

    // First cast lands.
    facade.activateAbility(caster.id, 'Ability.Snipe', { entityId: enemy.id });
    world.processAllTicks(2);
    expect(FP.ToFloat(facade.getAttribute(enemy.id, 'Health').current)).toBe(90);
    expect(facade.hasTag(caster.id, 'Cooldown.Ability.Snipe')).toBe(true);

    // Second cast on the next tick is blocked by the cooldown tag.
    facade.activateAbility(caster.id, 'Ability.Snipe', { entityId: enemy.id });
    world.processAllTicks(3);
    expect(FP.ToFloat(facade.getAttribute(enemy.id, 'Health').current)).toBe(90);

    // Cooldown expires (durationTicks=3 from tick 2): tick 5 sees the tag
    // gone. Cast again — lands.
    world.processAllTicks(4);
    world.processAllTicks(5);
    expect(facade.hasTag(caster.id, 'Cooldown.Ability.Snipe')).toBe(false);

    facade.activateAbility(caster.id, 'Ability.Snipe', { entityId: enemy.id });
    world.processAllTicks(6);
    expect(FP.ToFloat(facade.getAttribute(enemy.id, 'Health').current)).toBe(80);

    world.dispose();
  });

  it('blocks a same-tick second activation via in-flight cooldown bookkeeping', () => {
    const { world, facade } = createTestWorld({
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
    const caster = addEntity(world);
    const enemy = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    facade.initAttributesForEntity(enemy.id);
    world.processAllTicks(1);

    // Two activations queued on the same tick. Only the first should land
    // because the second sees the in-flight cooldown tag from the first.
    facade.activateAbility(caster.id, 'Ability.Burst', { entityId: enemy.id });
    facade.activateAbility(caster.id, 'Ability.Burst', { entityId: enemy.id });
    world.processAllTicks(2);

    expect(FP.ToFloat(facade.getAttribute(enemy.id, 'Health').current)).toBe(90);
    expect(facade.hasTag(caster.id, 'Cooldown.Ability.Burst')).toBe(true);

    world.dispose();
  });

  it('rejects activation when cost cannot be afforded', () => {
    const { world, facade } = createTestWorld({
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
    const caster = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    world.processAllTicks(1);
    // Default Mana is 50 — cannot afford 60.
    expect(FP.ToFloat(facade.getAttribute(caster.id, 'Mana').current)).toBe(50);

    facade.activateAbility(caster.id, 'Ability.Heavy');
    world.processAllTicks(2);

    expect(FP.ToFloat(facade.getAttribute(caster.id, 'Mana').current)).toBe(50);
    expect(facade.hasTag(caster.id, 'Cooldown.Ability.Heavy')).toBe(false);

    world.dispose();
  });

  it('rejects a same-tick second activation when its cost would overdraw the caster', () => {
    const { world, facade } = createTestWorld({
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
    const caster = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    world.processAllTicks(1);
    // Default Mana 50: one cast (30) is fine, two casts (60) is not.

    facade.activateAbility(caster.id, 'Ability.SpendMana');
    facade.activateAbility(caster.id, 'Ability.SpendMana');
    world.processAllTicks(2);

    expect(FP.ToFloat(facade.getAttribute(caster.id, 'Mana').current)).toBe(20);

    world.dispose();
  });
});

describe('ability activation — hooks', () => {
  it('invokes registered hooks after the application pass with the resolved targets', () => {
    const { world, facade } = createTestWorld({
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
    });
    const caster = addEntity(world);
    const enemy = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    facade.initAttributesForEntity(enemy.id);
    world.processAllTicks(1);

    const calls: Array<{
      abilityId: string;
      casterEntityId: number;
      targets: readonly number[];
      tick: number;
      casterHasCooldown: boolean;
    }> = [];
    facade.registerHook('Hook.SpawnProjectile', ctx => {
      calls.push({
        abilityId: ctx.abilityId,
        casterEntityId: ctx.casterEntityId,
        targets: [...ctx.resolvedTargets],
        tick: ctx.tick,
        // Inside the hook, the cooldown effect must have already been
        // applied — system order guarantees this.
        casterHasCooldown: facade.hasTag(ctx.casterEntityId, 'Cooldown.Ability.AutoAttack'),
      });
    });

    facade.activateAbility(caster.id, 'Ability.AutoAttack', { entityId: enemy.id });
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
    const { world, facade } = createTestWorld({
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
    });
    const caster = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    world.processAllTicks(1);
    facade.addTag(caster.id, 'State.Stun');

    let invoked = 0;
    facade.registerHook('Hook.SpawnProjectile', () => {
      invoked += 1;
    });

    facade.activateAbility(caster.id, 'Ability.AutoAttack');
    world.processAllTicks(2);

    expect(invoked).toBe(0);

    world.dispose();
  });

  it('throws when an ability references a hookId that was never registered', () => {
    const { world, facade } = createTestWorld({
      effects: [],
      abilities: [
        defineAbility({
          id: 'Ability.Ghost',
          target: { kind: 'Self' },
          hookId: 'Hook.DoesNotExist',
        }),
      ],
    });
    const caster = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    world.processAllTicks(1);

    facade.activateAbility(caster.id, 'Ability.Ghost');
    expect(() => world.processAllTicks(2)).toThrow(
      "AbilityHooksRegistry does not contain 'Hook.DoesNotExist'"
    );

    world.dispose();
  });
});

describe('ability activation — request lifecycle', () => {
  it('returns false from activateAbility when caster or ability is unknown', () => {
    const { world, facade } = createTestWorld({
      effects: [],
      abilities: [
        defineAbility({
          id: 'Ability.Ghost',
          target: { kind: 'Self' },
        }),
      ],
    });
    const caster = addEntity(world);

    expect(facade.activateAbility(999, 'Ability.Ghost')).toBe(false);
    expect(facade.activateAbility(caster.id, 'Ability.DoesNotExist')).toBe(false);
    expect(facade.activateAbility(caster.id, 'Ability.Ghost')).toBe(true);

    world.dispose();
  });

  it('defers activation requests enqueued INSIDE the tick to the next tick', () => {
    const { world, facade } = createTestWorld({
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
    });
    const caster = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    world.processAllTicks(1);

    // The hook fires inside tick 2 and enqueues a new activation request
    // with enqueueTick === 2. The activation system must defer it to tick 3
    // — otherwise we'd risk an infinite loop where the hook drives the same
    // tick repeatedly.
    let hookInvocations = 0;
    facade.registerHook('Hook.Reentrant', ctx => {
      hookInvocations += 1;
      if (hookInvocations === 1) {
        facade.activateAbility(ctx.casterEntityId, 'Ability.Reentrant');
      }
    });

    facade.activateAbility(caster.id, 'Ability.Reentrant');

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
    const { world, facade } = createTestWorld({
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
    });
    const caster = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    world.processAllTicks(1);

    let invoked = 0;
    facade.registerHook('Hook.Boom', () => {
      invoked += 1;
    });

    facade.activateAbility(caster.id, 'Ability.Boom');
    world.entityManager.removeEntity(caster);

    expect(() => world.processAllTicks(2)).not.toThrow();
    expect(invoked).toBe(0);

    world.dispose();
  });

  it('snapshots providedTarget so mutating the caller object after enqueue does not change the request', () => {
    const { world, facade } = createTestWorld({
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
    const caster = addEntity(world);
    const intendedTarget = addEntity(world);
    const bystander = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    facade.initAttributesForEntity(intendedTarget.id);
    facade.initAttributesForEntity(bystander.id);
    world.processAllTicks(1);

    const providedTarget = { entityId: intendedTarget.id };
    facade.activateAbility(caster.id, 'Ability.MarkTarget', providedTarget);

    // Caller mutates the original object before the activation drains. The
    // snapshot in the queue must keep pointing at the intended target.
    providedTarget.entityId = bystander.id;

    world.processAllTicks(2);

    expect(FP.ToFloat(facade.getAttribute(intendedTarget.id, 'Health').current)).toBe(93);
    expect(FP.ToFloat(facade.getAttribute(bystander.id, 'Health').current)).toBe(100);

    world.dispose();
  });

  it('compacts the queue even when processOne throws, so processed requests are not replayed', () => {
    // Two abilities share a tick. The first has a misconfigured cooldown
    // effect (no `tagsGranted`) and will throw during processing. The
    // second is well-formed and should NOT be replayed on a later tick
    // after the throw is swallowed by the test — the drain must compact
    // away the throwing request so reprocessing cannot happen.
    const { world, facade, runtime } = createTestWorld({
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
    const caster = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    world.processAllTicks(1);

    facade.activateAbility(caster.id, 'Ability.Bad');
    facade.activateAbility(caster.id, 'Ability.Good');
    expect(runtime.activationRequests.length).toBe(2);

    // Tick 2 drains. The bad request throws — the good request that was
    // queued AFTER it has not been processed yet and must be preserved
    // for next tick. The bad request must be discarded.
    expect(() => world.processAllTicks(2)).toThrow();
    expect(runtime.activationRequests.length).toBe(1);
    expect(runtime.activationRequests[0].abilityId).toBe('Ability.Good');
    // Bad cooldown tag must not be present (effect was never applied).
    expect(facade.hasTag(caster.id, 'Cooldown.Ability.Good')).toBe(false);

    // Tick 3: the surviving good request drains cleanly.
    world.processAllTicks(3);
    expect(runtime.activationRequests.length).toBe(0);
    expect(facade.hasTag(caster.id, 'Cooldown.Ability.Good')).toBe(true);

    world.dispose();
  });
});

// ---------------------------------------------------------------------------
// Test world helper
// ---------------------------------------------------------------------------

interface TestWorldOpts {
  effects: readonly ReturnType<typeof defineEffect>[];
  abilities: readonly ReturnType<typeof defineAbility>[];
}

interface TestWorld {
  world: GameWorld;
  facade: AbilitySystemFacade;
  registries: AbilitySystemRegistries;
  runtime: AbilitySystemRuntime;
}

function createTestWorld(opts: TestWorldOpts): TestWorld {
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
      id: 'Mana',
      default: FP.FromInt(50),
      min: FP.FromInt(0),
      max: FP.FromInt(50),
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
  registries.attributes.register(
    defineAttribute({
      id: 'IncomingDamageMultiplier',
      default: FP.FromInt(1),
      min: FP.FromInt(0),
      max: FP.FromInt(10),
      clamp: 'both',
    })
  );
  for (const effect of opts.effects) {
    registries.effects.register(effect);
  }
  for (const ability of opts.abilities) {
    registries.abilities.register(ability);
  }

  const runtime = createAbilitySystemRuntime();
  const world = new GameWorld({
    componentTypes: [
      AbilitiesComponentType.Attributes,
      AbilitiesComponentType.ActiveEffects,
      AbilitiesComponentType.GameplayTags,
    ],
  });
  // System order matches the design doc Stage 5:
  //  AbilityActivation -> EffectApplication -> AbilityHookExecutor ->
  //  EffectTick -> AttributeAggregation.
  // Activation enqueues effects on pendingAdd; EffectApplication drains
  // them; the hook fires after application sees the new state; tick
  // counts down lifetimes; aggregation resolves `current`.
  world.registerSystems(
    [
      new AbilityActivationSystem(registries, runtime),
      new EffectApplicationSystem(registries, runtime),
      new AbilityHookExecutorSystem(registries, runtime),
      new EffectTickSystem(registries, runtime),
      new AttributeAggregationSystem(registries),
    ],
    []
  );
  const facade = new AbilitySystemFacade(world.entityManager, registries, runtime);
  return { world, facade, registries, runtime };
}

function addEntity(world: GameWorld): Entity {
  const entity = new Entity();
  world.entityManager.addEntity(entity);
  return entity;
}

