import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIdCounter } from '../src/Entity';
import { GameSystem } from '../src/GameSystem';
import { GameWorld } from '../src/GameWorld';
import type { IPhysicsWorld } from '../src/IPhysicsWorld';
import type { SystemContext } from '../src/SystemContext';

class ProbeSystem extends GameSystem {
  public physicsRef: IPhysicsWorld | undefined;
  public poolsRef: unknown;

  public override init(context: SystemContext): void {
    super.init(context);
    this.physicsRef = this.physics;
    this.poolsRef = this.pools;
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
});
