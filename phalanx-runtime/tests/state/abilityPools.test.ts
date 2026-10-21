import { afterEach, describe, expect, it } from 'vitest';
import {
  BinaryStateReader,
  BinaryStateWriter,
  Entity,
  GameWorld,
  SoAComponent,
  type IPoolableEntity,
} from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import {
  AbilitiesComponentType,
  createAbilitySystem,
  defineAbility,
  defineAbilitySystem,
  defineAttribute,
  defineEffect,
  getAbilitySystemComponent,
  getActiveEffectsComponent,
  getAttributesComponent,
  getGameplayTagsComponent,
  type AbilitySystem,
  type MagnitudeCalculation,
} from '@phalanx-engine/abilities';
import { digestBytes } from '../../src/index.js';
import { StateHelpers } from '../../src/advanced/index.js';
import { manualTickProvider } from '../support/manualTickProvider.js';

const bonusDamage: MagnitudeCalculation = (ctx) => {
  const raw = ctx.setByCaller?.get('bonus');
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) {
    return ctx.baseMagnitude;
  }
  return FP.Add(ctx.baseMagnitude, FP.FromInt(raw));
};

const Health = defineAttribute({
  id: 'Health',
  default: FP.FromInt(100),
  min: FP.FromInt(0),
  max: FP.FromInt(100),
  clamp: 'both',
});

const Armor = defineAttribute({
  id: 'Armor',
  default: FP.FromInt(10),
  min: FP.FromInt(0),
  max: FP.FromInt(100),
  clamp: 'min',
});

const Burn = defineEffect({
  id: 'Effect.Burn',
  type: 'Periodic',
  durationTicks: 40,
  periodTicks: 5,
  modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-2) }],
  tagsGranted: ['State.Debuff.Burn'],
});

const ArmorShred = defineEffect({
  id: 'Effect.ArmorShred',
  type: 'Duration',
  durationTicks: 25,
  modifiers: [{ attributeId: 'Armor', op: 'Add', magnitude: FP.FromInt(-3) }],
  tagsGranted: ['State.Debuff.ArmorShred'],
});

const Shield = defineEffect({
  id: 'Effect.Shield',
  type: 'Duration',
  durationTicks: 15,
  tagsGranted: ['State.Buff.Shield'],
  tagsBlocked: ['State.Buff.Shield'],
});

const StrikeCooldown = defineEffect({
  id: 'Effect.Strike.Cooldown',
  type: 'Duration',
  durationTicks: 8,
  tagsGranted: ['Cooldown.Ability.Strike'],
});

const StrikeDamage = defineEffect({
  id: 'Effect.Strike.Damage',
  type: 'Instant',
  modifiers: [
    {
      attributeId: 'Health',
      op: 'Add',
      magnitude: FP.FromInt(-7),
      calculation: bonusDamage,
    },
  ],
});

const Strike = defineAbility({
  id: 'Ability.Strike',
  cooldownEffectId: 'Effect.Strike.Cooldown',
  activationBlockedTags: ['Cooldown.Ability.Strike'],
  target: { kind: 'Entity', origin: { kind: 'Caller' } },
  targetEffectIds: ['Effect.Strike.Damage'],
});

const BurnAbility = defineAbility({
  id: 'Ability.Burn',
  target: { kind: 'Entity', origin: { kind: 'Caller' } },
  targetEffectIds: ['Effect.Burn'],
});

const definitions = defineAbilitySystem({
  attributes: [Health, Armor],
  effects: [Burn, ArmorShred, Shield, StrikeCooldown, StrikeDamage],
  abilities: [Strike, BurnAbility],
});

function finish(fill: (w: BinaryStateWriter) => void): Uint8Array {
  const writer = new BinaryStateWriter();
  fill(writer);
  return writer.finish();
}

