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
  createAbilitySystem,
  defineAbilitySystem,
  defineAttribute,
  defineEffect,
  getAbilitySystemComponent,
  getActiveEffectsComponent,
  getGameplayTagsComponent,
  releasePooledAbilityState,
  type AbilitySystem,
} from '../src';

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
});

class Minion extends Entity implements IPoolableEntity {
  public constructor(abilities: AbilitySystem) {
    super();
    this.addComponent(
      abilities.initComponent({
        tags: ['Team.Red'],
        effects: ['Effect.Burn'],
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

  it('clears queue, pending adds, tags, and grants when the entity returns to the pool', () => {
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
    expect(component.tags.tags.has('Team.Red')).toBe(false);

    abilities.addTag(minion.id, 'Team.Red');
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

    pools.despawn(minion);
    expect(getActiveEffectsComponent(minion)?.queue).toHaveLength(0);
    expect(getActiveEffectsComponent(minion)?.pendingAdd).toHaveLength(0);
    expect(getGameplayTagsComponent(minion)?.tags.size).toBe(0);
    expect(getGameplayTagsComponent(minion)?.adHocTags.size).toBe(0);
    expect(getGameplayTagsComponent(minion)?.effectGrantCounts.size).toBe(0);

    releasePooledAbilityState(minion);
    expect(getActiveEffectsComponent(minion)?.queue).toHaveLength(0);

    const again = pools.spawn<Minion>('minion');
    expect(again.id).toBe(minion.id);
    expect(getActiveEffectsComponent(again)?.queue).toHaveLength(0);
    expect(getActiveEffectsComponent(again)?.pendingAdd).toHaveLength(0);
  });
});
