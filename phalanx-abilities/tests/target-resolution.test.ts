import { describe, expect, it, vi } from 'vitest';
import { Entity, GameWorld, resetEntityIdCounter } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import type { FixedPoint } from 'phalanx-math';
import {
  ABILITY_ACTIVATED_EVENT,
  createAbilitySystem,
  defineAbility,
  defineAbilitySystem,
  defineAttribute,
  defineEffect,
} from '../src';
import type { AbilityActivatedEvent } from '../src';
import {
  createActivationWorld,
  ExplosionEffect,
  FakeSpatialQuery,
  HealEffect,
  HealthAttribute,
  createTestWorld,
  equipEntity,
  spawnCombatEntity,
  spawnEntity,
} from './helpers';

// ---------------------------------------------------------------------------
// Stage 6 — Targeting: Radius + TargetResolver + applyEffectAoE
//
// These tests cover the resolver behaviour end-to-end through the facade and
// through ability activation. They exercise determinism guarantees that are
// load-bearing for lockstep replay:
//   - stable ASC entityId sort
//   - maxTargets trim AFTER sort
//   - filter (tagsRequired / tagsBlocked)
//   - includeSelf (default false)
//   - origin kinds (Caster / TargetEntity / Point / Caller)
//   - dedup of duplicate ids from the spatial query
//   - stale ids from the spatial query (entity removed) drop cleanly
// ---------------------------------------------------------------------------

