import { afterEach, describe, expect, it } from 'vitest';
import {
  Entity,
  GameWorld,
  resetEntityIdCounter,
  type IComponent,
  type IPoolableEntity,
} from '../src/index.js';

const FLAG = Symbol('Flag');

class Flag implements IComponent {
  public readonly type = FLAG;
  public static events: string[] = [];

  public onCreate(): void {
    Flag.events.push('create');
  }

  public onEnable(): void {
    Flag.events.push('enable');
  }

  public onDisable(): void {
    Flag.events.push('disable');
  }

  public onDestroy(): void {
    Flag.events.push('destroy');
  }
}

class FlagEntity extends Entity implements IPoolableEntity {
  public constructor() {
    super();
    this.addComponent(new Flag());
  }

  public onSpawn(_args: void): void {}

  public onDespawn(): void {}
}

describe('component lifecycle', () => {
  afterEach(() => {
    Flag.events.length = 0;
    resetEntityIdCounter();
  });

  it('runs onCreate when a component is added and onDestroy on dispose', () => {
    const entity = new Entity();
    entity.addComponent(new Flag());
    expect(Flag.events).toEqual(['create']);
    entity.dispose();
    expect(Flag.events).toEqual(['create', 'destroy']);
  });

  it('runs onEnable on pool spawn and onDisable when the entity returns', () => {
    const world = new GameWorld({
      pooling: {
        entityTypes: {
          flag: { factory: () => new FlagEntity() },
        },
      },
    });
    const pools = world.pools;
    if (pools === null) throw new Error('expected pools');
    const entity = pools.spawn<FlagEntity>('flag');
    expect(Flag.events).toEqual(['create', 'enable']);
    pools.despawn(entity);
    expect(Flag.events).toEqual(['create', 'enable', 'disable']);
    pools.drainAll();
    expect(Flag.events).toEqual(['create', 'enable', 'disable', 'destroy']);
    world.dispose();
  });
});
