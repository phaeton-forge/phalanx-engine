import { describe, it, expect, afterEach } from 'vitest';
import {
  Entity,
  GameWorld,
  SoAComponent,
  resetEntityIdCounter,
} from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import {
  InstanceIdCounter,
  createAbilitySystem,
  defineAbility,
  defineAbilitySystem,
  defineAttribute,
} from '../src';
import type { CueEvent } from '../src';

describe('InstanceIdCounter.set', () => {
  it('accepts any integer >= 0, including a lower mark', () => {
    const counter = new InstanceIdCounter();
    expect(counter.next()).toBe(1);
    expect(counter.next()).toBe(2);
    expect(counter.current).toBe(2);

    counter.set(10);
    expect(counter.current).toBe(10);
    expect(counter.next()).toBe(11);

    counter.set(0);
    expect(counter.current).toBe(0);
    expect(counter.next()).toBe(1);
  });

  it('rejects values that are not integers >= 0', () => {
    const counter = new InstanceIdCounter();
    counter.set(3);
    expect(() => counter.set(-1)).toThrow(/integer >= 0/);
    expect(() => counter.set(1.5)).toThrow(/integer >= 0/);
    expect(() => counter.set(Number.NaN)).toThrow(/integer >= 0/);
    expect(counter.current).toBe(3);
  });
});

