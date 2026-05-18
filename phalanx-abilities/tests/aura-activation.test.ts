import { describe, expect, it } from 'vitest';
import { Entity, GameWorld } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import type { FixedPoint } from 'phalanx-math';
import {
  AbilitiesComponentType,
  AbilitySystemFacade,
  AttributeAggregationSystem,
  AuraComponent,
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
  ISpatialQuery,
} from '../src';

// ---------------------------------------------------------------------------
// Stage 7.1 — Aura activation gates
//
// Two independent gates layered on top of the Stage 7 cadence:
//   - isActive (imperative): mutated via facade.setAuraActive
//   - requiredTag (declarative): gameplay tag on the carrier
//
// Both gates short-circuit the period check WITHOUT advancing nextTick, so
// pausing then resuming preserves the original cadence — there is no
// "catch-up burst" of fires for the paused interval. This is the key
// anti-exploit property: a player rapidly toggling an aura on/off cannot
// fire faster than `periodTicks` would normally allow.
// ---------------------------------------------------------------------------

describe('AuraTickSystem — isActive gate', () => {
  it('does not fire while isActive is false; resumes original cadence when re-enabled', () => {
    // periodTicks=2. Spawn at tick 2 → nextTick=3 → first fire tick 3,
    // heal lands tick 4 (ally 50→55). Disable BEFORE tick 5 (the next
    // scheduled fire); nextTick stays at 5 while the aura is dormant.
    // After re-enabling at tick 8, the aura fires on the very next tick
    // (8 >= nextTick=5), and on its own schedule from there.
    const { world, facade, spatial } = createTestWorld();
    const ally = addEntity(world);
    facade.initAttributesForEntity(ally.id);
    facade.addTag(ally.id, 'Team.Ally');
    facade.applyEffect(ally.id, 'Effect.Damage50');
    world.processAllTicks(1);
    world.processAllTicks(2);
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(50);

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
      periodTicks: 2,
      ownerEntityId: ally.id,
    });
    rewireAuraTarget(zone, {
      kind: 'Radius',
      origin: { kind: 'TargetEntity', entityId: zone.id },
      radius: FP.FromInt(10),
      filter: { tagsRequired: ['Team.Ally'] },
    });
    spatial.setPosition(zone.id, { x: FP.FromInt(0), z: FP.FromInt(0) });

    // Tick 3: aura fires; heal queued. nextTick → 5.
    world.processAllTicks(3);
    // Tick 4: heal lands.
    world.processAllTicks(4);
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(55);

    // Disable before tick 5 (the next scheduled fire). Aura must NOT
    // fire on tick 5; nextTick must NOT advance.
    facade.setAuraActive(zone.id, false);
    const auraComp = world.entityManager
      .getEntity(zone.id)!
      .getComponent<AuraComponent>(AbilitiesComponentType.Aura)!;
    expect(auraComp.nextTick).toBe(5);

    // Run several ticks dormant — no heal should land.
    world.processAllTicks(5);
    world.processAllTicks(6);
    world.processAllTicks(7);
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(55);
    // nextTick preserved (no advancement while dormant).
    expect(auraComp.nextTick).toBe(5);

    // Re-enable at tick 7 (between processAllTicks(7) and (8)). Tick 8
    // fires (8 >= 5); heal queued. nextTick → 5 + 2*ceil = the next
    // multiple of 2 ≥ 8+1. Actually the catch-up while-loop fires once
    // and stops when nextTick > tick: from 5 → 7 (8>=7, fire again) → 9.
    // So tick 8 fires TWICE (catch-up for missed periods 5 and 7).
    // That's the documented "catch-up after long pause" behaviour. The
    // test for "fresh schedule" (no catch-up) is the next case below.
    facade.setAuraActive(zone.id, true);
    world.processAllTicks(8);
    // Two fires on tick 8 → two heals queued. They land tick 9.
    world.processAllTicks(9);
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(65);

    world.dispose();
  });

  it('resetSchedule: true skips catch-up and reschedules one period from now', () => {
    // Same setup, but re-enable with resetSchedule. After the long
    // pause, nextTick should be reset to currentTick + periodTicks so
    // only ONE fire happens on the next period boundary, not a catch-up
    // burst.
    const { world, facade, spatial } = createTestWorld();
    const ally = addEntity(world);
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
      periodTicks: 2,
      ownerEntityId: ally.id,
    });
    rewireAuraTarget(zone, {
      kind: 'Radius',
      origin: { kind: 'TargetEntity', entityId: zone.id },
      radius: FP.FromInt(10),
      filter: { tagsRequired: ['Team.Ally'] },
    });
    spatial.setPosition(zone.id, { x: FP.FromInt(0), z: FP.FromInt(0) });

    world.processAllTicks(3); // fire → heal queued
    world.processAllTicks(4); // heal lands (50→55)
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(55);

    facade.setAuraActive(zone.id, false);
    world.processAllTicks(5);
    world.processAllTicks(6);
    world.processAllTicks(7);
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(55);

    // runtime.currentTick is 7 at this point. resetSchedule pushes
    // nextTick to 7 + 2 = 9. Tick 8: gate open, but 8 < 9 → no fire.
    // Tick 9: fire (9 >= 9), heal queued. nextTick → 11. Tick 10: heal
    // lands → 60.
    facade.setAuraActive(zone.id, true, { resetSchedule: true });
    const auraComp = world.entityManager
      .getEntity(zone.id)!
      .getComponent<AuraComponent>(AbilitiesComponentType.Aura)!;
    expect(auraComp.nextTick).toBe(9);

    world.processAllTicks(8);
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(55);
    world.processAllTicks(9);
    world.processAllTicks(10);
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(60);

    world.dispose();
  });

  it('spawning with isActive:false defers all fires until activation', () => {
    // Aura attached but dormant. No heal should occur for many ticks
    // until setAuraActive(true) is called. Verifies isActive is checked
    // on the very first tick.
    const { world, facade, spatial } = createTestWorld();
    const ally = addEntity(world);
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
      ownerEntityId: ally.id,
      isActive: false,
    });
    rewireAuraTarget(zone, {
      kind: 'Radius',
      origin: { kind: 'TargetEntity', entityId: zone.id },
      radius: FP.FromInt(10),
      filter: { tagsRequired: ['Team.Ally'] },
    });
    spatial.setPosition(zone.id, { x: FP.FromInt(0), z: FP.FromInt(0) });

    for (let tick = 3; tick <= 8; tick++) {
      world.processAllTicks(tick);
    }
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(50);

    // Activate at tick 8. With resetSchedule (no catch-up): nextTick →
    // 8 + 1 = 9. Tick 9 fires; tick 10 heal lands.
    facade.setAuraActive(zone.id, true, { resetSchedule: true });
    world.processAllTicks(9);
    world.processAllTicks(10);
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(55);

    world.dispose();
  });

  it('setAuraActive throws when the entity has no AuraComponent', () => {
    const { world, facade } = createTestWorld();
    const plain = addEntity(world);
    world.processAllTicks(1);

    expect(() => facade.setAuraActive(plain.id, false)).toThrow(/AuraComponent/);

    world.dispose();
  });

  it('setAuraActive throws when the entity does not exist', () => {
    const { world, facade } = createTestWorld();
    world.processAllTicks(1);

    expect(() => facade.setAuraActive(9999, false)).toThrow(/Entity 9999/);

    world.dispose();
  });
});

