import { describe, expect, it } from 'vitest';
import { Entity, GameWorld } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import type { FixedPoint } from 'phalanx-math';
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
import type {
  AbilityActivatedEvent,
  AbilitySystemRegistries,
  AbilitySystemRuntime,
  ISpatialQuery,
} from '../src';

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
    const { world, facade, spatial } = createTestWorld();
    const a = addEntity(world);
    const b = addEntity(world);
    const c = addEntity(world);
    facade.initAttributesForEntity(a.id);
    facade.initAttributesForEntity(b.id);
    facade.initAttributesForEntity(c.id);
    world.processAllTicks(1);

    // Return ids in scrambled order; resolver must sort them.
    spatial.setQuery(() => [c.id, a.id, b.id]);

    const targets = facade.applyEffectAoE(
      { x: FP.FromInt(0), z: FP.FromInt(0) },
      'Effect.Explosion',
      /* sourceEntityId */ -1,
      { radius: FP.FromInt(10) }
    );
    expect(targets).toEqual([a.id, b.id, c.id]);

    world.processAllTicks(2);
    // -50 health each: 100 -> 50.
    expect(FP.ToFloat(facade.getAttribute(a.id, 'Health').current)).toBe(50);
    expect(FP.ToFloat(facade.getAttribute(b.id, 'Health').current)).toBe(50);
    expect(FP.ToFloat(facade.getAttribute(c.id, 'Health').current)).toBe(50);

    world.dispose();
  });

  it('deduplicates entities returned more than once by the spatial query', () => {
    const { world, facade, spatial } = createTestWorld();
    const a = addEntity(world);
    const b = addEntity(world);
    facade.initAttributesForEntity(a.id);
    facade.initAttributesForEntity(b.id);
    world.processAllTicks(1);

    // Misbehaving hash grid: same entity returned multiple times.
    spatial.setQuery(() => [a.id, b.id, a.id, b.id, a.id]);

    const targets = facade.applyEffectAoE(
      { x: FP.FromInt(0), z: FP.FromInt(0) },
      'Effect.Explosion',
      -1,
      { radius: FP.FromInt(10) }
    );
    expect(targets).toEqual([a.id, b.id]);

    world.processAllTicks(2);
    // Each target got hit exactly once — dedup must happen before enqueue.
    expect(FP.ToFloat(facade.getAttribute(a.id, 'Health').current)).toBe(50);
    expect(FP.ToFloat(facade.getAttribute(b.id, 'Health').current)).toBe(50);

    world.dispose();
  });

  it('caps the resolved list at maxTargets AFTER sorting (lowest entity ids win)', () => {
    const { world, facade, spatial } = createTestWorld();
    const a = addEntity(world);
    const b = addEntity(world);
    const c = addEntity(world);
    const d = addEntity(world);
    facade.initAttributesForEntity(a.id);
    facade.initAttributesForEntity(b.id);
    facade.initAttributesForEntity(c.id);
    facade.initAttributesForEntity(d.id);
    world.processAllTicks(1);

    // Spatial returns them out of order to prove trim is post-sort.
    spatial.setQuery(() => [d.id, b.id, c.id, a.id]);

    const targets = facade.applyEffectAoE(
      { x: FP.FromInt(0), z: FP.FromInt(0) },
      'Effect.Explosion',
      -1,
      { radius: FP.FromInt(10), maxTargets: 2 }
    );
    expect(targets).toEqual([a.id, b.id]);

    world.processAllTicks(2);
    expect(FP.ToFloat(facade.getAttribute(a.id, 'Health').current)).toBe(50);
    expect(FP.ToFloat(facade.getAttribute(b.id, 'Health').current)).toBe(50);
    // c and d are untouched.
    expect(FP.ToFloat(facade.getAttribute(c.id, 'Health').current)).toBe(100);
    expect(FP.ToFloat(facade.getAttribute(d.id, 'Health').current)).toBe(100);

    world.dispose();
  });

  it('filters by tagsRequired before the maxTargets trim', () => {
    const { world, facade, spatial } = createTestWorld();
    const ally1 = addEntity(world);
    const enemy = addEntity(world);
    const ally2 = addEntity(world);
    facade.initAttributesForEntity(ally1.id);
    facade.initAttributesForEntity(enemy.id);
    facade.initAttributesForEntity(ally2.id);
    facade.addTag(ally1.id, 'Team.Ally');
    facade.addTag(ally2.id, 'Team.Ally');
    facade.addTag(enemy.id, 'Team.Enemy');
    world.processAllTicks(1);

    spatial.setQuery(() => [ally1.id, enemy.id, ally2.id]);

    const targets = facade.applyEffectAoE(
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
    const { world, facade, spatial } = createTestWorld();
    const a = addEntity(world);
    const b = addEntity(world);
    const c = addEntity(world);
    facade.initAttributesForEntity(a.id);
    facade.initAttributesForEntity(b.id);
    facade.initAttributesForEntity(c.id);
    facade.addTag(b.id, 'State.Invulnerable');
    world.processAllTicks(1);

    spatial.setQuery(() => [a.id, b.id, c.id]);

    const targets = facade.applyEffectAoE(
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
    const { world, facade, spatial } = createTestWorld();
    const caster = addEntity(world);
    const enemy = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    facade.initAttributesForEntity(enemy.id);
    world.processAllTicks(1);

    spatial.setQuery(() => [caster.id, enemy.id]);

    const targets = facade.applyEffectAoE(
      { x: FP.FromInt(0), z: FP.FromInt(0) },
      'Effect.Explosion',
      /* sourceEntityId */ caster.id,
      { radius: FP.FromInt(10) }
    );
    expect(targets).toEqual([enemy.id]);

    world.processAllTicks(2);
    expect(FP.ToFloat(facade.getAttribute(caster.id, 'Health').current)).toBe(100);
    expect(FP.ToFloat(facade.getAttribute(enemy.id, 'Health').current)).toBe(50);

    world.dispose();
  });

  it('includes the caster when includeSelf is true (e.g. self-heal aura)', () => {
    const { world, facade, spatial } = createTestWorld();
    const caster = addEntity(world);
    const ally = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    facade.initAttributesForEntity(ally.id);
    world.processAllTicks(1);

    spatial.setQuery(() => [caster.id, ally.id]);

    const targets = facade.applyEffectAoE(
      { x: FP.FromInt(0), z: FP.FromInt(0) },
      'Effect.Heal',
      caster.id,
      { radius: FP.FromInt(10), includeSelf: true }
    );
    expect(targets).toEqual([caster.id, ally.id]);

    world.dispose();
  });

  it('honours selfId override (excludes a specific entity even when sourceEntityId differs)', () => {
    const { world, facade, spatial } = createTestWorld();
    const launcher = addEntity(world);
    const rocket = addEntity(world);
    const enemy = addEntity(world);
    facade.initAttributesForEntity(launcher.id);
    facade.initAttributesForEntity(enemy.id);
    world.processAllTicks(1);

    spatial.setQuery(() => [launcher.id, rocket.id, enemy.id]);

    // Rocket source, but we want the launcher excluded (it shouldn't
    // splash itself). selfId override does exactly that.
    const targets = facade.applyEffectAoE(
      { x: FP.FromInt(0), z: FP.FromInt(0) },
      'Effect.Explosion',
      rocket.id,
      { radius: FP.FromInt(10), selfId: launcher.id }
    );
    expect(targets).toEqual([rocket.id, enemy.id]);

    world.dispose();
  });

  it('throws when no spatial query is registered', () => {
    const { world, facade } = createTestWorld({ skipSpatial: true });
    addEntity(world);
    world.processAllTicks(1);

    expect(() =>
      facade.applyEffectAoE(
        { x: FP.FromInt(0), z: FP.FromInt(0) },
        'Effect.Explosion',
        -1,
        { radius: FP.FromInt(10) }
      )
    ).toThrow(/spatial query/);

    world.dispose();
  });

  it('throws when the effectId is unknown', () => {
    const { world, facade } = createTestWorld();
    addEntity(world);
    world.processAllTicks(1);

    expect(() =>
      facade.applyEffectAoE(
        { x: FP.FromInt(0), z: FP.FromInt(0) },
        'Effect.DoesNotExist',
        -1,
        { radius: FP.FromInt(10) }
      )
    ).toThrow(/EffectRegistry does not contain/);

    world.dispose();
  });

  it('drops entity ids returned by the spatial query that have been removed already (with filter)', () => {
    const { world, facade, spatial } = createTestWorld();
    const a = addEntity(world);
    const b = addEntity(world);
    facade.initAttributesForEntity(a.id);
    facade.initAttributesForEntity(b.id);
    world.processAllTicks(1);

    const ghostId = 9999; // never added to the world
    spatial.setQuery(() => [a.id, ghostId, b.id]);

    const targets = facade.applyEffectAoE(
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
    const { world, facade, spatial } = createTestWorld();
    const a = addEntity(world);
    const b = addEntity(world);
    facade.initAttributesForEntity(a.id);
    facade.initAttributesForEntity(b.id);
    world.processAllTicks(1);

    const ghostId = 9999;
    spatial.setQuery(() => [a.id, ghostId, b.id]);

    const targets = facade.applyEffectAoE(
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
    const { world, facade, spatial } = createTestWorld();
    const a = addEntity(world);
    const b = addEntity(world);
    facade.initAttributesForEntity(a.id);
    facade.initAttributesForEntity(b.id);
    world.processAllTicks(1);

    spatial.setQuery(() => [a.id, b.id]);

    const targets = facade.applyEffectAoE(
      { x: FP.FromInt(0), z: FP.FromInt(0) },
      'Effect.Explosion',
      -1,
      { radius: FP.FromInt(10), maxTargets: 0 }
    );
    expect(targets).toEqual([]);

    world.processAllTicks(2);
    expect(FP.ToFloat(facade.getAttribute(a.id, 'Health').current)).toBe(100);
    expect(FP.ToFloat(facade.getAttribute(b.id, 'Health').current)).toBe(100);

    world.dispose();
  });

  it('produces the same ordering across two independent worlds (determinism check)', () => {
    // Build two worlds and populate them independently so each gets
    // its own fresh entity-id sequence. Both should end up with the
    // same ids (0..9, modulo whatever the ECS allocator does), but the
    // determinism guarantee we are testing is that the resolver sorts
    // by entity id ASC — so if the spatial query returns the *same*
    // ids in different orders, the resolver output is identical.
    const worldA = createTestWorld();
    const aIds: number[] = [];
    for (let i = 0; i < 10; i++) {
      const e = addEntity(worldA.world);
      aIds.push(e.id);
      worldA.facade.initAttributesForEntity(e.id);
    }
    worldA.world.processAllTicks(1);

    const worldB = createTestWorld();
    const bIds: number[] = [];
    for (let i = 0; i < 10; i++) {
      const e = addEntity(worldB.world);
      bIds.push(e.id);
      worldB.facade.initAttributesForEntity(e.id);
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

    const targetsA = worldA.facade.applyEffectAoE(
      { x: FP.FromInt(0), z: FP.FromInt(0) },
      'Effect.Explosion',
      -1,
      { radius: FP.FromInt(10) }
    );
    const targetsB = worldB.facade.applyEffectAoE(
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
    const { world, facade, spatial } = createTestWorld({
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
    const caster = addEntity(world);
    const enemy = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    facade.initAttributesForEntity(enemy.id);
    world.processAllTicks(1);

    spatial.setQuery(() => [enemy.id]);

    facade.activateAbility(caster.id, 'Ability.FrostNova', {
      x: FP.FromInt(5),
      z: FP.FromInt(5),
    });
    world.processAllTicks(2);

    // -50 health: 100 -> 50.
    expect(FP.ToFloat(facade.getAttribute(enemy.id, 'Health').current)).toBe(50);
    world.dispose();
  });

  it("resolves origin 'Caster' from the caster's position via ISpatialQuery.getEntityPosition", () => {
    const { world, facade, spatial } = createTestWorld({
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
    const caster = addEntity(world);
    const enemy = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    facade.initAttributesForEntity(enemy.id);
    world.processAllTicks(1);

    spatial.setPosition(caster.id, { x: FP.FromInt(7), z: FP.FromInt(7) });
    spatial.setQuery((cx, cz) => {
      // Verify the resolver passed the caster's position through.
      expect(FP.ToFloat(cx)).toBe(7);
      expect(FP.ToFloat(cz)).toBe(7);
      return [caster.id, enemy.id];
    });

    facade.activateAbility(caster.id, 'Ability.Nova');
    world.processAllTicks(2);

    expect(FP.ToFloat(facade.getAttribute(enemy.id, 'Health').current)).toBe(50);
    // Caster is excluded by default.
    expect(FP.ToFloat(facade.getAttribute(caster.id, 'Health').current)).toBe(100);
    world.dispose();
  });

  it("throws when origin 'Caster' is used but getEntityPosition returns undefined", () => {
    // The adapter implements the optional method but has no position
    // for the caster (e.g. entity hasn't been added to the spatial
    // index yet). The error should still actionably point at
    // ISpatialQuery.getEntityPosition.
    const { world, facade, spatial } = createTestWorld({
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
    const caster = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    world.processAllTicks(1);

    // Caster has no registered position — getEntityPosition will return
    // undefined for this id.
    spatial.clearPositions();

    facade.activateAbility(caster.id, 'Ability.Nova');
    expect(() => world.processAllTicks(2)).toThrow(
      /getEntityPosition/
    );

    world.dispose();
  });

  it("throws when origin 'Caster' is used but the adapter does not implement getEntityPosition", () => {
    // Validate the adapter-shape-mismatch path: a spatial query that
    // satisfies the minimal ISpatialQuery contract (queryRadius) but
    // omits the optional getEntityPosition entirely. Caster/TargetEntity
    // Radius origins should fail loudly so users know which method to
    // add to their adapter.
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
    registries.effects.register(
      defineEffect({
        id: 'Effect.Explosion',
        type: 'Instant',
        modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-50) }],
      })
    );
    registries.abilities.register(
      defineAbility({
        id: 'Ability.Nova',
        target: {
          kind: 'Radius',
          origin: { kind: 'Caster' },
          radius: FP.FromInt(10),
        },
        targetEffectIds: ['Effect.Explosion'],
      })
    );
    const runtime = createAbilitySystemRuntime();
    const world = new GameWorld({
      componentTypes: [
        AbilitiesComponentType.Attributes,
        AbilitiesComponentType.ActiveEffects,
        AbilitiesComponentType.GameplayTags,
      ],
    });
    world.registerSystems(
      [
        new AbilityActivationSystem(registries, runtime),
        new EffectApplicationSystem(registries, runtime),
        new AbilityHookExecutorSystem(registries, runtime),
        new EffectTickSystem(registries),
        new AttributeAggregationSystem(registries),
      ],
      []
    );
    const facade = new AbilitySystemFacade(world.entityManager, registries, runtime);

    // Bare-bones spatial query: just queryRadius, no getEntityPosition.
    // This is the realistic shape of a v1 physics adapter that hasn't
    // been upgraded for Stage 6 yet.
    const bareAdapter: ISpatialQuery = {
      queryRadius: () => [],
    };
    facade.registerSpatialQuery(bareAdapter);

    const caster = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    world.processAllTicks(1);

    facade.activateAbility(caster.id, 'Ability.Nova');
    expect(() => world.processAllTicks(2)).toThrow(/getEntityPosition/);

    world.dispose();
  });

  it("resolves origin 'TargetEntity' from the targeted entity's position", () => {
    // TargetEntity origin lets the ability specify a fixed target entity
    // at definition time. Useful for "centered on the boss spawn point"
    // mechanics. The boss id must be known when the ability is
    // registered — so we build the world without abilities first,
    // allocate entities, then register the ability with the real id.
    const { world, facade, spatial, registries } = createTestWorld();
    const caster = addEntity(world);
    const boss = addEntity(world);
    const enemy = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    facade.initAttributesForEntity(boss.id);
    facade.initAttributesForEntity(enemy.id);
    world.processAllTicks(1);

    registries.abilities.register(
      defineAbility({
        id: 'Ability.NovaAt',
        target: {
          kind: 'Radius',
          origin: { kind: 'TargetEntity', entityId: boss.id },
          radius: FP.FromInt(10),
        },
        targetEffectIds: ['Effect.Explosion'],
      })
    );

    spatial.setPosition(boss.id, { x: FP.FromInt(50), z: FP.FromInt(50) });
    spatial.setQuery((cx, cz) => {
      expect(FP.ToFloat(cx)).toBe(50);
      expect(FP.ToFloat(cz)).toBe(50);
      return [enemy.id];
    });

    facade.activateAbility(caster.id, 'Ability.NovaAt');
    world.processAllTicks(2);

    expect(FP.ToFloat(facade.getAttribute(enemy.id, 'Health').current)).toBe(50);
    world.dispose();
  });

  it('silently drops a Caller-origin Radius activation with no point provided', () => {
    // The hard requirement: a Caller-origin Radius activation without a
    // point must NOT charge cost, NOT enqueue cooldown, NOT emit the
    // AbilityActivated event, NOT schedule the hook, AND not run the
    // spatial query. Earlier implementations of the resolver returned an
    // empty array indistinguishable from a legitimate "AoE hit nobody",
    // which let processOne charge the caster anyway.
    const { world, facade, spatial, registries } = createTestWorld();
    // Define cost + cooldown effects so we can assert the caster was
    // NOT charged. Mana is a custom attribute we add for this test.
    registries.attributes.register(
      defineAttribute({
        id: 'Mana',
        default: FP.FromInt(100),
        min: FP.FromInt(0),
        max: FP.FromInt(100),
        clamp: 'both',
      })
    );
    registries.effects.register(
      defineEffect({
        id: 'Effect.SpendMana20',
        type: 'Instant',
        modifiers: [{ attributeId: 'Mana', op: 'Add', magnitude: FP.FromInt(-20) }],
      })
    );
    registries.effects.register(
      defineEffect({
        id: 'Effect.FrostNova.Cooldown',
        type: 'Duration',
        durationTicks: 5,
        tagsGranted: ['Cooldown.Ability.FrostNova'],
      })
    );
    registries.abilities.register(
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
      })
    );

    const caster = addEntity(world);
    const enemy = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    facade.initAttributesForEntity(enemy.id);
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
    let hookCalled = false;
    facade.registerHook('Hook.Nova', () => {
      hookCalled = true;
    });

    // No providedTarget — Caller has nothing to read.
    facade.activateAbility(caster.id, 'Ability.FrostNova');
    world.processAllTicks(2);

    // No side effects of any kind:
    expect(queryCalled).toBe(false);
    expect(eventEmitted).toBe(false);
    expect(hookCalled).toBe(false);
    // Mana untouched (cost NOT charged).
    expect(FP.ToFloat(facade.getAttribute(caster.id, 'Mana').current)).toBe(100);
    // Cooldown tag NOT applied — caster can still cast.
    expect(facade.hasTag(caster.id, 'Cooldown.Ability.FrostNova')).toBe(false);
    // Enemy untouched.
    expect(FP.ToFloat(facade.getAttribute(enemy.id, 'Health').current)).toBe(100);
    world.dispose();
  });

  it('silently drops a Caller-origin Entity activation with no entityId provided', () => {
    // Same contract for Entity-shape abilities: forgetting to pass
    // `{ entityId }` must not charge cost or run the hook.
    const { world, facade, registries } = createTestWorld();
    registries.attributes.register(
      defineAttribute({
        id: 'Mana',
        default: FP.FromInt(100),
        min: FP.FromInt(0),
        max: FP.FromInt(100),
        clamp: 'both',
      })
    );
    registries.effects.register(
      defineEffect({
        id: 'Effect.SpendMana15',
        type: 'Instant',
        modifiers: [{ attributeId: 'Mana', op: 'Add', magnitude: FP.FromInt(-15) }],
      })
    );
    registries.abilities.register(
      defineAbility({
        id: 'Ability.Smite',
        target: { kind: 'Entity', origin: { kind: 'Caller' } },
        targetEffectIds: ['Effect.Explosion'],
        costEffectId: 'Effect.SpendMana15',
        hookId: 'Hook.Smite',
      })
    );

    const caster = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    world.processAllTicks(1);

    let hookCalled = false;
    facade.registerHook('Hook.Smite', () => {
      hookCalled = true;
    });

    facade.activateAbility(caster.id, 'Ability.Smite');
    world.processAllTicks(2);

    expect(hookCalled).toBe(false);
    expect(FP.ToFloat(facade.getAttribute(caster.id, 'Mana').current)).toBe(100);
    world.dispose();
  });

  it('silently drops a Caller-origin Point activation with no point provided', () => {
    // Point-shape abilities also drop when origin Caller has no point.
    // Otherwise the rocket hook would run with no impact location.
    const { world, facade, registries } = createTestWorld();
    registries.attributes.register(
      defineAttribute({
        id: 'Mana',
        default: FP.FromInt(100),
        min: FP.FromInt(0),
        max: FP.FromInt(100),
        clamp: 'both',
      })
    );
    registries.effects.register(
      defineEffect({
        id: 'Effect.SpendMana25',
        type: 'Instant',
        modifiers: [{ attributeId: 'Mana', op: 'Add', magnitude: FP.FromInt(-25) }],
      })
    );
    registries.abilities.register(
      defineAbility({
        id: 'Ability.Rocket',
        target: { kind: 'Point', origin: { kind: 'Caller' } },
        costEffectId: 'Effect.SpendMana25',
        hookId: 'Hook.Rocket',
      })
    );

    const caster = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    world.processAllTicks(1);

    let hookCalled = false;
    facade.registerHook('Hook.Rocket', () => {
      hookCalled = true;
    });

    facade.activateAbility(caster.id, 'Ability.Rocket');
    world.processAllTicks(2);

    expect(hookCalled).toBe(false);
    expect(FP.ToFloat(facade.getAttribute(caster.id, 'Mana').current)).toBe(100);
    world.dispose();
  });
});

describe('TargetResolver — Point target shape', () => {
  it("Point target resolves to an empty target list; the providedTarget is passed to the hook", () => {
    const { world, facade } = createTestWorld({
      abilities: [
        defineAbility({
          id: 'Ability.Rocket',
          target: { kind: 'Point', origin: { kind: 'Caller' } },
          hookId: 'Hook.Rocket',
        }),
      ],
    });
    const caster = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    world.processAllTicks(1);

    let observed: { resolvedTargets: number[]; x?: FixedPoint; z?: FixedPoint } | undefined;
    facade.registerHook('Hook.Rocket', ctx => {
      observed = {
        resolvedTargets: [...ctx.resolvedTargets],
        x: ctx.providedTarget?.x,
        z: ctx.providedTarget?.z,
      };
    });

    facade.activateAbility(caster.id, 'Ability.Rocket', {
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

// ---------------------------------------------------------------------------
// Test world helper
// ---------------------------------------------------------------------------

interface TestWorldOpts {
  effects?: readonly ReturnType<typeof defineEffect>[];
  abilities?: readonly ReturnType<typeof defineAbility>[];
  skipSpatial?: boolean;
}

interface TestWorld {
  world: GameWorld;
  facade: AbilitySystemFacade;
  registries: AbilitySystemRegistries;
  runtime: AbilitySystemRuntime;
  spatial: FakeSpatialQuery;
}

class FakeSpatialQuery implements ISpatialQuery {
  private queryFn: (x: FixedPoint, z: FixedPoint, r: FixedPoint) => number[] = () => [];
  private positions = new Map<number, { x: FixedPoint; z: FixedPoint }>();

  public queryRadius(x: FixedPoint, z: FixedPoint, radius: FixedPoint): number[] {
    return this.queryFn(x, z, radius);
  }

  public getEntityPosition(
    entityId: number
  ): { x: FixedPoint; z: FixedPoint } | undefined {
    return this.positions.get(entityId);
  }

  public setQuery(fn: (x: FixedPoint, z: FixedPoint, r: FixedPoint) => number[]): void {
    this.queryFn = fn;
  }

  public setPosition(entityId: number, pos: { x: FixedPoint; z: FixedPoint }): void {
    this.positions.set(entityId, pos);
  }

  public clearPositions(): void {
    this.positions.clear();
  }
}

function createTestWorld(opts: TestWorldOpts = {}): TestWorld {
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

  // Two effects every test uses.
  registries.effects.register(
    defineEffect({
      id: 'Effect.Explosion',
      type: 'Instant',
      modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-50) }],
    })
  );
  registries.effects.register(
    defineEffect({
      id: 'Effect.Heal',
      type: 'Instant',
      modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(20) }],
    })
  );

  for (const effect of opts.effects ?? []) {
    registries.effects.register(effect);
  }
  for (const ability of opts.abilities ?? []) {
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
  world.registerSystems(
    [
      new AbilityActivationSystem(registries, runtime),
      new EffectApplicationSystem(registries, runtime),
      new AbilityHookExecutorSystem(registries, runtime),
      new EffectTickSystem(registries),
      new AttributeAggregationSystem(registries),
    ],
    []
  );
  const facade = new AbilitySystemFacade(world.entityManager, registries, runtime);
  const spatial = new FakeSpatialQuery();
  if (!opts.skipSpatial) {
    facade.registerSpatialQuery(spatial);
  }
  return { world, facade, registries, runtime, spatial };
}

function addEntity(world: GameWorld): Entity {
  const entity = new Entity();
  world.entityManager.addEntity(entity);
  return entity;
}
