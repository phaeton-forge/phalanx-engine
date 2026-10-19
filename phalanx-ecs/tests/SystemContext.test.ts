import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIdCounter } from '../src/Entity';
import { GameSystem } from '../src/GameSystem';
import { GameWorld } from '../src/GameWorld';
import type { IAbilitySystem } from '../src/IAbilitySystem';
import type { IPhysicsWorld } from '../src/IPhysicsWorld';
import type { IRandom } from '../src/IRandom';
import type { ITickFrameProvider } from '../src/ITickFrameProvider';
import type { SystemContext } from '../src/SystemContext';
import { manualTickProvider } from './support/manualTickProvider.js';

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
      tickFrameProvider: manualTickProvider(),
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
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    expect(world.context.pools).toBeNull();
    expect(world.pools).toBeNull();
  });

  it('allows optional physics to be set before registerSystems', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    const physics: IPhysicsWorld = {
      getInterpolatedTransform: () => undefined,
      getEntityPosition: () => undefined,
      applyImpulse: () => {},
    };

    world.context.physics = physics;
    expect(world.saveSections).toEqual([]);

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
      pick: (arr) => {
        if (arr.length === 0) {
          throw new Error('Cannot pick from empty array');
        }
        return arr[0]!;
      },
      shuffle: (arr) => arr,
    };

    const world = new GameWorld({
      tickFrameProvider: manualTickProvider(),
      random: rng,
    });
    const probe = new RandomProbeSystem();
    world.registerSystems([], [probe]);

    expect(world.random).toBe(rng);
    expect(probe.randomRef).toBe(rng);
  });

  it('does not read random from the tick provider', () => {
    let reads = 0;
    const source = {
      get random(): IRandom {
        reads += 1;
        throw new Error('provider random must not be read');
      },
      onTick: () => () => {},
      onFrame: () => () => {},
    };
    const provider: ITickFrameProvider = source;

    const world = new GameWorld({ tickFrameProvider: provider });
    expect(reads).toBe(0);
    expect(() => world.random).toThrow(
      /^SystemContext\.random is not configured: pass GameWorldConfig\.random$/
    );
  });

  it('throws when context.random is accessed without configuration', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    expect(() => world.random).toThrow(
      /^SystemContext\.random is not configured: pass GameWorldConfig\.random$/
    );
  });

  it('resets entity id counter on construction', () => {
    resetEntityIdCounter();
    const first = new Entity();
    expect(first.id).toBe(1);

    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    const second = new Entity();
    expect(second.id).toBe(1);
    expect(world.entityManager).toBeDefined();
  });

  it('does not run ability tick systems twice when they are registered explicitly', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
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