describe('AuraTickSystem — requiredTag gate', () => {
  it('fires only while the carrier entity has the required tag', () => {
    // The aura fires only when the zone carries 'State.AuraActive'.
    // Drive activation purely through addTag/removeTag.
    const { world, facade, spatial } = createTestWorld();
    const ally = addEntity(world);
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
      ownerEntityId: ally.id,
      requiredTag: 'State.AuraActive',
    });
    rewireAuraTarget(zone, {
      kind: 'Radius',
      origin: { kind: 'TargetEntity', entityId: zone.id },
      radius: FP.FromInt(10),
      filter: { tagsRequired: ['Team.Ally'] },
    });
    spatial.setPosition(zone.id, { x: FP.FromInt(0), z: FP.FromInt(0) });

    // No tag yet — aura is gated off despite isActive=true (default).
    // nextTick=3 was scheduled at spawn time but NOT advanced while the
    // gate is closed (gates pause, they don't skip the schedule).
    world.processAllTicks(3);
    world.processAllTicks(4);
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(50);

    // Grant the tag between ticks 4 and 5. The aura now has frozen
    // nextTick=3 and a current tick of 5, which triggers the inherited
    // Stage 7 catch-up while-loop: fires for missed periods 3, 4 AND 5
    // (three heals queued) on a single tick, since periodTicks=1.
    // That is the documented "gate closed, then re-opened" semantics:
    // missed fires are paid back as catch-up. Designers who want
    // "fresh start, no catch-up" should use setAuraActive(..., {
    // resetSchedule: true }) instead of toggling tags.
    facade.addTag(zone.id, 'State.AuraActive');
    world.processAllTicks(5);
    world.processAllTicks(6);
    // Three heals (catch-up for ticks 3, 4, 5) all land tick 6.
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(65);

    // Revoke the tag. Aura goes dormant; nextTick stays where it is.
    // The fire from tick 6 (gate still open, 6>=6, nextTick advanced to
    // 7 inside catch-up loop) is already in pendingAdd and lands tick 7.
    facade.removeTag(zone.id, 'State.AuraActive');
    world.processAllTicks(7);
    // The tick-6 fire's heal landed on tick 7 before the gate-close
    // took effect for tick 7 (the gate check happens at tick 7's aura
    // tick, AFTER the heal was applied in EffectApplicationSystem).
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(70);
    // No further heals from here — gate is closed.
    world.processAllTicks(8);
    world.processAllTicks(9);
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(70);

    world.dispose();
  });

  it('treats a missing GameplayTagsComponent as "tag absent"', () => {
    // Carrier entity has no tags component at all. requiredTag gate
    // must safely return false (not throw, not crash).
    const { world, facade, spatial } = createTestWorld();
    const ally = addEntity(world);
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
      ownerEntityId: ally.id,
      requiredTag: 'State.AuraActive',
      // Note: no lifetimeEffectId / lifetimeTag → no tags component
      // gets created on the zone during spawn. The requiredTag check
      // must therefore handle the missing component case.
    });
    rewireAuraTarget(zone, {
      kind: 'Radius',
      origin: { kind: 'TargetEntity', entityId: zone.id },
      radius: FP.FromInt(10),
      filter: { tagsRequired: ['Team.Ally'] },
    });
    spatial.setPosition(zone.id, { x: FP.FromInt(0), z: FP.FromInt(0) });

    // The zone has no GameplayTagsComponent at all. Several ticks pass
    // with the aura gated off and no exceptions thrown.
    for (let tick = 3; tick <= 8; tick++) {
      world.processAllTicks(tick);
    }
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(50);
    expect(facade.hasTag(zone.id, 'State.AuraActive')).toBe(false);

    world.dispose();
  });
});

