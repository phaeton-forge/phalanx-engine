import { describe, expect, it } from 'vitest';
import { Entity, GameWorld } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import type { FixedPoint } from 'phalanx-math';
import {
  AbilitiesComponentType,
  AbilitySystemFacade,
  AttributeAggregationSystem,
  AuraTickSystem,
  EffectApplicationSystem,
  EffectTickSystem,
  createAbilitySystemRegistries,
  createAbilitySystemRuntime,
  defineAttribute,
  defineEffect,
} from '../src';
import type {
  AbilitySystemRegistries,
  AbilitySystemRuntime,
  AuraComponent,
  ISpatialQuery,
} from '../src';

// ---------------------------------------------------------------------------
// Stage 7 — Auras (persistent AoE zones)
//
// Auras are long-lived entities that re-resolve their TargetSpec every
// `periodTicks` and apply Instant effects to each resolved target. Lifetime
// is tag-driven: a Duration-typed effect on the zone entity grants the
// lifetime tag; when the tag is revoked (because the effect expired or
// user code force-removed it), AuraTickSystem despawns the zone.
//
// The tests below cover the three scenarios called out in the plan:
//   - healing aura: Self / Radius / heals allies, observable over ticks
//   - aura with tag filter: only entities matching `tagsRequired` get hit
//   - lifetime expiry: when the lifetime tag is revoked the zone entity
//     is removed from the world, AND firing stops on the boundary tick
//
// Plus supporting behaviour: scheduling cadence, dedup against duplicate
// entries from the spatial query, and the "no aura, no work" baseline.
// ---------------------------------------------------------------------------