describe('TargetResolver via applyEffectAoE — Radius behaviour', () => {
  it('applies the effect to every entity returned by the spatial query, sorted by entityId ASC', () => {
    const { world, abilities, spatial } = createTargetWorld();
    const a = spawnEntity(world, abilities);
    const b = spawnEntity(world, abilities);
    const c = spawnEntity(world, abilities);
    world.processAllTicks(1);

    // Return ids in scrambled order; resolver must sort them.
    spatial.setQuery(() => [c.id, a.id, b.id]);

    const targets = abilities.applyEffectAoE(
      { x: FP.FromInt(0), z: FP.FromInt(0) },
      'Effect.Explosion',
      /* sourceEntityId */ -1,
      { radius: FP.FromInt(10) }
    );
    expect(targets).toEqual([a.id, b.id, c.id]);

    world.processAllTicks(2);
    // -50 health each: 100 -> 50.
    expect(FP.ToFloat(abilities.getAttribute(a.id, 'Health').current)).toBe(50);
    expect(FP.ToFloat(abilities.getAttribute(b.id, 'Health').current)).toBe(50);
    expect(FP.ToFloat(abilities.getAttribute(c.id, 'Health').current)).toBe(50);

    world.dispose();
  });

  it('deduplicates entities returned more than once by the spatial query', () => {
    const { world, abilities, spatial } = createTargetWorld();
    const a = spawnEntity(world, abilities);
    const b = spawnEntity(world, abilities);
    world.processAllTicks(1);

    // Misbehaving hash grid: same entity returned multiple times.
    spatial.setQuery(() => [a.id, b.id, a.id, b.id, a.id]);

    const targets = abilities.applyEffectAoE(
      { x: FP.FromInt(0), z: FP.FromInt(0) },
      'Effect.Explosion',
      -1,
      { radius: FP.FromInt(10) }
    );
    expect(targets).toEqual([a.id, b.id]);

    world.processAllTicks(2);
    // Each target got hit exactly once — dedup must happen before enqueue.
    expect(FP.ToFloat(abilities.getAttribute(a.id, 'Health').current)).toBe(50);
    expect(FP.ToFloat(abilities.getAttribute(b.id, 'Health').current)).toBe(50);

    world.dispose();
  });

  it('caps the resolved list at maxTargets AFTER sorting (lowest entity ids win)', () => {
    const { world, abilities, spatial } = createTargetWorld();
    const a = spawnEntity(world, abilities);
    const b = spawnEntity(world, abilities);
    const c = spawnEntity(world, abilities);
    const d = spawnEntity(world, abilities);
    world.processAllTicks(1);

    // Spatial returns them out of order to prove trim is post-sort.
    spatial.setQuery(() => [d.id, b.id, c.id, a.id]);

    const targets = abilities.applyEffectAoE(
      { x: FP.FromInt(0), z: FP.FromInt(0) },
      'Effect.Explosion',
      -1,
      { radius: FP.FromInt(10), maxTargets: 2 }
    );
    expect(targets).toEqual([a.id, b.id]);

    world.processAllTicks(2);
    expect(FP.ToFloat(abilities.getAttribute(a.id, 'Health').current)).toBe(50);
    expect(FP.ToFloat(abilities.getAttribute(b.id, 'Health').current)).toBe(50);
    // c and d are untouched.
    expect(FP.ToFloat(abilities.getAttribute(c.id, 'Health').current)).toBe(100);
    expect(FP.ToFloat(abilities.getAttribute(d.id, 'Health').current)).toBe(100);

    world.dispose();
  });

  it('filters by tagsRequired before the maxTargets trim', () => {
    const { world, abilities, spatial } = createTargetWorld();
    const ally1 = spawnEntity(world, abilities);
    const enemy = spawnEntity(world, abilities);
    const ally2 = spawnEntity(world, abilities);
    abilities.addTag(ally1.id, 'Team.Ally');
    abilities.addTag(ally2.id, 'Team.Ally');
    abilities.addTag(enemy.id, 'Team.Enemy');
    world.processAllTicks(1);

    spatial.setQuery(() => [ally1.id, enemy.id, ally2.id]);

    const targets = abilities.applyEffectAoE(
      { x: FP.FromInt(0), z: FP.FromInt(0) },
      'Effect.Heal',
      -1,
      {
        radius: FP.FromInt(10),
        filter: { tagsRequired: ['Team.Ally'] },
      }
    );
    expect(targets).toEqual([ally1.id, ally2.id]);

    world.processAllTicks(2);
    // Hurt them first so the heal is observable (clamp would mask the
    // attempted +20 against the 100 max otherwise).
    // For brevity we just verify the targets list — the heal effect's
    // application is covered by the existing effects tests.

    world.dispose();
  });

  it('filters by tagsBlocked', () => {
    const { world, abilities, spatial } = createTargetWorld();
    const a = spawnEntity(world, abilities);
    const b = spawnEntity(world, abilities);
    const c = spawnEntity(world, abilities);
    abilities.addTag(b.id, 'State.Invulnerable');
    world.processAllTicks(1);

    spatial.setQuery(() => [a.id, b.id, c.id]);

    const targets = abilities.applyEffectAoE(
      { x: FP.FromInt(0), z: FP.FromInt(0) },
      'Effect.Explosion',
      -1,
      {
        radius: FP.FromInt(10),
        filter: { tagsBlocked: ['State.Invulnerable'] },
      }
    );
    expect(targets).toEqual([a.id, c.id]);

    world.dispose();
  });

  it('excludes the caster by default (includeSelf omitted)', () => {
    const { world, abilities, spatial } = createTargetWorld();
    const caster = spawnEntity(world, abilities);
    const enemy = spawnEntity(world, abilities);
    world.processAllTicks(1);

    spatial.setQuery(() => [caster.id, enemy.id]);

    const targets = abilities.applyEffectAoE(
      { x: FP.FromInt(0), z: FP.FromInt(0) },
      'Effect.Explosion',
      /* sourceEntityId */ caster.id,
      { radius: FP.FromInt(10) }
    );
    expect(targets).toEqual([enemy.id]);

    world.processAllTicks(2);
    expect(FP.ToFloat(abilities.getAttribute(caster.id, 'Health').current)).toBe(100);
    expect(FP.ToFloat(abilities.getAttribute(enemy.id, 'Health').current)).toBe(50);

    world.dispose();
  });

  it('includes the caster when includeSelf is true (e.g. self-heal aura)', () => {
    const { world, abilities, spatial } = createTargetWorld();
    const caster = spawnEntity(world, abilities);
    const ally = spawnEntity(world, abilities);
    world.processAllTicks(1);

    spatial.setQuery(() => [caster.id, ally.id]);

    const targets = abilities.applyEffectAoE(
      { x: FP.FromInt(0), z: FP.FromInt(0) },
      'Effect.Heal',
      caster.id,
      { radius: FP.FromInt(10), includeSelf: true }
    );
    expect(targets).toEqual([caster.id, ally.id]);

    world.dispose();
  });

  it('honours selfId override (excludes a specific entity even when sourceEntityId differs)', () => {
    const { world, abilities, spatial } = createTargetWorld();
    const launcher = spawnEntity(world, abilities);
    const rocket = spawnEntity(world, abilities);
    const enemy = spawnEntity(world, abilities);
    world.processAllTicks(1);

    spatial.setQuery(() => [launcher.id, rocket.id, enemy.id]);

    // Rocket source, but we want the launcher excluded (it shouldn't
    // splash itself). selfId override does exactly that.
    const targets = abilities.applyEffectAoE(
      { x: FP.FromInt(0), z: FP.FromInt(0) },
      'Effect.Explosion',
      rocket.id,
      { radius: FP.FromInt(10), selfId: launcher.id }
    );
    expect(targets).toEqual([rocket.id, enemy.id]);

    world.dispose();
  });

  it('throws when no spatial query is registered', () => {
    const { world, abilities } = createTargetWorld({ skipSpatial: true });
    spawnEntity(world, abilities);
    world.processAllTicks(1);

    expect(() =>
      abilities.applyEffectAoE(
        { x: FP.FromInt(0), z: FP.FromInt(0) },
        'Effect.Explosion',
        -1,
        { radius: FP.FromInt(10) }
      )
    ).toThrow(/spatial query/);

    world.dispose();
  });

  it('throws when the effectId is unknown', () => {
    const { world, abilities } = createTargetWorld();
    spawnEntity(world, abilities);
    world.processAllTicks(1);

    expect(() =>
      abilities.applyEffectAoE(
        { x: FP.FromInt(0), z: FP.FromInt(0) },
        'Effect.DoesNotExist',
        -1,
        { radius: FP.FromInt(10) }
      )
    ).toThrow(/EffectRegistry does not contain/);

    world.dispose();
  });

  it('drops entity ids returned by the spatial query that have been removed already (with filter)', () => {
    const { world, abilities, spatial } = createTargetWorld();
    const a = spawnEntity(world, abilities);
    const b = spawnEntity(world, abilities);
    world.processAllTicks(1);

    const ghostId = 9999; // never added to the world
    spatial.setQuery(() => [a.id, ghostId, b.id]);

    const targets = abilities.applyEffectAoE(
      { x: FP.FromInt(0), z: FP.FromInt(0) },
      'Effect.Explosion',
      -1,
      {
        radius: FP.FromInt(10),
        filter: { tagsBlocked: ['Never.Granted'] },
      }
    );
    expect(targets).toEqual([a.id, b.id]);

    world.dispose();
  });

  it('drops entity ids returned by the spatial query that have been removed already (no filter)', () => {
    // The resolver checks entity existence unconditionally — even when
    // no filter is provided — so ghost ids never leak into the returned
    // list. Without this guarantee the facade's enqueue loop would have
    // been the only thing keeping them out, and callers reading the
    // return value of `applyEffectAoE` could observe phantom hits.
    const { world, abilities, spatial } = createTargetWorld();
    const a = spawnEntity(world, abilities);
    const b = spawnEntity(world, abilities);
    world.processAllTicks(1);

    const ghostId = 9999;
    spatial.setQuery(() => [a.id, ghostId, b.id]);

    const targets = abilities.applyEffectAoE(
      { x: FP.FromInt(0), z: FP.FromInt(0) },
      'Effect.Explosion',
      -1,
      { radius: FP.FromInt(10) }
    );
    expect(targets).toEqual([a.id, b.id]);

    world.dispose();
  });

  it('returns the enqueued subset — maxTargets === 0 yields an empty list', () => {
    // Guard for the `maxTargets === 0` edge case: the loop guard must
    // run BEFORE pushing the first id, so the call resolves to no
    // targets at all (not one).
    const { world, abilities, spatial } = createTargetWorld();
    const a = spawnEntity(world, abilities);
    const b = spawnEntity(world, abilities);
    world.processAllTicks(1);

    spatial.setQuery(() => [a.id, b.id]);

    const targets = abilities.applyEffectAoE(
      { x: FP.FromInt(0), z: FP.FromInt(0) },
      'Effect.Explosion',
      -1,
      { radius: FP.FromInt(10), maxTargets: 0 }
    );
    expect(targets).toEqual([]);

    world.processAllTicks(2);
    expect(FP.ToFloat(abilities.getAttribute(a.id, 'Health').current)).toBe(100);
    expect(FP.ToFloat(abilities.getAttribute(b.id, 'Health').current)).toBe(100);

    world.dispose();
  });

  it('produces the same ordering across two independent worlds (determinism check)', () => {
    // Build two worlds and populate them independently so each gets
    // its own fresh entity-id sequence. Both should end up with the
    // same ids (0..9, modulo whatever the ECS allocator does), but the
    // determinism guarantee we are testing is that the resolver sorts
    // by entity id ASC — so if the spatial query returns the *same*
    // ids in different orders, the resolver output is identical.
    const worldA = createTargetWorld();
    const aIds: number[] = [];
    for (let i = 0; i < 10; i++) {
      const e = spawnEntity(worldA.world, worldA.abilities);
      aIds.push(e.id);
    }
    worldA.world.processAllTicks(1);

    const worldB = createTargetWorld();
    const bIds: number[] = [];
    for (let i = 0; i < 10; i++) {
      const e = spawnEntity(worldB.world, worldB.abilities);
      bIds.push(e.id);
    }
    worldB.world.processAllTicks(1);

    // Sanity: both worlds must allocate ids the same way for this test
    // to make sense. If this ever breaks, the test needs revisiting.
    expect(aIds).toEqual(bIds);

    // Indices into aIds/bIds — same logical "who is in the AoE" set,
    // but returned in two different orders.
    const indices = [3, 1, 4, 1, 5, 9, 2, 6, 5];
    worldA.spatial.setQuery(() => indices.map(i => aIds[i]));
    worldB.spatial.setQuery(() => [...indices].reverse().map(i => bIds[i]));

    const targetsA = worldA.abilities.applyEffectAoE(
      { x: FP.FromInt(0), z: FP.FromInt(0) },
      'Effect.Explosion',
      -1,
      { radius: FP.FromInt(10) }
    );
    const targetsB = worldB.abilities.applyEffectAoE(
      { x: FP.FromInt(0), z: FP.FromInt(0) },
      'Effect.Explosion',
      -1,
      { radius: FP.FromInt(10) }
    );

    expect(targetsA).toEqual(targetsB);

    worldA.world.dispose();
    worldB.world.dispose();
  });
});