describe('pooled ability save sections', () => {
  afterEach(() => {
    SoAComponent.resetContext();
  });

  it('clears pooled GAS on despawn and continues past respawn', () => {
    const source = pooledGasWorld();
    const pools = source.world.pools;
    if (pools === null) throw new Error('expected pools');
    const live = pools.spawn<PooledMinion>('minion', { health: 90 });
    const freed = pools.spawn<PooledMinion>('minion', { health: 70 });
    expect(
      getAbilitySystemComponent(freed)?.abilities.has('Ability.Burn')
    ).toBe(true);
    expect(getActiveEffectsComponent(freed)?.pendingAdd).toHaveLength(1);

    for (let count = 0; count < 6; count += 1) {
      source.abilities.applyEffect(freed.id, 'Effect.Burn', live.id);
    }
    source.abilities.applyEffect(live.id, 'Effect.ArmorShred', live.id);
    source.world.processAllTicks(0);
    expect(getActiveEffectsComponent(freed)?.queue).toHaveLength(7);
    expect(
      getGameplayTagsComponent(freed)?.effectGrantCounts.get(
        'State.Debuff.Burn'
      )
    ).toBe(6);
    source.abilities.applyEffect(freed.id, 'Effect.ArmorShred', live.id);
    expect(getActiveEffectsComponent(freed)?.pendingAdd).toHaveLength(1);

    pools.despawn(freed);
    expect(getActiveEffectsComponent(freed)?.queue).toHaveLength(0);
    expect(getActiveEffectsComponent(freed)?.pendingAdd).toHaveLength(0);
    expect(getGameplayTagsComponent(freed)?.tags.has('Team.Red')).toBe(true);
    expect(getGameplayTagsComponent(freed)?.adHocTags.has('Team.Red')).toBe(
      true
    );
    expect(getGameplayTagsComponent(freed)?.effectGrantCounts.size).toBe(0);
    expect(
      getAbilitySystemComponent(freed)?.abilities.has('Ability.Burn')
    ).toBe(true);

    const bytes = saveMatch(source.world);
    const restored = pooledGasWorld();
    loadMatch(bytes, restored.world);
    expect(saveMatch(restored.world)).toEqual(bytes);
    expect(restored.world.entityManager.getEntity(freed.id)).toBeUndefined();
    expect(getActiveEffectsComponent(live)?.queue).toHaveLength(2);

    const restoredLive = restored.world.entityManager.getEntity(live.id);
    if (restoredLive === undefined) throw new Error('missing live entity');
    expect(getActiveEffectsComponent(restoredLive)?.queue).toHaveLength(2);

    for (let tick = 1; tick <= 15; tick += 1) {
      if (tick === 1) {
        const again = pools.spawn<PooledMinion>('minion', { health: 80 });
        const restoredPools = restored.world.pools;
        if (restoredPools === null) throw new Error('expected pools');
        const restoredAgain = restoredPools.spawn<PooledMinion>('minion', {
          health: 80,
        });
        expect(again.id).toBe(freed.id);
        expect(restoredAgain.id).toBe(freed.id);
        expect(getActiveEffectsComponent(again)?.queue).toHaveLength(0);
        expect(getActiveEffectsComponent(restoredAgain)?.queue).toHaveLength(0);
        source.abilities.applyEffect(again.id, 'Effect.Burn', live.id);
        restored.abilities.applyEffect(
          restoredAgain.id,
          'Effect.Burn',
          live.id
        );
      }
      source.world.processAllTicks(tick);
      restored.world.processAllTicks(tick);
      expect(digestBytes(saveMatch(restored.world))).toBe(
        digestBytes(saveMatch(source.world))
      );
    }

    const respawned = source.world.entityManager.getEntity(freed.id);
    if (respawned === undefined) throw new Error('missing respawned entity');
    expect(getActiveEffectsComponent(respawned)?.queue).toHaveLength(2);
  });

  it('reseeds factory pending after a restored live minion returns to the pool', () => {
    const source = pooledGasWorld();
    const pools = source.world.pools;
    if (pools === null) throw new Error('expected pools');
    const live = pools.spawn<PooledMinion>('minion', { health: 90 });
    source.abilities.applyEffect(live.id, 'Effect.Burn', live.id);
    expect(pendingIds(live)).toEqual(['Effect.Shield', 'Effect.Burn']);

    const bytes = saveMatch(source.world);
    const restored = pooledGasWorld();
    loadMatch(bytes, restored.world);
    const restoredLive = restored.world.entityManager.getEntity(live.id);
    if (restoredLive === undefined) throw new Error('missing live entity');
    expect(pendingIds(restoredLive)).toEqual(['Effect.Shield', 'Effect.Burn']);

    const restoredPools = restored.world.pools;
    if (restoredPools === null) throw new Error('expected pools');
    restoredPools.despawn(restoredLive);
    const respawned = restoredPools.spawn<PooledMinion>('minion', {
      health: 80,
    });
    expect(pendingIds(respawned)).toEqual(['Effect.Shield']);
  });

  it('matches digests when a bare pooled entity gained GAS components lazily', () => {
    const source = barePoolWorld();
    const pools = source.world.pools;
    if (pools === null) throw new Error('expected pools');
    const bare = pools.spawn<BareMinion>('bare');
    expect(bare.hasComponent(AbilitiesComponentType.ActiveEffects)).toBe(false);
    expect(bare.hasComponent(AbilitiesComponentType.GameplayTags)).toBe(false);

    source.abilities.addTag(bare.id, 'Team.Red');
    source.abilities.applyEffect(bare.id, 'Effect.Burn', bare.id);
    source.world.processAllTicks(0);
    expect(bare.hasComponent(AbilitiesComponentType.ActiveEffects)).toBe(true);
    expect(bare.hasComponent(AbilitiesComponentType.GameplayTags)).toBe(true);
    expect(getActiveEffectsComponent(bare)?.queue).toHaveLength(1);
    expect(getGameplayTagsComponent(bare)?.adHocTags.has('Team.Red')).toBe(
      true
    );

    pools.despawn(bare);
    expect(bare.hasComponent(AbilitiesComponentType.ActiveEffects)).toBe(false);
    expect(bare.hasComponent(AbilitiesComponentType.GameplayTags)).toBe(false);

    const bytes = saveMatch(source.world);
    const restored = barePoolWorld();
    loadMatch(bytes, restored.world);
    expect(saveMatch(restored.world)).toEqual(bytes);

    const again = pools.spawn<BareMinion>('bare');
    const restoredPools = restored.world.pools;
    if (restoredPools === null) throw new Error('expected pools');
    const restoredAgain = restoredPools.spawn<BareMinion>('bare');
    expect(again.id).toBe(bare.id);
    expect(restoredAgain.id).toBe(bare.id);
    expect(again.hasComponent(AbilitiesComponentType.ActiveEffects)).toBe(
      false
    );
    expect(again.hasComponent(AbilitiesComponentType.GameplayTags)).toBe(false);
    expect(
      restoredAgain.hasComponent(AbilitiesComponentType.ActiveEffects)
    ).toBe(false);
    expect(
      restoredAgain.hasComponent(AbilitiesComponentType.GameplayTags)
    ).toBe(false);

    expect(digestBytes(saveMatch(restored.world))).toBe(
      digestBytes(saveMatch(source.world))
    );
    source.world.processAllTicks(1);
    restored.world.processAllTicks(1);
    expect(digestBytes(saveMatch(restored.world))).toBe(
      digestBytes(saveMatch(source.world))
    );
  });

  it('respawns factory attribute defaults when onSpawn does not rewrite them', () => {
    const source = silentPoolWorld();
    const pools = source.world.pools;
    if (pools === null) throw new Error('expected pools');
    const live = pools.spawn<SilentMinion>('silent');
    const attributes = getAttributesComponent(live);
    if (attributes === undefined) throw new Error('missing attributes');
    const full = FP.ToRaw(FP.FromInt(100));
    const damaged = FP.ToRaw(FP.FromInt(40));
    expect(attributes.current[0]).toBe(full);
    attributes.base[0] = damaged;
    attributes.current[0] = damaged;

    pools.despawn(live);
    expect(getAttributesComponent(live)?.current[0]).toBe(full);
    expect(getAttributesComponent(live)?.base[0]).toBe(full);
    expect(getAbilitySystemComponent(live)?.abilities.has('Ability.Burn')).toBe(
      true
    );
    expect(getGameplayTagsComponent(live)?.tags.has('Team.Silent')).toBe(true);

    const bytes = saveMatch(source.world);
    const restored = silentPoolWorld();
    loadMatch(bytes, restored.world);
    const again = pools.spawn<SilentMinion>('silent');
    const restoredPools = restored.world.pools;
    if (restoredPools === null) throw new Error('expected pools');
    const restoredAgain = restoredPools.spawn<SilentMinion>('silent');
    expect(getAttributesComponent(again)?.current[0]).toBe(full);
    expect(getAttributesComponent(restoredAgain)?.current[0]).toBe(full);
    expect(getAttributesComponent(again)?.base[0]).toBe(full);
    expect(getAttributesComponent(restoredAgain)?.base[0]).toBe(full);
    expect(digestBytes(saveMatch(restored.world))).toBe(
      digestBytes(saveMatch(source.world))
    );
  });
});

