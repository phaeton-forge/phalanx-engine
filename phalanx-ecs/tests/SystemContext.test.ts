import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIdCounter } from '../src/Entity';
import { GameSystem } from '../src/GameSystem';
import { GameWorld } from '../src/GameWorld';
import type { IAbilitySystem } from '../src/IAbilitySystem';
import type { IPhysicsWorld } from '../src/IPhysicsWorld';
import type { IRandom } from '../src/IRandom';
import type { ITickFrameProvider } from '../src/ITickFrameProvider';
import type { SystemContext } from '../src/SystemContext';

class CountingTickSystem extends GameSystem {
  public tickCount = 0;

  public override processTick(_tick: number): void {
    this.tickCount += 1;
  }
}

class ProbeSystem extends GameSystem {
  public physicsRef: IPhysicsWorld | undefined;
  public poolsRef: unknown;

  public override init(context: SystemContext): void {
    super.init(context);
    this.physicsRef = this.physics;
    this.poolsRef = this.pools;
  }
}

class RandomProbeSystem extends GameSystem {
  public randomRef: IRandom | undefined;

  public override init(context: SystemContext): void {
    super.init(context);
    this.randomRef = this.random;
  }
}

describe('SystemContext shared services', () => {
  beforeEach(() => {
    resetEntityIdCounter();
  });

  it('exposes pools on context when GameWorld pooling is configured', () => {
    const world = new GameWorld({
      pooling: {
        entityTypes: {
          unit: {
            factory: () => new Entity(),
            pool: { initialSize: 1 },
          },
        },
      },
    });

    expect(world.context.pools).toBe(world.pools);
    expect(world.context.pools).not.toBeNull();
  });

  it('sets pools to null when pooling is disabled', () => {
    const world = new GameWorld({});
    expect(world.context.pools).toBeNull();
    expect(world.pools).toBeNull();
  });

  it('allows optional physics to be set before registerSystems', () => {
    const world = new GameWorld({});
    const physics: IPhysicsWorld = {
      getInterpolatedTransform: () => undefined,
      getEntityPosition: () => undefined,
      applyImpulse: () => {},
    };

    world.context.physics = physics;

    const probe = new ProbeSystem();
    world.registerSystems([], [probe]);

    expect(probe.physicsRef).toBe(physics);
    expect(probe.poolsRef).toBeNull();
  });

  it('wires random from GameWorldConfig.random', () => {
    const rng: IRandom = {
      float: () => 0.5,
      floatRange: () => 0.5,
      int: () => 0,
      intRange: () => 1,
      boolean: () => true,
      pick: (arr) => arr[0] as never,
      shuffle: (arr) => arr,
    };

    const world = new GameWorld({ random: rng });
    const probe = new RandomProbeSystem();
    world.registerSystems([], [probe]);

    expect(world.random).toBe(rng);
    expect(probe.randomRef).toBe(rng);
  });

  it('wires random from tickFrameProvider.random', () => {
    const rng: IRandom = {
      float: () => 0.25,
      floatRange: () => 0.25,
      int: () => 0,
      intRange: () => 2,
      boolean: () => false,
      pick: (arr) => arr[0] as never,
      shuffle: (arr) => arr,
    };

    const provider: ITickFrameProvider = {
      random: rng,
      onTick: () => () => {},
      onFrame: () => () => {},
    };

    const world = new GameWorld({ tickFrameProvider: provider });
    expect(world.random).toBe(rng);
  });

  it('throws when context.random is accessed without configuration', () => {
    const world = new GameWorld({});
    expect(() => world.random).toThrow(/SystemContext.random is not configured/);
  });

  it('resets entity id counter on construction', () => {
    resetEntityIdCounter();
    const first = new Entity();
    expect(first.id).toBe(1);

    const world = new GameWorld({});
    const second = new Entity();
    expect(second.id).toBe(1);
    expect(world.entityManager).toBeDefined();
  });

  it('throws a bootstrap hint when tickFrameProvider RNG is not ready', () => {
    const provider: ITickFrameProvider = {
      get random() {
        throw new Error(
          '[PhalanxClient] RNG unavailable until game start (await waitForGameStart())'
        );
      },
      onTick: () => () => {},
      onFrame: () => () => {},
    };

    expect(
      () => new GameWorld({ tickFrameProvider: provider })
    ).toThrow(/waitForGameStart\(\) before constructing GameWorld/);
  });

  it('does not run ability tick systems twice when they are registered explicitly', () => {
    const world = new GameWorld({});
    const abilityTick = new CountingTickSystem();
    const abilities: IAbilitySystem = {
      tickSystems: [abilityTick],
      activateAbility: () => false,
      applyEffect: () => {},
      tryGetAttribute: () => undefined,
      getAttribute: () => ({ base: 0, current: 0 }),
      hasTag: () => false,
      addTag: () => {},
      removeTag: () => false,
    };

    world.context.abilities = abilities;
    world.registerSystems([...abilities.tickSystems], []);

    world.processAllTicks(1);
    expect(abilityTick.tickCount).toBe(1);
  });
});