describe('AuraComponent + AuraTickSystem — healing aura', () => {
  it('applies the heal Instant effect to every resolved target every periodTicks', () => {
    // Two allies + one enemy positioned around the caster; healing aura
    // targets allies in a 10-unit radius, period 3 ticks, healing +5.
    // We damage the allies first so the heal is observable (Health is
    // clamped at the 100 max).
    const { world, facade, spatial } = createTestWorld();
    const caster = addEntity(world);
    const ally1 = addEntity(world);
    const ally2 = addEntity(world);
    const enemy = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    facade.initAttributesForEntity(ally1.id);
    facade.initAttributesForEntity(ally2.id);
    facade.initAttributesForEntity(enemy.id);
    facade.addTag(caster.id, 'Team.Ally');
    facade.addTag(ally1.id, 'Team.Ally');
    facade.addTag(ally2.id, 'Team.Ally');
    facade.addTag(enemy.id, 'Team.Enemy');
    world.processAllTicks(1);

    // Drop allies to 50 HP so a +5 heal is visible (otherwise the 100
    // clamp would mask it).
    facade.applyEffect(ally1.id, 'Effect.Damage50');
    facade.applyEffect(ally2.id, 'Effect.Damage50');
    facade.applyEffect(caster.id, 'Effect.Damage50');
    world.processAllTicks(2);
    expect(FP.ToFloat(facade.getAttribute(ally1.id, 'Health').current)).toBe(50);
    expect(FP.ToFloat(facade.getAttribute(ally2.id, 'Health').current)).toBe(50);

    // Spatial query returns all four entities — the aura's filter is
    // what excludes the enemy.
    spatial.setQuery(() => [caster.id, ally1.id, ally2.id, enemy.id]);

    // Spawn the aura as the caster would inside a hook. The zone entity
    // itself is what the spatial query centres on, so we register the
    // zone's position with the fake adapter.
    const zone = facade.spawnAura({
      abilityId: 'Ability.HealingAura',
      target: {
        kind: 'Radius',
        origin: { kind: 'TargetEntity', entityId: 0 }, // overwritten below
        radius: FP.FromInt(10),
        filter: { tagsRequired: ['Team.Ally'] },
        includeSelf: true,
      } as const,
      effectIds: ['Effect.Heal5'],
      periodTicks: 3,
      ownerEntityId: caster.id,
      lifetimeEffectId: 'Effect.HealingAura.Lifetime',
      lifetimeTag: 'Aura.HealingAura.Active',
    });
    // The aura's target origin is TargetEntity(zone.id) — patch it
    // post-spawn because zone.id isn't known until spawnAura returns.
    // We rebuild a new component with the correct target rather than
    // mutating a readonly field. (In production, hook code would
    // compute the correct id before spawnAura; this is a test seam.)
    rewireAuraTarget(zone, {
      kind: 'Radius',
      origin: { kind: 'TargetEntity', entityId: zone.id },
      radius: FP.FromInt(10),
      filter: { tagsRequired: ['Team.Ally'] },
      includeSelf: true,
    });
    spatial.setPosition(zone.id, { x: FP.FromInt(0), z: FP.FromInt(0) });

    // Tick 3: spawnAura happened after tick 2 was processed, so the
    // facade buffered nextTick=3. On this tick EffectApplicationSystem
    // grants the lifetime tag and AuraTickSystem fires for the first
    // time, enqueuing the heal onto each ally + caster as pendingAdd.
    world.processAllTicks(3);
    expect(facade.hasTag(zone.id, 'Aura.HealingAura.Active')).toBe(true);
    // Targets still at 50 — the heal pendingAdd will be processed on
    // the NEXT tick (matching the standard pendingAdd cadence).
    expect(FP.ToFloat(facade.getAttribute(ally1.id, 'Health').current)).toBe(50);

    // Tick 4: EffectApplicationSystem applies the heal; allies and
    // caster climb to 55. Enemy is untouched.
    world.processAllTicks(4);
    expect(FP.ToFloat(facade.getAttribute(ally1.id, 'Health').current)).toBe(55);
    expect(FP.ToFloat(facade.getAttribute(ally2.id, 'Health').current)).toBe(55);
    expect(FP.ToFloat(facade.getAttribute(caster.id, 'Health').current)).toBe(55);
    expect(FP.ToFloat(facade.getAttribute(enemy.id, 'Health').current)).toBe(100);

    // Tick 5 / 6: no fire (period is 3, next fire at tick 6).
    world.processAllTicks(5);
    expect(FP.ToFloat(facade.getAttribute(ally1.id, 'Health').current)).toBe(55);
    world.processAllTicks(6);
    // Tick 6 is the second fire; targets still at 55 until tick 7
    // applies the pendingAdd.
    expect(FP.ToFloat(facade.getAttribute(ally1.id, 'Health').current)).toBe(55);
    world.processAllTicks(7);
    expect(FP.ToFloat(facade.getAttribute(ally1.id, 'Health').current)).toBe(60);
    expect(FP.ToFloat(facade.getAttribute(ally2.id, 'Health').current)).toBe(60);
    expect(FP.ToFloat(facade.getAttribute(enemy.id, 'Health').current)).toBe(100);

    world.dispose();
  });

  it('respects tagsRequired on the aura target spec (heal goes to allies only)', () => {
    // Same shape as the previous test but uses two allies and two
    // enemies — purely to assert the filter contract under a tighter
    // setup. The previous test focuses on cadence; this one on filter.
    const { world, facade, spatial } = createTestWorld();
    const caster = addEntity(world);
    const ally = addEntity(world);
    const enemyA = addEntity(world);
    const enemyB = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    facade.initAttributesForEntity(ally.id);
    facade.initAttributesForEntity(enemyA.id);
    facade.initAttributesForEntity(enemyB.id);
    facade.addTag(ally.id, 'Team.Ally');
    facade.addTag(enemyA.id, 'Team.Enemy');
    facade.addTag(enemyB.id, 'Team.Enemy');
    world.processAllTicks(1);

    facade.applyEffect(ally.id, 'Effect.Damage50');
    facade.applyEffect(enemyA.id, 'Effect.Damage50');
    facade.applyEffect(enemyB.id, 'Effect.Damage50');
    world.processAllTicks(2);
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(50);

    spatial.setQuery(() => [ally.id, enemyA.id, enemyB.id]);

    const zone = facade.spawnAura({
      abilityId: 'Ability.HealingAura',
      target: {
        kind: 'Radius',
        origin: { kind: 'TargetEntity', entityId: 0 },
        radius: FP.FromInt(10),
        filter: { tagsRequired: ['Team.Ally'] },
      },
      effectIds: ['Effect.Heal5'],
      periodTicks: 1,
      ownerEntityId: caster.id,
      lifetimeEffectId: 'Effect.HealingAura.Lifetime',
      lifetimeTag: 'Aura.HealingAura.Active',
    });
    rewireAuraTarget(zone, {
      kind: 'Radius',
      origin: { kind: 'TargetEntity', entityId: zone.id },
      radius: FP.FromInt(10),
      filter: { tagsRequired: ['Team.Ally'] },
    });
    spatial.setPosition(zone.id, { x: FP.FromInt(0), z: FP.FromInt(0) });

    // Tick 3: first fire (period 1 → fires every tick).
    world.processAllTicks(3);
    // Tick 4: heal applied to ally only.
    world.processAllTicks(4);
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(55);
    expect(FP.ToFloat(facade.getAttribute(enemyA.id, 'Health').current)).toBe(50);
    expect(FP.ToFloat(facade.getAttribute(enemyB.id, 'Health').current)).toBe(50);

    world.dispose();
  });
});