class SilentMinion extends Entity implements IPoolableEntity<void> {
  public constructor(id: number, abilities: AbilitySystem) {
    super(id);
    this.addComponent(
      abilities.initComponent({
        abilities: ['Ability.Burn'],
        tags: ['Team.Silent'],
        attributes: { Health: FP.FromInt(100) },
      })
    );
  }

  public onSpawn(_args: void): void {}

  public onDespawn(): void {}
}

class BareMinion extends Entity implements IPoolableEntity<void> {
  public onSpawn(_args: void): void {}

  public onDespawn(): void {}
}

class PooledMinion
  extends Entity
  implements IPoolableEntity<{ health: number }>
{
  public constructor(id: number, abilities: AbilitySystem) {
    super(id);
    this.addComponent(
      abilities.initComponent({
        abilities: ['Ability.Burn', 'Ability.Strike'],
        attributes: {
          Health: FP.FromInt(100),
          Armor: FP.FromInt(10),
        },
        tags: ['Team.Red'],
        effects: ['Effect.Shield'],
      })
    );
  }

  public onSpawn(args: { health: number }): void {
    const component = getAbilitySystemComponent(this);
    if (component === undefined) {
      throw new Error('missing ability component');
    }
    const raw = FP.ToRaw(FP.FromInt(args.health));
    component.attributes.base[0] = raw;
    component.attributes.current[0] = raw;
    component.attributes.dirty[0] = 1;
    component.tags.tags.add('Team.Red');
    component.tags.adHocTags.add('Team.Red');
  }

  public onDespawn(): void {}
}