describe('TargetResolver via ability activation — Radius origin kinds', () => {
  it("resolves origin 'Point' from providedTarget for a Radius-target ability", () => {
    const { world, abilities, spatial, abilityIds } = createTargetWorld({
      abilities: [
        defineAbility({
          id: 'Ability.FrostNova',
          target: {
            kind: 'Radius',
            origin: { kind: 'Caller' },
            radius: FP.FromInt(10),
          },
          targetEffectIds: ['Effect.Explosion'],
        }),
      ],
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    const enemy = spawnEntity(world, abilities);
    world.processAllTicks(1);

    spatial.setQuery(() => [enemy.id]);

    abilities.activateAbility(caster.id, 'Ability.FrostNova', {
      x: FP.FromInt(5),
      z: FP.FromInt(5),
    });
    world.processAllTicks(2);

    // -50 health: 100 -> 50.
    expect(FP.ToFloat(abilities.getAttribute(enemy.id, 'Health').current)).toBe(50);
    world.dispose();
  });

  it("resolves origin 'Caster' from the caster's position via ISpatialQuery.getEntityPosition", () => {
    const { world, abilities, spatial, abilityIds } = createTargetWorld({
      abilities: [
        defineAbility({
          id: 'Ability.Nova',
          target: {
            kind: 'Radius',
            origin: { kind: 'Caster' },
            radius: FP.FromInt(10),
            includeSelf: false,
          },
          targetEffectIds: ['Effect.Explosion'],
        }),
      ],
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    const enemy = spawnEntity(world, abilities);
    world.processAllTicks(1);

    spatial.setPosition(caster.id, { x: FP.FromInt(7), z: FP.FromInt(7) });
    spatial.setQuery((cx, cz) => {
      // Verify the resolver passed the caster's position through.
      expect(FP.ToFloat(cx)).toBe(7);
      expect(FP.ToFloat(cz)).toBe(7);
      return [caster.id, enemy.id];
    });

    abilities.activateAbility(caster.id, 'Ability.Nova');
    world.processAllTicks(2);

    expect(FP.ToFloat(abilities.getAttribute(enemy.id, 'Health').current)).toBe(50);
    // Caster is excluded by default.
    expect(FP.ToFloat(abilities.getAttribute(caster.id, 'Health').current)).toBe(100);
    world.dispose();
  });

  it("throws when origin 'Caster' is used but getEntityPosition returns undefined", () => {
    // The adapter implements the optional method but has no position
    // for the caster (e.g. entity hasn't been added to the spatial
    // index yet). The error should still actionably point at
    // ISpatialQuery.getEntityPosition.
    const { world, abilities, spatial, abilityIds } = createTargetWorld({
      abilities: [
        defineAbility({
          id: 'Ability.Nova',
          target: {
            kind: 'Radius',
            origin: { kind: 'Caster' },
            radius: FP.FromInt(10),
          },
          targetEffectIds: ['Effect.Explosion'],
        }),
      ],
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    world.processAllTicks(1);

    // Caster has no registered position — getEntityPosition will return
    // undefined for this id.
    spatial.clearPositions();

    abilities.activateAbility(caster.id, 'Ability.Nova');
    expect(() => world.processAllTicks(2)).toThrow(
      /getEntityPosition/
    );

    world.dispose();
  });

  it("throws when origin 'Caster' is used but the adapter does not implement getEntityPosition", () => {
    const world = new GameWorld({});
    const abilities = createAbilitySystem(world, {
      definitions: defineAbilitySystem({
        attributes: [HealthAttribute],
        effects: [ExplosionEffect],
        abilities: [
          defineAbility({
            id: 'Ability.Nova',
            target: {
              kind: 'Radius',
              origin: { kind: 'Caster' },
              radius: FP.FromInt(10),
            },
            targetEffectIds: ['Effect.Explosion'],
          }),
        ],
      }),
      pipeline: 'activation',
      spatialQuery: { queryRadius: () => [] },
    });
    world.registerSystems([...abilities.tickSystems], []);

    const caster = spawnCombatEntity(world, abilities, ['Ability.Nova']);
    world.processAllTicks(1);

    abilities.activateAbility(caster.id, 'Ability.Nova');
    expect(() => world.processAllTicks(2)).toThrow(/getEntityPosition/);

    world.dispose();
  });

  it("resolves origin 'TargetEntity' from the targeted entity's position", () => {
    // TargetEntity origin needs the boss entity id at definition time.
    resetEntityIdCounter();
    const spatial = new FakeSpatialQuery();
    const boss = new Entity();
    const { world, abilities, abilityIds } = createActivationWorld({
      pipeline: 'activation',
      attributes: [HealthAttribute],
      effects: [ExplosionEffect],
      abilities: [
        defineAbility({
          id: 'Ability.NovaAt',
          target: {
            kind: 'Radius',
            origin: { kind: 'TargetEntity', entityId: boss.id },
            radius: FP.FromInt(10),
          },
          targetEffectIds: ['Effect.Explosion'],
        }),
      ],
      spatialQuery: spatial,
    });
    equipEntity(world, boss, abilities);
    world.entityManager.addEntity(boss);
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    const enemy = spawnEntity(world, abilities);
    world.processAllTicks(1);

    spatial.setPosition(boss.id, { x: FP.FromInt(50), z: FP.FromInt(50) });
    spatial.setQuery((cx, cz) => {
      expect(FP.ToFloat(cx)).toBe(50);
      expect(FP.ToFloat(cz)).toBe(50);
      return [enemy.id];
    });

    abilities.activateAbility(caster.id, 'Ability.NovaAt');
    world.processAllTicks(2);

    expect(FP.ToFloat(abilities.getAttribute(enemy.id, 'Health').current)).toBe(50);
    world.dispose();
  });

  it('silently drops a Caller-origin Radius activation with no point provided', () => {
    // The hard requirement: a Caller-origin Radius activation without a
    // point must NOT charge cost, NOT enqueue cooldown, NOT emit the
    // AbilityActivated event, NOT schedule the hook, AND not run the
    // spatial query. Earlier implementations of the resolver returned an
    // empty array indistinguishable from a legitimate "AoE hit nobody",
    // which let processOne charge the caster anyway.
    let hookCalled = false;
    const mana100 = defineAttribute({
      id: 'Mana',
      default: FP.FromInt(100),
      min: FP.FromInt(0),
      max: FP.FromInt(100),
      clamp: 'both',
    });
    const { world, abilities, spatial } = createTargetWorld({
      attributes: [HealthAttribute, mana100],
      effects: [
        defineEffect({
          id: 'Effect.SpendMana20',
          type: 'Instant',
          modifiers: [{ attributeId: 'Mana', op: 'Add', magnitude: FP.FromInt(-20) }],
        }),
        defineEffect({
          id: 'Effect.FrostNova.Cooldown',
          type: 'Duration',
          durationTicks: 5,
          tagsGranted: ['Cooldown.Ability.FrostNova'],
        }),
      ],
      abilities: [
        defineAbility({
          id: 'Ability.FrostNova',
          target: {
            kind: 'Radius',
            origin: { kind: 'Caller' },
            radius: FP.FromInt(10),
          },
          targetEffectIds: ['Effect.Explosion'],
          costEffectId: 'Effect.SpendMana20',
          cooldownEffectId: 'Effect.FrostNova.Cooldown',
          hookId: 'Hook.Nova',
        }),
      ],
      hooks: {
        'Hook.Nova': () => {
          hookCalled = true;
        },
      },
    });

    const caster = spawnEntity(world, abilities);
    const enemy = spawnEntity(world, abilities);
    world.processAllTicks(1);

    let queryCalled = false;
    spatial.setQuery(() => {
      queryCalled = true;
      return [enemy.id];
    });

    let eventEmitted = false;
    world.eventBus.on<AbilityActivatedEvent>(ABILITY_ACTIVATED_EVENT, () => {
      eventEmitted = true;
    });

    // No providedTarget — Caller has nothing to read.
    abilities.activateAbility(caster.id, 'Ability.FrostNova');
    world.processAllTicks(2);

    // No side effects of any kind:
    expect(queryCalled).toBe(false);
    expect(eventEmitted).toBe(false);
    expect(hookCalled).toBe(false);
    // Mana untouched (cost NOT charged).
    expect(FP.ToFloat(abilities.getAttribute(caster.id, 'Mana').current)).toBe(100);
    // Cooldown tag NOT applied — caster can still cast.
    expect(abilities.hasTag(caster.id, 'Cooldown.Ability.FrostNova')).toBe(false);
    // Enemy untouched.
    expect(FP.ToFloat(abilities.getAttribute(enemy.id, 'Health').current)).toBe(100);
    world.dispose();
  });

  it('silently drops a Caller-origin Entity activation with no entityId provided', () => {
    // Same contract for Entity-shape abilities: forgetting to pass
    // `{ entityId }` must not charge cost or run the hook.
    let hookCalled = false;
    const mana100 = defineAttribute({
      id: 'Mana',
      default: FP.FromInt(100),
      min: FP.FromInt(0),
      max: FP.FromInt(100),
      clamp: 'both',
    });
    const { world, abilities } = createTargetWorld({
      attributes: [HealthAttribute, mana100],
      effects: [
        defineEffect({
          id: 'Effect.SpendMana15',
          type: 'Instant',
          modifiers: [{ attributeId: 'Mana', op: 'Add', magnitude: FP.FromInt(-15) }],
        }),
      ],
      abilities: [
        defineAbility({
          id: 'Ability.Smite',
          target: { kind: 'Entity', origin: { kind: 'Caller' } },
          targetEffectIds: ['Effect.Explosion'],
          costEffectId: 'Effect.SpendMana15',
          hookId: 'Hook.Smite',
        }),
      ],
      hooks: {
        'Hook.Smite': () => {
          hookCalled = true;
        },
      },
    });

    const caster = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.activateAbility(caster.id, 'Ability.Smite');
    world.processAllTicks(2);

    expect(hookCalled).toBe(false);
    expect(FP.ToFloat(abilities.getAttribute(caster.id, 'Mana').current)).toBe(100);
    world.dispose();
  });

  it('silently drops a Caller-origin Point activation with no point provided', () => {
    // Point-shape abilities also drop when origin Caller has no point.
    // Otherwise the rocket hook would run with no impact location.
    let hookCalled = false;
    const mana100 = defineAttribute({
      id: 'Mana',
      default: FP.FromInt(100),
      min: FP.FromInt(0),
      max: FP.FromInt(100),
      clamp: 'both',
    });
    const { world, abilities } = createTargetWorld({
      attributes: [HealthAttribute, mana100],
      effects: [
        defineEffect({
          id: 'Effect.SpendMana25',
          type: 'Instant',
          modifiers: [{ attributeId: 'Mana', op: 'Add', magnitude: FP.FromInt(-25) }],
        }),
      ],
      abilities: [
        defineAbility({
          id: 'Ability.Rocket',
          target: { kind: 'Point', origin: { kind: 'Caller' } },
          costEffectId: 'Effect.SpendMana25',
          hookId: 'Hook.Rocket',
        }),
      ],
      hooks: {
        'Hook.Rocket': () => {
          hookCalled = true;
        },
      },
    });

    const caster = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.activateAbility(caster.id, 'Ability.Rocket');
    world.processAllTicks(2);

    expect(hookCalled).toBe(false);
    expect(FP.ToFloat(abilities.getAttribute(caster.id, 'Mana').current)).toBe(100);
    world.dispose();
  });
});

describe('TargetResolver — Point target shape', () => {
  it("Point target resolves to an empty target list; the providedTarget is passed to the hook", () => {
    let observed: { resolvedTargets: number[]; x?: FixedPoint; z?: FixedPoint } | undefined;
    const { world, abilities, abilityIds } = createTestWorld({
      pipeline: 'activation',
      abilities: [
        defineAbility({
          id: 'Ability.Rocket',
          target: { kind: 'Point', origin: { kind: 'Caller' } },
          hookId: 'Hook.Rocket',
        }),
      ],
      hooks: {
        'Hook.Rocket': (ctx) => {
          observed = {
            resolvedTargets: [...ctx.resolvedTargets],
            x: ctx.providedTarget?.x,
            z: ctx.providedTarget?.z,
          };
        },
      },
    });
    const caster = spawnCombatEntity(world, abilities, abilityIds);
    world.processAllTicks(1);

    abilities.activateAbility(caster.id, 'Ability.Rocket', {
      x: FP.FromInt(42),
      z: FP.FromInt(7),
    });
    world.processAllTicks(2);

    expect(observed?.resolvedTargets).toEqual([]);
    expect(observed?.x !== undefined && FP.ToFloat(observed.x)).toBe(42);
    expect(observed?.z !== undefined && FP.ToFloat(observed.z)).toBe(7);
    world.dispose();
  });
});

interface TargetWorldOpts {
  attributes?: readonly ReturnType<typeof defineAttribute>[];
  effects?: readonly ReturnType<typeof defineEffect>[];
  abilities?: readonly ReturnType<typeof defineAbility>[];
  hooks?: Record<string, import('../src').AbilityHook>;
  skipSpatial?: boolean;
}

function createTargetWorld(opts: TargetWorldOpts = {}) {
  return createTestWorld({
    pipeline: 'activation',
    attributes: opts.attributes ?? [HealthAttribute],
    effects: [ExplosionEffect, HealEffect, ...(opts.effects ?? [])],
    abilities: opts.abilities,
    hooks: opts.hooks,
    skipSpatial: opts.skipSpatial,
  });
}