describe('ability runtime state', () => {
  const worlds: GameWorld[] = [];

  afterEach(() => {
    for (const world of worlds) {
      world.dispose();
    }
    worlds.length = 0;
    resetEntityIdCounter();
    SoAComponent.resetContext();
  });

  function createWorld(): {
    world: GameWorld;
    abilities: ReturnType<typeof createAbilitySystem>;
    caster: Entity;
  } {
    const world = new GameWorld({});
    worlds.push(world);
    const abilities = createAbilitySystem(world, {
      definitions: defineAbilitySystem({
        attributes: [
          defineAttribute({
            id: 'Health',
            default: FP.FromInt(10),
            min: FP.FromInt(0),
            max: FP.FromInt(10),
            clamp: 'both',
          }),
        ],
        abilities: [
          defineAbility({
            id: 'Ability.Wait',
            target: { kind: 'Self' },
          }),
        ],
      }),
    });
    const caster = new Entity();
    world.entityManager.addEntity(caster);
    return { world, abilities, caster };
  }

  it('exports a snapshot that does not alias the live queues', () => {
    const { abilities, caster } = createWorld();
    const point = FP.FromInt(3);
    expect(
      abilities.activateAbility(caster.id, 'Ability.Wait', {
        entityId: caster.id,
        x: point,
      })
    ).toBe(true);

    const exported = abilities.exportRuntimeState();
    expect(exported.instanceId).toBe(0);
    expect(exported.currentTick).toBe(-1);
    expect(exported.activationRequests).toHaveLength(1);
    expect(exported.resolvedActivationsThisTick).toEqual([]);

    const request = exported.activationRequests[0];
    expect(request).toBeDefined();
    if (!request) {
      throw new Error('missing activation request');
    }
    request.abilityId = 'mutated';
    expect(abilities.pendingActivationAbilityId(0)).toBe('Ability.Wait');
    expect(request.providedTarget?.x).toBe(point);
  });

  it('importRuntimeState restores the counter and queues and leaves cues', () => {
    const source = createWorld();
    source.abilities.activateAbility(source.caster.id, 'Ability.Wait', {
      entityId: source.caster.id,
      z: FP.FromInt(8),
    });
    const saved = source.abilities.exportRuntimeState();

    const target = createWorld();
    const cue: CueEvent = {
      tick: 1,
      cueId: 'Cue.Test',
      sourceEntityId: 1,
      targetEntityId: 1,
      phase: 'OnApplied',
    };
    (target.abilities.gameplayCueBuffer.events as CueEvent[]).push(cue);

    const restored = {
      instanceId: 12,
      currentTick: 4,
      activationRequests: saved.activationRequests,
      resolvedActivationsThisTick: [
        {
          abilityId: 'Ability.Wait',
          casterEntityId: source.caster.id,
          resolvedTargets: [source.caster.id],
          tick: 4,
          hookId: 'hook.wait',
        },
      ],
    };
    target.abilities.importRuntimeState(restored);

    expect(target.abilities.instanceIdCounter).toBe(12);
    expect(target.abilities.pendingActivationCount).toBe(1);
    expect(target.abilities.pendingActivationAbilityId(0)).toBe('Ability.Wait');
    expect(target.abilities.gameplayCueBuffer.events).toEqual([cue]);

    const roundTrip = target.abilities.exportRuntimeState();
    expect(roundTrip.instanceId).toBe(12);
    expect(roundTrip.currentTick).toBe(4);
    expect(roundTrip.activationRequests[0]?.enqueueTick).toBe(-1);
    expect(roundTrip.activationRequests[0]?.providedTarget?.entityId).toBe(
      source.caster.id
    );
    expect(roundTrip.resolvedActivationsThisTick).toEqual(
      restored.resolvedActivationsThisTick
    );

    roundTrip.resolvedActivationsThisTick[0]?.resolvedTargets.push(99);
    const again = target.abilities.exportRuntimeState();
    expect(again.resolvedActivationsThisTick[0]?.resolvedTargets).toEqual([
      source.caster.id,
    ]);
  });

  it('importRuntimeState rejects a malformed snapshot', () => {
    const { abilities } = createWorld();
    expect(() =>
      abilities.importRuntimeState({
        instanceId: -1,
        currentTick: -1,
        activationRequests: [],
        resolvedActivationsThisTick: [],
      })
    ).toThrow(/instanceId/);
    expect(abilities.instanceIdCounter).toBe(0);
    expect(abilities.pendingActivationCount).toBe(0);
  });

  it('importRuntimeState rejects an ability id that is not registered', () => {
    const { abilities } = createWorld();
    expect(() =>
      abilities.importRuntimeState({
        instanceId: 3,
        currentTick: 1,
        activationRequests: [
          {
            casterEntityId: 1,
            abilityId: 'Ability.Missing',
            enqueueTick: 1,
          },
        ],
        resolvedActivationsThisTick: [],
      })
    ).toThrow(/not registered/);
    expect(abilities.instanceIdCounter).toBe(0);
    expect(abilities.pendingActivationCount).toBe(0);
  });

  it('importRuntimeState rebuilds a foreign FixedPoint so arithmetic works', () => {
    const { abilities } = createWorld();
    const source = FP.FromInt(4, 2);
    const foreign = {
      base: source.base,
      precision: source.precision,
    };
    abilities.importRuntimeState({
      instanceId: 1,
      currentTick: 0,
      activationRequests: [
        {
          casterEntityId: 1,
          abilityId: 'Ability.Wait',
          enqueueTick: 0,
          providedTarget: { x: foreign as never, z: foreign as never },
        },
      ],
      resolvedActivationsThisTick: [],
    });
    const exported = abilities.exportRuntimeState();
    const restoredX = exported.activationRequests[0]?.providedTarget?.x;
    const restoredZ = exported.activationRequests[0]?.providedTarget?.z;
    expect(restoredX).toBeDefined();
    expect(restoredZ).toBeDefined();
    if (!restoredX || !restoredZ) {
      throw new Error('missing restored target');
    }
    expect(restoredX).not.toBe(foreign);
    expect(restoredX.precision).toBe(source.precision);
    expect(restoredX.base).toBe(source.base);
    expect(FP.Eq(FP.Sub(restoredX, FP.FromInt(1, 2)), FP.FromInt(3, 2))).toBe(
      true
    );
    expect(FP.Eq(FP.Sub(restoredZ, FP.FromInt(1, 2)), FP.FromInt(3, 2))).toBe(
      true
    );
  });
});
