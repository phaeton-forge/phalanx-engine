import { afterEach, describe, expect, it } from 'vitest';
import {
  Entity,
  GameWorld,
  SoAComponent,
  resetEntityIdCounter,
  type IPoolableEntity,
} from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import {
  AbilitiesComponentType,
  ActiveEffectsComponent,
  AttributesComponent,
  GameplayTagsComponent,
  createAbilitySystem,
  defineAbility,
  defineAbilitySystem,
  defineAttribute,
  defineEffect,
  getAbilitySystemComponent,
  getActiveEffectsComponent,
  getGameplayTagsComponent,
  type AbilitySystem,
} from '../src';
import { releasePooledAbilityState } from '../src/api/releasePooledAbilityState.js';

const definitions = defineAbilitySystem({
  attributes: [
    defineAttribute({
      id: 'Health',
      default: FP.FromInt(100),
      min: FP.FromInt(0),
      max: FP.FromInt(100),
      clamp: 'both',
    }),
  ],
  effects: [
    defineEffect({
      id: 'Effect.Burn',
      type: 'Duration',
      durationTicks: 10,
      tagsGranted: ['State.Debuff.Burn'],
    }),
  ],
  abilities: [
    defineAbility({
      id: 'Ability.Hold',
      target: { kind: 'Self' },
    }),
  ],
});

const HEALTH_RAW = FP.ToRaw(FP.FromInt(100));

class Minion extends Entity implements IPoolableEntity {
  public constructor(abilities: AbilitySystem) {
    super();
    this.addComponent(
      abilities.initComponent({
        tags: ['Team.Red'],
        effects: ['Effect.Burn'],
        abilities: ['Ability.Hold'],
      })
    );
  }

  public onSpawn(): void {}

  public onDespawn(): void {}
}