describe('AuraTickSystem — combined gates and validation', () => {
  it('both gates must pass: isActive=false suppresses fires even when requiredTag is present', () => {
    const { world, facade, spatial } = createTestWorld();
    const ally = addEntity(world);
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
      ownerEntityId: ally.id,
      requiredTag: 'State.AuraActive',
    });
    rewireAuraTarget(zone, {
      kind: 'Radius',
      origin: { kind: 'TargetEntity', entityId: zone.id },
      radius: FP.FromInt(10),
      filter: { tagsRequired: ['Team.Ally'] },
    });
    spatial.setPosition(zone.id, { x: FP.FromInt(0), z: FP.FromInt(0) });

    // requiredTag set; isActive cleared. Even with the tag granted,
    // fires are suppressed because the imperative gate is closed.
    facade.addTag(zone.id, 'State.AuraActive');
    facade.setAuraActive(zone.id, false);

    for (let tick = 3; tick <= 8; tick++) {
      world.processAllTicks(tick);
    }
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(50);

    world.dispose();
  });

  it('both gates must pass: requiredTag missing suppresses fires even when isActive=true', () => {
    const { world, facade, spatial } = createTestWorld();
    const ally = addEntity(world);
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
      ownerEntityId: ally.id,
      requiredTag: 'State.AuraActive',
      // isActive defaults to true.
    });
    rewireAuraTarget(zone, {
      kind: 'Radius',
      origin: { kind: 'TargetEntity', entityId: zone.id },
      radius: FP.FromInt(10),
      filter: { tagsRequired: ['Team.Ally'] },
    });
    spatial.setPosition(zone.id, { x: FP.FromInt(0), z: FP.FromInt(0) });

    // Tag never granted: aura sits idle even with isActive=true.
    for (let tick = 3; tick <= 8; tick++) {
      world.processAllTicks(tick);
    }
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(50);

    world.dispose();
  });

  it('AuraComponent rejects an empty-string requiredTag', () => {
    // An empty tag would never match any real gameplay tag, leaving the
    // aura permanently dormant. Surface the misconfiguration at
    // construction time so the bug never reaches the tick loop.
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
        requiredTag: '',
      })
    ).toThrow(/requiredTag/);

    world.dispose();
  });

  it('AuraComponent defaults isActive to true and requiredTag to undefined', () => {
    // Backward compatibility: callers that pass no Stage 7.1 options
    // get an immediately-firing aura with no tag gate, identical to
    // Stage 7 behaviour.
    const { world, facade, spatial } = createTestWorld();
    const ally = addEntity(world);
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
      ownerEntityId: ally.id,
    });
    rewireAuraTarget(zone, {
      kind: 'Radius',
      origin: { kind: 'TargetEntity', entityId: zone.id },
      radius: FP.FromInt(10),
      filter: { tagsRequired: ['Team.Ally'] },
    });
    spatial.setPosition(zone.id, { x: FP.FromInt(0), z: FP.FromInt(0) });

    const auraComp = zone.getComponent<AuraComponent>(AbilitiesComponentType.Aura)!;
    expect(auraComp.isActive).toBe(true);
    expect(auraComp.requiredTag).toBeUndefined();

    // And the aura fires normally.
    world.processAllTicks(3); // fire
    world.processAllTicks(4); // heal lands
    expect(FP.ToFloat(facade.getAttribute(ally.id, 'Health').current)).toBe(55);

    world.dispose();
  });
});

// ---------------------------------------------------------------------------
// Test helpers (duplicated from auras.test.ts intentionally to keep the
// Stage 7.1 test file self-contained; the shared helpers are tiny and
// unlikely to drift).
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

  const runtime = createAbilitySystemRuntime();
  const world = new GameWorld({
    componentTypes: [
      AbilitiesComponentType.Attributes,
      AbilitiesComponentType.ActiveEffects,
      AbilitiesComponentType.GameplayTags,
      AbilitiesComponentType.Aura,
    ],
  });
  world.registerSystems(
    [
      new EffectApplicationSystem(registries, runtime),
      new EffectTickSystem(registries, runtime),
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

function rewireAuraTarget(zone: Entity, target: AuraComponent['target']): void {
  const aura = zone.getComponent<AuraComponent>(AbilitiesComponentType.Aura);
  if (!aura) {
    throw new Error(`rewireAuraTarget: entity ${zone.id} has no AuraComponent`);
  }
  Object.defineProperty(aura, 'target', {
    value: target,
    writable: false,
    configurable: true,
    enumerable: true,
  });
}
