import { describe, it, expect, beforeEach } from 'vitest';
import { Entity } from '../src/Entity';
import { GameSystem } from '../src/GameSystem';
import { GameWorld } from '../src/GameWorld';
import { defineService } from '../src/services';
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

interface FakePhysics {
  readonly label: string;
}

const FakePhysicsKey = defineService<FakePhysics>('fakePhysics');

class ProbeSystem extends GameSystem {
  public physicsRef: FakePhysics | undefined;
  public poolsRef: unknown;

  public override init(context: SystemContext): void {
    super.init(context);
    this.physicsRef = context.getService(FakePhysicsKey);
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
  it('exposes pools on context when GameWorld pooling is configured', () => {
    const world = new GameWorld({
      tickFrameProvider: manualTickProvider(),
      pooling: {
        entityTypes: {
          unit: {
            factory: (id) => new Entity(id),
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

  it('gives systems a service provided before registerSystems', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    const physics: FakePhysics = { label: 'physics' };

    world.provide(FakePhysicsKey, physics);
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

  it('gives each world its own entity id counter', () => {
    const first = new GameWorld({ tickFrameProvider: manualTickProvider() });
    const second = new GameWorld({ tickFrameProvider: manualTickProvider() });
    const a = first.createEntity((id) => new Entity(id));
    const b = second.createEntity((id) => new Entity(id));
    expect(a.id).toBe(1);
    expect(b.id).toBe(1);
    expect(first.createEntity((id) => new Entity(id)).id).toBe(2);
    first.dispose();
    second.dispose();
  });

  it('runs only the tick systems passed to registerSystems', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    const listed = new CountingTickSystem();
    const unlisted = new CountingTickSystem();
    world.provide(defineService<{ tickSystems: GameSystem[] }>('abilities'), {
      tickSystems: [unlisted],
    });
    world.registerSystems([listed], []);

    world.processAllTicks(1);
    expect(listed.tickCount).toBe(1);
    expect(unlisted.tickCount).toBe(0);
  });
});