describe('pooled GAS reset', () => {
  afterEach(() => {
    SoAComponent.resetContext();
    resetEntityIdCounter();
  });

  it('clears transient effects and restores the factory shell', () => {
    const holder: { abilities?: AbilitySystem } = {};
    const world = new GameWorld({
      pooling: {
        entityTypes: {
          minion: {
            factory: () => {
              const abilities = holder.abilities;
              if (abilities === undefined) {
                throw new Error('ability system is not ready');
              }
              return new Minion(abilities);
            },
          },
        },
      },
    });
    const abilities = createAbilitySystem(world, { definitions });
    holder.abilities = abilities;
    world.registerSystems([...abilities.tickSystems], []);
    const pools = world.pools;
    if (pools === null) throw new Error('expected pools');

    const minion = pools.spawn<Minion>('minion');
    const component = getAbilitySystemComponent(minion);
    if (component === undefined) throw new Error('missing ability component');
    expect(component.activeEffects.pendingAdd).toHaveLength(0);
    expect(component.tags.tags.has('Team.Red')).toBe(true);
    expect(component.abilities.has('Ability.Hold')).toBe(true);
    expect(component.attributes.current[0]).toBe(HEALTH_RAW);

    abilities.addTag(minion.id, 'Team.Blue');
    abilities.applyEffect(minion.id, 'Effect.Burn', minion.id);
    world.processAllTicks(0);
    expect(getActiveEffectsComponent(minion)?.queue).toHaveLength(1);
    expect(
      getGameplayTagsComponent(minion)?.effectGrantCounts.get(
        'State.Debuff.Burn'
      )
    ).toBe(1);
    abilities.applyEffect(minion.id, 'Effect.Burn', minion.id);
    expect(getActiveEffectsComponent(minion)?.pendingAdd).toHaveLength(1);
    component.abilities.delete('Ability.Hold');
    component.attributes.base[0] = 1n;
    component.attributes.current[0] = 1n;

    pools.despawn(minion);
    expect(getActiveEffectsComponent(minion)?.queue).toHaveLength(0);
    expect(getActiveEffectsComponent(minion)?.pendingAdd).toHaveLength(0);
    expect(getGameplayTagsComponent(minion)?.tags.has('Team.Red')).toBe(true);
    expect(getGameplayTagsComponent(minion)?.tags.has('Team.Blue')).toBe(false);
    expect(getGameplayTagsComponent(minion)?.adHocTags.has('Team.Red')).toBe(
      true
    );
    expect(getGameplayTagsComponent(minion)?.effectGrantCounts.size).toBe(0);
    expect(component.abilities.has('Ability.Hold')).toBe(true);
    expect(component.attributes.base[0]).toBe(HEALTH_RAW);
    expect(component.attributes.current[0]).toBe(HEALTH_RAW);

    releasePooledAbilityState(minion);
    expect(getActiveEffectsComponent(minion)?.queue).toHaveLength(0);

    const again = pools.spawn<Minion>('minion');
    expect(again.id).toBe(minion.id);
    expect(getActiveEffectsComponent(again)?.queue).toHaveLength(0);
    expect(getActiveEffectsComponent(again)?.pendingAdd).toHaveLength(0);
  });

  it('removes GAS components a bare pooled entity gained after construction', () => {
    const world = new GameWorld({
      pooling: {
        entityTypes: {
          bare: {
            factory: () => new Bare(),
          },
        },
      },
    });
    const abilities = createAbilitySystem(world, { definitions });
    world.registerSystems([...abilities.tickSystems], []);
    const pools = world.pools;
    if (pools === null) throw new Error('expected pools');

    const bare = pools.spawn<Bare>('bare');
    expect(bare.hasComponent(AbilitiesComponentType.ActiveEffects)).toBe(false);
    expect(bare.hasComponent(AbilitiesComponentType.GameplayTags)).toBe(false);

    abilities.addTag(bare.id, 'Team.Red');
    abilities.applyEffect(bare.id, 'Effect.Burn', bare.id);
    bare.addComponent(new AttributesComponent(1));
    expect(bare.hasComponent(AbilitiesComponentType.ActiveEffects)).toBe(true);
    expect(bare.hasComponent(AbilitiesComponentType.GameplayTags)).toBe(true);
    expect(bare.hasComponent(AbilitiesComponentType.Attributes)).toBe(true);
    expect(getGameplayTagsComponent(bare)?.adHocTags.has('Team.Red')).toBe(
      true
    );

    pools.despawn(bare);
    expect(bare.hasComponent(AbilitiesComponentType.AbilitySystem)).toBe(false);
    expect(bare.hasComponent(AbilitiesComponentType.ActiveEffects)).toBe(false);
    expect(bare.hasComponent(AbilitiesComponentType.GameplayTags)).toBe(false);
    expect(bare.hasComponent(AbilitiesComponentType.Attributes)).toBe(false);

    const again = pools.spawn<Bare>('bare');
    expect(again).toBe(bare);
    expect(again.hasComponent(AbilitiesComponentType.ActiveEffects)).toBe(
      false
    );
    expect(again.hasComponent(AbilitiesComponentType.GameplayTags)).toBe(false);
  });

  it('keeps constructor GAS components and clears only transient state', () => {
    const world = new GameWorld({
      pooling: {
        entityTypes: {
          shell: {
            factory: () => new GasShell(),
          },
        },
      },
    });
    const abilities = createAbilitySystem(world, { definitions });
    world.registerSystems([...abilities.tickSystems], []);
    const pools = world.pools;
    if (pools === null) throw new Error('expected pools');

    const shell = pools.spawn<GasShell>('shell');
    const attributes = shell.getComponent<AttributesComponent>(
      AbilitiesComponentType.Attributes
    );
    if (attributes === undefined) throw new Error('missing attributes');
    attributes.base[0] = 5n;
    abilities.addTag(shell.id, 'Team.Red');
    abilities.applyEffect(shell.id, 'Effect.Burn', shell.id);
    expect(getActiveEffectsComponent(shell)?.pendingAdd).toHaveLength(1);

    pools.despawn(shell);
    expect(shell.hasComponent(AbilitiesComponentType.ActiveEffects)).toBe(true);
    expect(shell.hasComponent(AbilitiesComponentType.GameplayTags)).toBe(true);
    expect(shell.hasComponent(AbilitiesComponentType.Attributes)).toBe(true);
    expect(getActiveEffectsComponent(shell)?.queue).toHaveLength(0);
    expect(getActiveEffectsComponent(shell)?.pendingAdd).toHaveLength(0);
    expect(getGameplayTagsComponent(shell)?.tags.size).toBe(0);
    expect(getGameplayTagsComponent(shell)?.adHocTags.size).toBe(0);
    expect(getGameplayTagsComponent(shell)?.effectGrantCounts.size).toBe(0);
    expect(attributes.base[0]).toBe(0n);
    expect(attributes.current[0]).toBe(0n);
  });

  it('matches a fresh spawn after three despawn and spawn cycles', () => {
    const holder: { abilities?: AbilitySystem } = {};
    const world = new GameWorld({
      pooling: {
        entityTypes: {
          minion: {
            factory: () => {
              const abilities = holder.abilities;
              if (abilities === undefined) {
                throw new Error('ability system is not ready');
              }
              return new Minion(abilities);
            },
          },
        },
      },
    });
    const abilities = createAbilitySystem(world, {
      definitions: reuseDefinitions,
    });
    holder.abilities = abilities;
    world.registerSystems([...abilities.tickSystems], []);
    const pools = world.pools;
    if (pools === null) throw new Error('expected pools');

    const fresh = pools.spawn<Minion>('minion');
    const recycled = pools.spawn<Minion>('minion');
    const freshShell = gasShell(fresh);
    const wounded = FP.ToRaw(FP.FromInt(32));

    for (let life = 0; life < 3; life += 1) {
      const component = getAbilitySystemComponent(recycled);
      if (component === undefined) throw new Error('missing ability component');
      component.attributes.base[0] = wounded;
      component.attributes.current[0] = wounded;
      component.abilities.delete('Ability.Hold');
      component.abilities.add('Ability.Other');
      abilities.addTag(recycled.id, 'Team.Blue');
      abilities.applyEffect(recycled.id, 'Effect.Burn', recycled.id);
      pools.despawn(recycled);
      const again = pools.spawn<Minion>('minion');
      expect(again.id).toBe(recycled.id);
      expect(gasShell(again)).toEqual(freshShell);
    }
    world.dispose();
  });
});