describe('AuraComponent + AuraTickSystem — lifetime management', () => {
  it('despawns the zone entity when the lifetime tag is revoked by natural Duration expiry', () => {
    // Lifetime effect duration is 4 ticks; the aura fires every 2.
    // After the Duration expires, the next AuraTickSystem pass must
    // remove the zone entity.
    const { world, facade, spatial, registries } = createTestWorld();
    registries.effects.register(
      defineEffect({
        id: 'Effect.ShortAura.Lifetime',
        type: 'Duration',
        durationTicks: 4,
        tagsGranted: ['Aura.Short.Active'],
      })
    );

    const caster = addEntity(world);
    const ally = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    facade.initAttributesForEntity(ally.id);
    facade.addTag(ally.id, 'Team.Ally');
    facade.applyEffect(ally.id, 'Effect.Damage50');
    world.processAllTicks(1);
    world.processAllTicks(2);
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(50);

    spatial.setQuery(() => [ally.id]);

    const zone = facade.spawnAura({
      abilityId: 'Ability.ShortAura',
      target: {
        kind: 'Radius',
        origin: { kind: 'TargetEntity', entityId: 0 },
        radius: FP.FromInt(10),
        filter: { tagsRequired: ['Team.Ally'] },
      },
      effectIds: ['Effect.Heal5'],
      periodTicks: 2,
      ownerEntityId: caster.id,
      lifetimeEffectId: 'Effect.ShortAura.Lifetime',
      lifetimeTag: 'Aura.Short.Active',
    });
    rewireAuraTarget(zone, {
      kind: 'Radius',
      origin: { kind: 'TargetEntity', entityId: zone.id },
      radius: FP.FromInt(10),
      filter: { tagsRequired: ['Team.Ally'] },
    });
    spatial.setPosition(zone.id, { x: FP.FromInt(0), z: FP.FromInt(0) });
    const zoneId = zone.id;

    // Sanity: entity exists before the first tick.
    expect(world.entityManager.getEntity(zoneId)).toBeDefined();

    // Tick 3: lifetime tag granted, aura fires (period 2, nextTick=3).
    world.processAllTicks(3);
    expect(facade.hasTag(zoneId, 'Aura.Short.Active')).toBe(true);
    // Tick 4: heal lands → ally 55.
    world.processAllTicks(4);
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(55);
    // Tick 5: aura fires again (period 2, nextTick advanced from 3 → 5).
    world.processAllTicks(5);
    // Tick 6: heal lands → ally 60. Lifetime effect was applied on tick
    // 3 with remainingTicks=4, so it expires on tick 7
    // (3 → +4 = expire at 7).
    world.processAllTicks(6);
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(60);
    // Tick 7: lifetime tag revoked by EffectTickSystem at step 5;
    // AuraTickSystem at step 6 observes the missing tag and despawns
    // the zone. The aura was scheduled to fire on tick 7 (nextTick=7)
    // — but the lifecycle check runs BEFORE the period check, so the
    // boundary fire does NOT happen.
    world.processAllTicks(7);
    expect(world.entityManager.getEntity(zoneId)).toBeUndefined();
    // No additional heal lands on tick 8 either.
    world.processAllTicks(8);
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(60);

    world.dispose();
  });

  it('despawns the zone when user code force-removes the lifetime tag mid-life', () => {
    // removeEffectsByTag on the zone simulates "player toggled the
    // channeled aura off" — the aura must die on the next aura tick.
    const { world, facade, spatial } = createTestWorld();
    const caster = addEntity(world);
    const ally = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    facade.initAttributesForEntity(ally.id);
    facade.addTag(ally.id, 'Team.Ally');
    facade.applyEffect(ally.id, 'Effect.Damage50');
    world.processAllTicks(1);
    world.processAllTicks(2);

    spatial.setQuery(() => [ally.id]);

    const zone = facade.spawnAura({
      abilityId: 'Ability.HealingAura',
      target: {
        kind: 'Radius',
        origin: { kind: 'TargetEntity', entityId: 0 },
        radius: FP.FromInt(10),
        filter: { tagsRequired: ['Team.Ally'] },
      },
      effectIds: ['Effect.Heal5'],
      periodTicks: 1,
      ownerEntityId: caster.id,
      lifetimeEffectId: 'Effect.HealingAura.Lifetime',
      lifetimeTag: 'Aura.HealingAura.Active',
    });
    rewireAuraTarget(zone, {
      kind: 'Radius',
      origin: { kind: 'TargetEntity', entityId: zone.id },
      radius: FP.FromInt(10),
      filter: { tagsRequired: ['Team.Ally'] },
    });
    spatial.setPosition(zone.id, { x: FP.FromInt(0), z: FP.FromInt(0) });

    world.processAllTicks(3);
    expect(facade.hasTag(zone.id, 'Aura.HealingAura.Active')).toBe(true);
    world.processAllTicks(4);
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(55);

    // Force-remove the lifetime tag. removeEffectsByTag flags the
    // duration instance for removal; EffectTickSystem revokes the
    // tag on the next tick.
    const flagged = facade.removeEffectsByTag(zone.id, 'Aura.HealingAura.Active');
    expect(flagged).toBe(1);

    // Tick 5: EffectTickSystem revokes the tag at step 5; AuraTickSystem
    // at step 6 sees the missing tag and despawns the zone. The heal
    // enqueued during tick 4 still lands this tick via
    // EffectApplicationSystem (which runs before AuraTick), bringing
    // ally to 60 — that fire was already committed before the tag was
    // revoked.
    world.processAllTicks(5);
    expect(world.entityManager.getEntity(zone.id)).toBeUndefined();
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(60);
    // No further heals — ally stays at 60 once the zone is gone.
    world.processAllTicks(6);
    world.processAllTicks(7);
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(60);

    world.dispose();
  });

  it('persists indefinitely when no lifetimeTag is configured', () => {
    // Some auras (e.g. world hazards) should never expire on their own.
    // Omitting `lifetimeTag` should skip the lifecycle check entirely.
    const { world, facade, spatial } = createTestWorld();
    const caster = addEntity(world);
    const ally = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    facade.initAttributesForEntity(ally.id);
    facade.addTag(ally.id, 'Team.Ally');
    facade.applyEffect(ally.id, 'Effect.Damage50');
    world.processAllTicks(1);
    world.processAllTicks(2);

    spatial.setQuery(() => [ally.id]);

    const zone = facade.spawnAura({
      abilityId: 'Ability.EternalAura',
      target: {
        kind: 'Radius',
        origin: { kind: 'TargetEntity', entityId: 0 },
        radius: FP.FromInt(10),
        filter: { tagsRequired: ['Team.Ally'] },
      },
      effectIds: ['Effect.Heal5'],
      periodTicks: 1,
      ownerEntityId: caster.id,
      // No lifetimeEffectId / lifetimeTag.
    });
    rewireAuraTarget(zone, {
      kind: 'Radius',
      origin: { kind: 'TargetEntity', entityId: zone.id },
      radius: FP.FromInt(10),
      filter: { tagsRequired: ['Team.Ally'] },
    });
    spatial.setPosition(zone.id, { x: FP.FromInt(0), z: FP.FromInt(0) });

    // 10 heals over ticks 3..12 (period 1, first fire at tick 3 with
    // nextTick=currentTick+1=3). Each fire enqueues a heal that lands
    // on the FOLLOWING tick (pendingAdd cadence), so by the end of tick
    // 12 only 9 heals have actually been applied (the fire on tick 12
    // itself lands on tick 13). Run through tick 13 to cover the full
    // 10 heals (+50 → clamped at 100).
    for (let tick = 3; tick <= 13; tick++) {
      world.processAllTicks(tick);
    }
    expect(world.entityManager.getEntity(zone.id)).toBeDefined();
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(100);

    world.dispose();
  });
});

