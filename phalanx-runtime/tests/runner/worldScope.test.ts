import { afterEach, describe, expect, it } from 'vitest';
import {
  Entity,
  GameWorld,
  SoAComponent,
  defineSoASchema,
  resetEntityIdCounter,
} from '@phalanx-engine/ecs';
import { WorldScope } from '../../src/runner/WorldScope.js';

const PROBE_SCHEMA = defineSoASchema({ n: 'i64' }, 'ScopeProbe');
const PROBE_TYPE = Symbol('ScopeProbe');

class Probe extends SoAComponent<(typeof PROBE_SCHEMA)['definition']> {
  public readonly type = PROBE_TYPE;

  public constructor(entityId: number, n: bigint) {
    super(PROBE_SCHEMA, entityId, { n });
  }
}

describe('WorldScope', () => {
  afterEach(() => {
    resetEntityIdCounter();
    SoAComponent.resetContext();
  });

  it('restarts entity ids per world and keeps each store', () => {
    const scopeA = new WorldScope();
    const scopeB = new WorldScope();
    const worlds: GameWorld[] = [];
    let firstId = 0;

    scopeA.run(() => {
      const world = new GameWorld({ tickRate: 10 });
      worlds.push(world);
      const entity = new Entity();
      world.entityManager.addEntity(entity);
      new Probe(entity.id, 4n);
      firstId = entity.id;
    });

    scopeB.run(() => {
      const worldB = new GameWorld({ tickRate: 10 });
      const entity = new Entity();
      worldB.entityManager.addEntity(entity);
      expect(entity.id).toBe(1);
      worldB.dispose();
    });

    let continued = 0;
    scopeA.run(() => {
      const entity = new Entity();
      continued = entity.id;
      const world = worlds[0];
      const store = world?.entityManager.getSoAStore(PROBE_SCHEMA);
      expect(store?.entityIds()).toEqual([firstId]);
      expect(store?.arrays.n[store.indexOf(firstId)]).toBe(4n);
    });

    expect(firstId).toBe(1);
    expect(continued).toBe(2);
    worlds[0]?.dispose();
  });

  it('does not rewind the counter when run re-enters the same scope', () => {
    const scope = new WorldScope();
    scope.run(() => {
      new GameWorld({ tickRate: 10 });
      const first = new Entity();
      scope.run(() => {
        const nested = new Entity();
        expect(nested.id).toBe(first.id + 1);
      });
    });
  });
});