const reuseDefinitions = defineAbilitySystem({
  attributes: [
    defineAttribute({
      id: 'Health',
      default: FP.FromInt(48),
      min: FP.FromInt(0),
      max: FP.FromInt(100),
      clamp: 'both',
    }),
  ],
  effects: [
    defineEffect({
      id: 'Effect.Burn',
      type: 'Duration',
      durationTicks: 10,
      tagsGranted: ['State.Debuff.Burn'],
    }),
  ],
  abilities: [
    defineAbility({
      id: 'Ability.Hold',
      target: { kind: 'Self' },
    }),
  ],
});

function gasShell(entity: Entity): {
  base: bigint[];
  current: bigint[];
  abilities: string[];
  tags: string[];
  adHoc: string[];
  grants: number;
  pending: number;
  queued: number;
} {
  const component = getAbilitySystemComponent(entity);
  if (component === undefined) throw new Error('missing ability component');
  return {
    base: [...component.attributes.base],
    current: [...component.attributes.current],
    abilities: [...component.abilities].sort(),
    tags: [...component.tags.tags].sort(),
    adHoc: [...component.tags.adHocTags].sort(),
    grants: component.tags.effectGrantCounts.size,
    pending: component.activeEffects.pendingAdd.length,
    queued: component.activeEffects.queue.length,
  };
}

class Bare extends Entity implements IPoolableEntity {
  public onSpawn(): void {}

  public onDespawn(): void {}
}

class GasShell extends Entity implements IPoolableEntity {
  public constructor() {
    super();
    this.addComponent(new ActiveEffectsComponent());
    this.addComponent(new GameplayTagsComponent());
    this.addComponent(new AttributesComponent(1));
  }

  public onSpawn(): void {}

  public onDespawn(): void {}
}