describe('AuraComponent + AuraTickSystem — validation and edge cases', () => {
  it('AuraComponent rejects non-positive periodTicks', () => {
    const { world, facade } = createTestWorld();
    addEntity(world);
    world.processAllTicks(1);

    expect(() =>
      facade.spawnAura({
        abilityId: 'Ability.Bad',
        target: { kind: 'Self' },
        effectIds: ['Effect.Heal5'],
        periodTicks: 0,
        ownerEntityId: 1,
      })
    ).toThrow(/periodTicks/);

    world.dispose();
  });

  it('AuraComponent rejects an empty effectIds list', () => {
    const { world, facade } = createTestWorld();
    addEntity(world);
    world.processAllTicks(1);

    expect(() =>
      facade.spawnAura({
        abilityId: 'Ability.Bad',
        target: { kind: 'Self' },
        effectIds: [],
        periodTicks: 1,
        ownerEntityId: 1,
      })
    ).toThrow(/effectIds/);

    world.dispose();
  });

  it('spawnAura rejects unknown effect ids up front (clear spawn-site error)', () => {
    const { world, facade } = createTestWorld();
    addEntity(world);
    world.processAllTicks(1);

    expect(() =>
      facade.spawnAura({
        abilityId: 'Ability.Bad',
        target: { kind: 'Self' },
        effectIds: ['Effect.NoSuchThing'],
        periodTicks: 1,
        ownerEntityId: 1,
      })
    ).toThrow(/Effect\.NoSuchThing/);

    world.dispose();
  });

  it('spawnAura rejects an unknown lifetimeEffectId up front', () => {
    const { world, facade } = createTestWorld();
    addEntity(world);
    world.processAllTicks(1);

    expect(() =>
      facade.spawnAura({
        abilityId: 'Ability.Bad',
        target: { kind: 'Self' },
        effectIds: ['Effect.Heal5'],
        periodTicks: 1,
        ownerEntityId: 1,
        lifetimeEffectId: 'Effect.NoSuchLifetime',
        lifetimeTag: 'Aura.Bad.Active',
      })
    ).toThrow(/Effect\.NoSuchLifetime/);

    world.dispose();
  });

  it('AuraTickSystem throws if the target spec resolves to dropped (Caller origin)', () => {
    // Caller origin requires a providedTarget at activation time — auras
    // run inside the system loop with no caller, so this must be a
    // programming error, not a silent drop.
    const { world, facade } = createTestWorld();
    const caster = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    world.processAllTicks(1);

    facade.spawnAura({
      abilityId: 'Ability.MisconfiguredAura',
      target: { kind: 'Radius', origin: { kind: 'Caller' }, radius: FP.FromInt(10) },
      effectIds: ['Effect.Heal5'],
      periodTicks: 1,
      ownerEntityId: caster.id,
    });

    expect(() => world.processAllTicks(2)).toThrow(/auras must not use TargetOrigin\.kind === "Caller"/);

    world.dispose();
  });

  it('processes auras with no resolved targets without error (legitimate empty fire)', () => {
    // Empty radius is a legal outcome — e.g. an enemy walked out. The
    // aura must keep ticking and not throw.
    const { world, facade, spatial } = createTestWorld();
    const caster = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    world.processAllTicks(1);

    spatial.setQuery(() => []);

    const zone = facade.spawnAura({
      abilityId: 'Ability.EmptyAura',
      target: {
        kind: 'Radius',
        origin: { kind: 'TargetEntity', entityId: 0 },
        radius: FP.FromInt(10),
      },
      effectIds: ['Effect.Heal5'],
      periodTicks: 1,
      ownerEntityId: caster.id,
    });
    rewireAuraTarget(zone, {
      kind: 'Radius',
      origin: { kind: 'TargetEntity', entityId: zone.id },
      radius: FP.FromInt(10),
    });
    spatial.setPosition(zone.id, { x: FP.FromInt(0), z: FP.FromInt(0) });

    // Three ticks of empty fires — should be a no-op.
    world.processAllTicks(2);
    world.processAllTicks(3);
    world.processAllTicks(4);
    expect(world.entityManager.getEntity(zone.id)).toBeDefined();

    world.dispose();
  });
});

