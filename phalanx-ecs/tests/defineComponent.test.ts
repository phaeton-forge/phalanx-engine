import { afterEach, describe, expect, it } from 'vitest';
import {
  BinaryStateReader,
  BinaryStateWriter,
  GameSystem,
  GameWorld,
  ValueComponent,
  defineComponent,
  writeSorted,
} from '../src/index.js';
import {
  manualTickProvider,
  ManualTickProvider,
} from './support/manualTickProvider.js';

function world(): GameWorld {
  return new GameWorld({ tickFrameProvider: manualTickProvider() });
}

describe('defineComponent', () => {
  it('leaves a module-owned object component to its module', () => {
    const game = world();
    const owned = defineComponent('Owned', {
      kind: 'object',
      create: () => ({ n: 0 }),
      save(value, writer) {
        writer.i32(value.n);
      },
      load: (reader) => ({ n: reader.i32() }),
    });
    game.registerComponent(owned, {
      module: 'demo',
      attachWith: 'demo.attach()',
    });
    expect(game.saveSections).toEqual([]);
    expect(() => game.registerComponent(owned)).toThrow('already registered');

    const entity = game.createEntityWithId(1);
    expect(() => game.addComponent(entity, owned)).toThrow(
      "world.addComponent: 'Owned' is owned by demo; attach it with demo.attach()"
    );
    entity.addComponents([new ValueComponent(owned.type, { n: 3 })]);
    game.entityManager.onComponentAdded(entity, owned.type);
    expect(game.getComponent(entity, owned)).toEqual({ n: 3 });
    expect([...game.query(owned)].map(([e]) => e.id)).toEqual([1]);
  });

  it('stores SoA, object, and transient values through the world', () => {
    const game = world();
    const hp = defineComponent('Hp', { hp: 'i64', armor: 'i32' });
    const bag = defineComponent('Bag', {
      kind: 'object',
      create: () => ({ tags: new Set<string>() }),
      save(value, writer) {
        writeSorted(writer, value.tags, (tag, item) => {
          item.str(tag);
        });
      },
      load(reader) {
        const tags = new Set<string>();
        for (const tag of reader.list((item) => item.str())) tags.add(tag);
        return { tags };
      },
    });
    const visual = defineComponent('Visual', {
      kind: 'transient',
      create: () => ({ x: 0, label: '' }),
    });
    game.registerComponent(hp);
    game.registerComponent(bag);
    game.registerComponent(visual);

    const entity = game.createEntityWithId(1);
    game.addComponent(entity, hp, { hp: 4n, armor: 2 });
    game.addComponent(entity, bag);
    game.getComponent(entity, bag)?.tags.add('a');
    game.addComponent(entity, visual, { x: 1.5, label: 'spark' });

    expect(game.getComponent(entity, hp)).toEqual({ hp: 4n, armor: 2 });
    expect(game.getComponent(entity, bag)?.tags.has('a')).toBe(true);
    expect(game.getComponent(entity, visual)).toEqual({
      x: 1.5,
      label: 'spark',
    });
    expect(game.componentNames()).toEqual(['Hp']);
    expect(game.saveSections.map((section) => section.key)).toEqual(['Bag']);

    game.addComponent(entity, hp, { hp: 9n });
    expect(game.getComponent(entity, hp)).toEqual({ hp: 9n, armor: 2 });

    game.addComponent(entity, hp, { hp: undefined, armor: undefined });
    expect(game.getComponent(entity, hp)).toEqual({ hp: 9n, armor: 2 });

    expect(game.removeComponent(entity, visual)).toBe(true);
    expect(game.getComponent(entity, visual)).toBeUndefined();
    expect(game.removeComponent(entity, hp)).toBe(true);
    expect(game.getComponent(entity, hp)).toBeUndefined();
  });

  it('treats an explicit undefined SoA field as omitted', () => {
    const game = world();
    const hp = defineComponent(
      'Hp',
      { hp: 'i64', armor: 'i32' },
      { defaults: { hp: 5n, armor: 1 } }
    );
    game.registerComponent(hp);
    const entity = game.createEntityWithId(1);

    game.addComponent(entity, hp, { hp: undefined, armor: 3 });
    expect(game.getComponent(entity, hp)).toEqual({ hp: 5n, armor: 3 });

    game.addComponent(entity, hp, { hp: 9n });
    game.addComponent(entity, hp, { hp: undefined });
    expect(game.getComponent(entity, hp)).toEqual({ hp: 9n, armor: 3 });

    game.addComponent(entity, hp, { armor: undefined, hp: 1n });
    expect(game.getComponent(entity, hp)).toEqual({ hp: 1n, armor: 3 });
  });

  it('rejects an object component without save and load at registration', () => {
    const game = world();
    const bare = defineComponent('Bag', {
      kind: 'object',
      create: () => ({ tags: new Set<string>() }),
    });
    const saveOnly = defineComponent('Bag', {
      kind: 'object',
      create: () => ({ tags: new Set<string>() }),
      save() {},
    });
    const loadOnly = defineComponent('Bag', {
      kind: 'object',
      create: () => ({ tags: new Set<string>() }),
      load: () => ({ tags: new Set<string>() }),
    });
    expect(() => game.registerComponent(bare)).toThrow(
      "registerComponent: object component 'Bag' requires save and load"
    );
    expect(() => game.registerComponent(saveOnly)).toThrow(
      /requires save and load/
    );
    expect(() => game.registerComponent(loadOnly)).toThrow(
      /requires save and load/
    );
    expect(game.saveSections).toEqual([]);
    expect(game.componentNames()).toEqual([]);
  });

  it('writes a Set and a Map in key order', () => {
    const setBytes = (order: readonly string[]): Uint8Array => {
      const tags = new Set<string>();
      for (const tag of order) tags.add(tag);
      const writer = new BinaryStateWriter();
      writeSorted(writer, tags, (tag, item) => {
        item.str(tag);
      });
      return writer.finish();
    };
    const alphaFirst = setBytes(['alpha', 'zeta', 'Z']);
    expect(setBytes(['zeta', 'Z', 'alpha'])).toEqual(alphaFirst);
    const reader = new BinaryStateReader(alphaFirst);
    expect(reader.list((item) => item.str())).toEqual(['Z', 'alpha', 'zeta']);
    reader.done();

    const mapBytes = (order: readonly number[]): Uint8Array => {
      const counts = new Map<number, number>();
      for (const key of order) counts.set(key, key + 1);
      const writer = new BinaryStateWriter();
      writeSorted(writer, counts, (key, item) => {
        item.i32(key);
        const count = counts.get(key);
        if (count === undefined) {
          throw new Error(`missing ${String(key)}`);
        }
        item.i32(count);
      });
      return writer.finish();
    };
    const numeric = mapBytes([10, 2]);
    expect(mapBytes([2, 10])).toEqual(numeric);
    const numbers = new BinaryStateReader(numeric);
    expect(numbers.list((item) => [item.i32(), item.i32()])).toEqual([
      [2, 3],
      [10, 11],
    ]);
    numbers.done();

    expect(() => {
      const writer = new BinaryStateWriter();
      writeSorted(writer, new Set([1.5]), (key, item) => {
        item.i32(key);
      });
    }).toThrow(/safe integer/);
  });

  it('rejects float SoA fields and reserved names', () => {
    expect(() => defineComponent('Visual', { x: 'f32' as 'i32' })).toThrow(
      /f32/
    );
    expect(() => defineComponent('Visual', { x: 'f64' as 'i32' })).toThrow(
      /f64/
    );
    expect(() => defineComponent('Bad', { a: 'u16' as 'i32' })).toThrow(
      /allowed types/
    );
    expect(() => defineComponent('gas', { n: 'u8' })).toThrow(/reserved/);
  });

  it('stops a tick system from branching on a transient component', () => {
    const game = world();
    const visual = defineComponent('Visual', {
      kind: 'transient',
      create: () => ({ x: 0 }),
    });
    game.registerComponent(visual);
    const entity = game.createEntityWithId(1);
    game.addComponent(entity, visual, { x: 4 });

    class Branch extends GameSystem {
      public override processTick(): void {
        const value = this.world.getComponent(entity, visual);
        if (value !== undefined && value.x > 0) {
          this.world.addComponent(entity, visual, { x: 0 });
        }
      }
    }
    game.registerSystems([new Branch()], []);
    expect(() => game.processAllTicks(1)).toThrow(
      "tick system must not branch on transient component 'Visual'"
    );
    expect(game.getComponent(entity, visual)?.x).toBe(4);
  });

  it('stops a tick system from branching on hasComponents', () => {
    const game = world();
    const visual = defineComponent('Visual', {
      kind: 'transient',
      create: () => ({ x: 0 }),
    });
    game.registerComponent(visual);
    const entity = game.createEntityWithId(1);
    game.addComponent(entity, visual, { x: 4 });

    class Branch extends GameSystem {
      public saw = false;

      public override processTick(): void {
        this.saw = entity.hasComponents(visual.type);
      }
    }
    const branch = new Branch();
    game.registerSystems([branch], []);
    expect(() => game.processAllTicks(1)).toThrow(
      "tick system must not branch on transient component 'Visual'"
    );
    expect(branch.saw).toBe(false);
    expect(entity.hasComponents(visual.type)).toBe(true);
  });

  it('lets a tick system write a transient component and a frame system read it', () => {
    const game = world();
    const visual = defineComponent('Visual', {
      kind: 'transient',
      create: () => ({ x: 0 }),
    });
    game.registerComponent(visual);
    const entity = game.createEntityWithId(1);

    class Write extends GameSystem {
      public override processTick(): void {
        this.world.addComponent(entity, visual, { x: 3 });
      }
    }
    class Read extends GameSystem {
      public seen: number | undefined;
      public override update(): void {
        this.seen = this.world.getComponent(entity, visual)?.x;
      }
    }
    const read = new Read();
    game.registerSystems([new Write(), new Read()], [read]);
    game.processAllTicks(1);
    game.updateAll(0.016);
    expect(read.seen).toBe(3);
    expect(game.getComponent(entity, visual)?.x).toBe(3);
  });

  it('rejects a component name already used by a save section', () => {
    const game = world();
    game.registerSaveSection({
      key: 'Hp',
      version: 1,
      write() {},
      read() {},
    });
    const hp = defineComponent('Hp', { hp: 'i32' });
    expect(() => game.registerComponent(hp)).toThrow(
      "registerComponent: 'Hp' is already registered"
    );
    expect(game.componentNames()).toEqual([]);
  });

  it('guards getComponent, hasComponent, and queryEntities during a tick', () => {
    const game = world();
    const visual = defineComponent('Visual', {
      kind: 'transient',
      create: () => ({ x: 1 }),
    });
    game.registerComponent(visual);
    const entity = game.createEntityWithId(1);
    game.addComponent(entity, visual);

    class ReadComponent extends GameSystem {
      public override processTick(): void {
        entity.getComponent(visual.type);
      }
    }
    game.registerSystems([new ReadComponent()], []);
    expect(() => game.processAllTicks(1)).toThrow(
      "tick system must not branch on transient component 'Visual'"
    );

    class ReadPresence extends GameSystem {
      public override processTick(): void {
        entity.hasComponent(visual.type);
      }
    }
    game.registerSystems([new ReadPresence()], []);
    expect(() => game.processAllTicks(1)).toThrow(
      "tick system must not branch on transient component 'Visual'"
    );

    class ReadQuery extends GameSystem {
      public override processTick(): void {
        this.entityManager.queryEntities(visual.type);
      }
    }
    game.registerSystems([new ReadQuery()], []);
    expect(() => game.processAllTicks(1)).toThrow(
      "tick system must not branch on transient component 'Visual'"
    );
    expect(game.getComponent(entity, visual)?.x).toBe(1);
  });

  it('lets afterTick read a transient component', () => {
    const provider = new ManualTickProvider();
    const game = new GameWorld({ tickFrameProvider: provider });
    const visual = defineComponent('Visual', {
      kind: 'transient',
      create: () => ({ x: 0 }),
    });
    game.registerComponent(visual);
    const entity = game.createEntityWithId(1);
    game.addComponent(entity, visual, { x: 2 });

    class After extends GameSystem {
      public seen: number | undefined;

      public afterTick(): void {
        this.seen = this.world.getComponent(entity, visual)?.x;
        entity.getComponent(visual.type);
        this.entityManager.queryEntities(visual.type);
      }
    }
    const after = new After();
    let hookSeen: number | undefined;
    game.registerSystems([after], []);
    game.start({
      afterTick() {
        hookSeen = game.getComponent(entity, visual)?.x;
      },
    });
    provider.step(1);
    expect(after.seen).toBe(2);
    expect(hookSeen).toBe(2);
    game.stop();
  });

  it('writes a SoA row into the world that was asked, not the global context', () => {
    const hp = defineComponent('Hp', { hp: 'i64' });
    const a = world();
    a.registerComponent(hp);
    const b = world();
    const entity = a.createEntityWithId(1);
    a.addComponent(entity, hp, { hp: 7n });

    const storeA = a.entityManager.getSoAStore(hp.schema);
    if (storeA === undefined) throw new Error('missing store on A');
    expect(storeA.indexOf(entity.id)).toBeGreaterThanOrEqual(0);
    expect(a.getComponent(entity, hp)).toEqual({ hp: 7n });
    expect(
      b.entityManager.getSoAStore(hp.schema)?.indexOf(entity.id) ?? -1
    ).toBe(-1);

    const row = entity.getComponent(hp.type);
    if (
      row === undefined ||
      !('onSpawn' in row) ||
      !('onDespawn' in row) ||
      typeof row.onSpawn !== 'function' ||
      typeof row.onDespawn !== 'function'
    ) {
      throw new Error('missing poolable row');
    }
    row.onDespawn();
    expect(storeA.indexOf(entity.id)).toBe(-1);
    row.onSpawn();
    expect(storeA.indexOf(entity.id)).toBeGreaterThanOrEqual(0);
    expect(a.getComponent(entity, hp)).toEqual({ hp: 7n });
    expect(
      b.entityManager.getSoAStore(hp.schema)?.indexOf(entity.id) ?? -1
    ).toBe(-1);
  });
});
