import { describe, expect, it } from 'vitest';
import { GameWorld } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import {
  createAbilitySystem,
  defineAbility,
  defineAbilitySystem,
  defineEffect,
  spatialQueryFromPhysicsWorld,
} from '../src';
import { HealthAttribute, ExplosionEffect, spawnCombatEntity } from './helpers';

describe('physicsWorld spatial integration', () => {
  it('createAbilitySystem wires physicsWorld into radius targeting without spatialQuery', () => {
    const queried: Array<{ x: number; z: number; r: number }> = [];
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
      physicsWorld: {
        spatialGrid: {
          queryRadius: (x, z, radius) => {
            queried.push({
              x: FP.ToFloat(x),
              z: FP.ToFloat(z),
              r: FP.ToFloat(radius),
            });
            return [];
          },
        },
        getEntityPosition: (entityId) =>
          entityId === 1 ? { x: FP.FromInt(3), z: FP.FromInt(4) } : undefined,
      },
    });
    world.registerSystems([...abilities.tickSystems], []);

    const caster = spawnCombatEntity(world, abilities, ['Ability.Nova']);
    expect(caster.id).toBe(1);

    abilities.activateAbility(caster.id, 'Ability.Nova');
    world.processAllTicks(2);

    expect(queried).toEqual([{ x: 3, z: 4, r: 10 }]);
    world.dispose();
  });

  it('spatialQuery config overrides physicsWorld', () => {
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
              origin: { kind: 'Point', x: FP.FromInt(0), z: FP.FromInt(0) },
              radius: FP.FromInt(5),
            },
            targetEffectIds: ['Effect.Explosion'],
          }),
        ],
      }),
      pipeline: 'activation',
      physicsWorld: {
        spatialGrid: { queryRadius: () => [1] },
        getEntityPosition: () => undefined,
      },
      spatialQuery: { queryRadius: () => [99] },
    });
    world.registerSystems([...abilities.tickSystems], []);

    const caster = spawnCombatEntity(world, abilities, ['Ability.Nova']);
    abilities.activateAbility(caster.id, 'Ability.Nova');
    world.processAllTicks(2);

    expect(abilities.pendingActivationCount).toBe(0);
    world.dispose();
  });

  it('spatialQueryFromPhysicsWorld delegates to the physics surface', () => {
    const adapter = spatialQueryFromPhysicsWorld({
      spatialGrid: { queryRadius: () => [99] },
      getEntityPosition: () => ({ x: FP.FromInt(0), z: FP.FromInt(0) }),
    });
    expect(adapter.queryRadius(FP.ZERO, FP.ZERO, FP.FromInt(1))).toEqual([99]);
    expect(adapter.getEntityPosition?.(1)).toEqual({ x: FP.FromInt(0), z: FP.FromInt(0) });
  });
});