describe('AuraComponent + AuraTickSystem — Self target spec', () => {
  it('a Self-targeted aura applies its effects to the zone entity itself', () => {
    // Degenerate case: aura whose target spec is Self. The system feeds
    // `casterEntityId: zone.id` to the resolver, so Self → the zone
    // itself. Useful for area-of-effect entities that buff themselves
    // (e.g. a totem that pulses its own buffs to drive cues).
    const { world, facade } = createTestWorld();
    const caster = addEntity(world);
    facade.initAttributesForEntity(caster.id);
    world.processAllTicks(1);

    // Spawn the aura with target Self and explicitly initialise the
    // zone's attributes so the heal is observable.
    const zone = facade.spawnAura({
      abilityId: 'Ability.SelfPulse',
      target: { kind: 'Self' },
      effectIds: ['Effect.Heal5'],
      periodTicks: 1,
      ownerEntityId: caster.id,
    });
    facade.initAttributesForEntity(zone.id);
    facade.applyEffect(zone.id, 'Effect.Damage50');

    // Tick 2: damage applied, aura fires (heal enqueued).
    world.processAllTicks(2);
    expect(FP.ToFloat(facade.getAttribute(zone.id, 'Health').current)).toBe(50);
    // Tick 3: heal lands → 55.
    world.processAllTicks(3);
    expect(FP.ToFloat(facade.getAttribute(zone.id, 'Health').current)).toBe(55);

    world.dispose();
  });
});

