import { describe, expect, it } from 'vitest';
import { GameSystem, GameWorld, defineComponent } from '../src/index.js';
import type { Entity, QueryComponent } from '../src/index.js';
import {
  manualTickProvider,
  ManualTickProvider,
} from './support/manualTickProvider.js';

const Hp = defineComponent('Hp', { hp: 'i32' });
const Tag = defineComponent('Tag', {
  kind: 'object',
  create: () => ({ label: '' }),
  save(value, writer) {
    writer.str(value.label);
  },
  load(reader) {
    return { label: reader.str() };
  },
});
const Visual = defineComponent('Visual', {
  kind: 'transient',
  create: () => ({ x: 0 }),
});

function world(provider = manualTickProvider()): GameWorld {
  const game = new GameWorld({ tickFrameProvider: provider });
  game.registerComponent(Hp);
  game.registerComponent(Tag);
  game.registerComponent(Visual);
  return game;
}

function spawn(game: GameWorld, id: number, hp: number, label?: string) {
  const entity = game.createEntityWithId(id);
  game.addComponent(entity, Hp, { hp });
  if (label !== undefined) game.addComponent(entity, Tag, { label });
  return entity;
}

function hpArray(game: GameWorld): Int32Array {
  const store = game.entityManager.getSoAStore(Hp.schema);
  if (store === undefined) throw new Error('Hp store missing');
  return store.arrays.hp as Int32Array;
}

describe('world.query', () => {
  it('visits entities ascending by id with a row index and values', () => {
    const game = world();
    spawn(game, 3, 30, 'c');
    spawn(game, 1, 10, 'a');
    spawn(game, 2, 20);

    const hp = hpArray(game);
    const seen: [number, number, string][] = [];
    for (const [entity, row, tag] of game.query(Hp, Tag)) {
      seen.push([entity.id, hp[row]!, tag.label]);
    }

    expect(seen).toEqual([
      [1, 10, 'a'],
      [3, 30, 'c'],
    ]);
  });

  it('reuses one row array', () => {
    const game = world();
    spawn(game, 1, 1);
    spawn(game, 2, 2);

    const rows: unknown[] = [];
    for (const row of game.query(Hp)) rows.push(row);

    expect(rows[0]).toBe(rows[1]);
  });

  it('skips an entity removed ahead of the cursor and keeps others intact', () => {
    const game = world();
    const entities = [1, 2, 3, 4].map((id) => spawn(game, id, id * 10));
    const hp = hpArray(game);

    const seen: [number, number][] = [];
    for (const [entity, row] of game.query(Hp)) {
      if (entity.id === 1) {
        // Swap-and-pop moves the last row (id 4) into id 2's slot.
        game.entityManager.removeEntity(entities[1]!);
      }
      seen.push([entity.id, hp[row]!]);
    }

    expect(seen).toEqual([
      [1, 10],
      [3, 30],
      [4, 40],
    ]);
  });

  it('skips an entity that lost a component before its turn', () => {
    const game = world();
    const entities = [1, 2, 3].map((id) => spawn(game, id, id, 'x'));

    const seen: number[] = [];
    for (const [entity] of game.query(Hp, Tag)) {
      if (entity.id === 1) {
        game.removeComponent(entities[1]!, Tag);
        game.removeComponent(entities[2]!, Hp);
      }
      seen.push(entity.id);
    }

    expect(seen).toEqual([1]);
  });

  it('does not visit entities created during the loop', () => {
    const game = world();
    spawn(game, 1, 1);
    spawn(game, 2, 2);

    const seen: number[] = [];
    for (const [entity] of game.query(Hp)) {
      if (entity.id === 1) spawn(game, 10, 100);
      seen.push(entity.id);
    }

    expect(seen).toEqual([1, 2]);
    expect([...game.query(Hp)].length).toBe(3);
  });

  it('throws on an empty component list', () => {
    const game = world();
    spawn(game, 1, 1);
    expect(() => [...game.query()]).toThrow(
      'world.query: pass at least one component'
    );
    expect(() => [...game.queryAny()]).toThrow(
      'world.queryAny: pass at least one component'
    );
  });

  it('throws when a SoA component has no row in its store', () => {
    const game = world();
    spawn(game, 1, 1);
    game.entityManager.getSoAStore(Hp.schema)?.remove(1);
    expect(() => [...game.query(Hp)]).toThrow(
      "world.query: entity 1 component 'Hp' is out of sync with its store"
    );
  });

  it('types a widened component slot as number | object', () => {
    const game = world();
    spawn(game, 1, 7);
    const widened: QueryComponent = Hp;
    const slots: (number | object)[] = [];
    for (const [, slot] of game.query(widened)) slots.push(slot);
    expect(slots).toEqual([0]);
  });

  it('throws for an unregistered component', () => {
    const game = new GameWorld({ tickFrameProvider: manualTickProvider() });
    expect(() => [...game.query(Hp)]).toThrow(
      "world.query: component 'Hp' is not registered"
    );
  });

  it('throws when a tick system reads a transient component', () => {
    const provider = new ManualTickProvider();
    const game = world(provider);
    const entity = spawn(game, 1, 1);
    game.addComponent(entity, Visual);

    class Reader extends GameSystem {
      public override processTick(): void {
        for (const _row of this.world.query(Visual)) {
          // no-op
        }
      }
    }
    game.addSystem(new Reader(), { phase: 'late' });

    expect(() => game.processAllTicks(1)).toThrow(
      "tick system must not branch on transient component 'Visual'"
    );
    expect([...game.query(Visual)].length).toBe(1);
  });
});

describe('world.queryAny', () => {
  it('yields undefined for absent components, ascending by id', () => {
    const game = world();
    spawn(game, 2, 20);
    const tagOnly = game.createEntityWithId(1);
    game.addComponent(tagOnly, Tag, { label: 't' });
    game.createEntityWithId(3);

    const seen: [number, boolean, string | undefined][] = [];
    for (const [entity, row, tag] of game.queryAny(Hp, Tag)) {
      seen.push([entity.id, row !== undefined, tag?.label]);
    }

    expect(seen).toEqual([
      [1, false, 't'],
      [2, true, undefined],
    ]);
  });

  it('skips an entity that lost every queried component', () => {
    const game = world();
    const entities: Entity[] = [1, 2].map((id) => spawn(game, id, id));

    const seen: number[] = [];
    for (const [entity] of game.queryAny(Hp, Tag)) {
      if (entity.id === 1) game.removeComponent(entities[1]!, Hp);
      seen.push(entity.id);
    }

    expect(seen).toEqual([1]);
  });
});