function silentPoolWorld(): { world: GameWorld; abilities: AbilitySystem } {
  const holder: { abilities?: AbilitySystem } = {};
  const world = new GameWorld({
    tickFrameProvider: manualTickProvider(),
    pooling: {
      entityTypes: {
        silent: {
          factory: (id) => {
            const abilities = holder.abilities;
            if (abilities === undefined) {
              throw new Error('ability system is not ready');
            }
            return new SilentMinion(id, abilities);
          },
        },
      },
    },
  });
  const abilities = createAbilitySystem(world, {
    definitions,
    pipeline: 'full',
  });
  holder.abilities = abilities;
  world.registerSystems([...abilities.tickSystems], []);
  return { world, abilities };
}

function barePoolWorld(): { world: GameWorld; abilities: AbilitySystem } {
  const world = new GameWorld({
    tickFrameProvider: manualTickProvider(),
    pooling: {
      entityTypes: {
        bare: {
          factory: (id) => new BareMinion(id),
        },
      },
    },
  });
  const abilities = createAbilitySystem(world, {
    definitions,
    pipeline: 'full',
  });
  world.registerSystems([...abilities.tickSystems], []);
  return { world, abilities };
}

function pooledGasWorld(): { world: GameWorld; abilities: AbilitySystem } {
  const holder: { abilities?: AbilitySystem } = {};
  const world = new GameWorld({
    tickFrameProvider: manualTickProvider(),
    pooling: {
      entityTypes: {
        minion: {
          factory: (id) => {
            const abilities = holder.abilities;
            if (abilities === undefined) {
              throw new Error('ability system is not ready');
            }
            return new PooledMinion(id, abilities);
          },
        },
      },
    },
  });
  const abilities = createAbilitySystem(world, {
    definitions,
    pipeline: 'full',
  });
  holder.abilities = abilities;
  world.registerSystems([...abilities.tickSystems], []);
  return { world, abilities };
}

function pendingIds(entity: Entity): string[] {
  const pending = getActiveEffectsComponent(entity)?.pendingAdd ?? [];
  return pending.map((entry) => entry.defId);
}

function saveMatch(world: GameWorld): Uint8Array {
  return finish((writer) => {
    StateHelpers.writePools(writer, world);
    StateHelpers.writeModuleSections(writer, world);
    StateHelpers.writeEntityIds(writer, world);
  });
}

function loadMatch(bytes: Uint8Array, world: GameWorld): void {
  const reader = new BinaryStateReader(bytes);
  StateHelpers.readPools(reader, world);
  StateHelpers.readModuleSections(reader, world);
  StateHelpers.readEntityIds(reader, world);
  reader.done();
}