// ---------------------------------------------------------------------------
// Stage 7 Copilot review #36 — additional validation paths in spawnAura
//
// These tests cover the three validation tightenings landed after the
// initial Stage 7 review:
//   - line 541: aura effects must be Instant (Duration/Periodic rejected)
//   - line 546: lifetimeEffectId must be paired with lifetimeTag AND the
//     effect's tagsGranted must include that tag
//   - line 550: validation runs BEFORE addEntity, so a thrown error must
//     not leave a zombie zone entity in the world
// ---------------------------------------------------------------------------

describe('spawnAura — Stage 7 review validation', () => {
  it('rejects non-Instant effects in effectIds (Duration would stack on every fire)', () => {
    // Effect.HealingAura.Lifetime is a Duration effect, registered by
    // createTestWorld for the lifetime-tag tests. Reusing it as an
    // aura effect is exactly the misconfiguration the validation
    // exists to catch.
    const { world, facade } = createTestWorld();
    addEntity(world);
    world.processAllTicks(1);

    expect(() =>
      facade.spawnAura({
        abilityId: 'Ability.BadInstant',
        target: { kind: 'Self' },
        effectIds: ['Effect.HealingAura.Lifetime'],
        periodTicks: 1,
        ownerEntityId: 1,
      })
    ).toThrow(/non-Instant/);

    world.dispose();
  });

  it('rejects lifetimeEffectId without a paired lifetimeTag', () => {
    // lifetimeEffectId by itself is a silent footgun: the lifetime
    // effect would run (and grant whatever tags it lists), but no
    // tag is being watched, so the aura would persist forever.
    const { world, facade } = createTestWorld();
    addEntity(world);
    world.processAllTicks(1);

    expect(() =>
      facade.spawnAura({
        abilityId: 'Ability.MissingTag',
        target: { kind: 'Self' },
        effectIds: ['Effect.Heal5'],
        periodTicks: 1,
        ownerEntityId: 1,
        lifetimeEffectId: 'Effect.HealingAura.Lifetime',
        // lifetimeTag intentionally omitted.
      })
    ).toThrow(/lifetimeTag/);

    world.dispose();
  });

  it('rejects lifetimeEffectId whose tagsGranted does not include lifetimeTag', () => {
    // The lifetime effect exists and grants a tag, but the user has
    // configured a DIFFERENT lifetimeTag to watch. Without this check
    // the aura would despawn on its very first tick because the
    // watched tag is never granted by anyone.
    const { world, facade } = createTestWorld();
    addEntity(world);
    world.processAllTicks(1);

    expect(() =>
      facade.spawnAura({
        abilityId: 'Ability.MismatchedTag',
        target: { kind: 'Self' },
        effectIds: ['Effect.Heal5'],
        periodTicks: 1,
        ownerEntityId: 1,
        // Effect.HealingAura.Lifetime grants 'Aura.HealingAura.Active'.
        lifetimeEffectId: 'Effect.HealingAura.Lifetime',
        lifetimeTag: 'Aura.SomeOther.Active',
      })
    ).toThrow(/does not grant/);

    world.dispose();
  });

  it('allows lifetimeTag without lifetimeEffectId (caller manages the tag manually)', () => {
    // The reverse pairing is legitimate: a caller may want to grant
    // the watched tag via applyEffect / addTag after spawnAura
    // returns. This must NOT throw.
    const { world, facade } = createTestWorld();
    const caster = addEntity(world);
    world.processAllTicks(1);

    expect(() =>
      facade.spawnAura({
        abilityId: 'Ability.ManualTagAura',
        target: { kind: 'Self' },
        effectIds: ['Effect.Heal5'],
        periodTicks: 1,
        ownerEntityId: caster.id,
        // No lifetimeEffectId — caller will grant/revoke the tag.
        lifetimeTag: 'Aura.Manual.Active',
      })
    ).not.toThrow();

    world.dispose();
  });

  it('does not leave a zombie zone entity in the world when validation throws', () => {
    // The whole point of the validation phase is that addEntity must
    // not have been called when we throw. Count entities before and
    // after to confirm no zombie zone was created.
    const { world, facade } = createTestWorld();
    const caster = addEntity(world);
    world.processAllTicks(1);

    const entitiesBefore = world.entityManager.getAllEntities().length;

    // Trigger every validation throw — each must leave entity count
    // unchanged. We use the same shape as the dedicated tests above
    // but inline them here so a single regression (e.g. someone
    // moving addEntity back above validation) shows up as a count
    // mismatch on whichever throw they reorder.
    expect(() =>
      facade.spawnAura({
        abilityId: 'Ability.Z1',
        target: { kind: 'Self' },
        effectIds: ['Effect.NoSuchThing'],
        periodTicks: 1,
        ownerEntityId: caster.id,
      })
    ).toThrow();
    expect(world.entityManager.getAllEntities().length).toBe(entitiesBefore);

    expect(() =>
      facade.spawnAura({
        abilityId: 'Ability.Z2',
        target: { kind: 'Self' },
        effectIds: ['Effect.HealingAura.Lifetime'],
        periodTicks: 1,
        ownerEntityId: caster.id,
      })
    ).toThrow(/non-Instant/);
    expect(world.entityManager.getAllEntities().length).toBe(entitiesBefore);

    expect(() =>
      facade.spawnAura({
        abilityId: 'Ability.Z3',
        target: { kind: 'Self' },
        effectIds: ['Effect.Heal5'],
        periodTicks: 1,
        ownerEntityId: caster.id,
        lifetimeEffectId: 'Effect.HealingAura.Lifetime',
        lifetimeTag: 'Aura.Wrong.Active',
      })
    ).toThrow(/does not grant/);
    expect(world.entityManager.getAllEntities().length).toBe(entitiesBefore);

    world.dispose();
  });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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
}

function createTestWorld(): TestWorld {
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
      id: 'Effect.Heal5',
      type: 'Instant',
      modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(5) }],
    })
  );
  registries.effects.register(
    defineEffect({
      id: 'Effect.Damage50',
      type: 'Instant',
      modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-50) }],
    })
  );
  // Healing-aura lifetime: long enough for the cadence tests (8 ticks).
  registries.effects.register(
    defineEffect({
      id: 'Effect.HealingAura.Lifetime',
      type: 'Duration',
      durationTicks: 100,
      tagsGranted: ['Aura.HealingAura.Active'],
    })
  );

  const runtime = createAbilitySystemRuntime();
  const world = new GameWorld({
    componentTypes: [
      AbilitiesComponentType.Attributes,
      AbilitiesComponentType.ActiveEffects,
      AbilitiesComponentType.GameplayTags,
      AbilitiesComponentType.Aura,
    ],
  });
  // Stage 7 doesn't need the ability activation pipeline — only the
  // effect application + tick + aura pipeline. Mirror the plan's per-tick
  // order: application → effect tick → aura tick → aggregation.
  world.registerSystems(
    [
      new EffectApplicationSystem(registries, runtime),
      new EffectTickSystem(registries),
      new AuraTickSystem(registries, runtime),
      new AttributeAggregationSystem(registries),
    ],
    []
  );
  const facade = new AbilitySystemFacade(world.entityManager, registries, runtime);
  const spatial = new FakeSpatialQuery();
  facade.registerSpatialQuery(spatial);
  return { world, facade, registries, runtime, spatial };
}

function addEntity(world: GameWorld): Entity {
  const entity = new Entity();
  world.entityManager.addEntity(entity);
  return entity;
}

/**
 * AuraComponent.target is declared readonly so legitimate user code
 * cannot drift it mid-flight. Tests, however, need to fix up the
 * `TargetEntity.entityId` reference after spawnAura returns the
 * zone id. Going through `Object.defineProperty` is the smallest
 * possible hack that keeps the production API honest while still
 * letting the test suite reach the post-spawn id.
 */
function rewireAuraTarget(zone: Entity, target: AuraComponent['target']): void {
  const aura = zone.getComponent<AuraComponent>(AbilitiesComponentType.Aura);
  if (!aura) {
    throw new Error('rewireAuraTarget: zone has no AuraComponent');
  }
  Object.defineProperty(aura, 'target', { value: target, writable: false });
}
