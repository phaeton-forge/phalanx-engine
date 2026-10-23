import { afterEach, describe, expect, it } from 'vitest';
import {
  Entity,
  GameWorld,
  SoAComponent,
  defineComponent,
  writeSorted,
  type IPoolableEntity,
  type SaveSection,
} from '@phalanx-engine/ecs';
import { DeterministicRandom } from '@phalanx-engine/math';
import { configHash, restoreWorld, saveWorld } from '../../src/index.js';
import { componentSchemaHashes } from '../../src/world/schemaHash.js';
import { manualTickProvider } from '../support/manualTickProvider.js';

function world(): GameWorld {
  return new GameWorld({
    tickFrameProvider: manualTickProvider(),
    random: new DeterministicRandom(1),
  });
}

function tagsComponent() {
  return defineComponent('Tags', {
    kind: 'object' as const,
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
}

describe('ecs defineComponent save', () => {
  afterEach(() => {
    SoAComponent.resetContext();
  });

  it('saves SoA rows and restores them', () => {
    const source = world();
    const hp = defineComponent('Hp', { hp: 'i64', armor: 'i32' });
    source.registerComponent(hp);
    const entity = source.createEntityWithId(1);
    source.add(entity, hp, { hp: 9n, armor: 2 });
    const bytes = saveWorld(source);

    const restored = world();
    restored.registerComponent(hp);
    restoreWorld(restored, bytes);
    const next = restored.entityManager.getEntity(1);
    if (next === undefined) throw new Error('entity 1 missing');
    expect(restored.get(next, hp)).toEqual({ hp: 9n, armor: 2 });
  });

  it('saves a Set in the same bytes for either insertion order', () => {
    const saveTags = (order: readonly string[]): Uint8Array => {
      const game = world();
      const tags = tagsComponent();
      game.registerComponent(tags);
      const entity = game.createEntityWithId(1);
      game.add(entity, tags);
      const value = game.get(entity, tags);
      if (value === undefined) throw new Error('tags missing');
      for (const tag of order) value.tags.add(tag);
      return saveWorld(game);
    };
    const bytes = saveTags(['zeta', 'alpha', 'mid']);
    expect(saveTags(['alpha', 'mid', 'zeta'])).toEqual(bytes);

    const restored = world();
    const tags = tagsComponent();
    restored.registerComponent(tags);
    restoreWorld(restored, bytes);
    const entity = restored.entityManager.getEntity(1);
    if (entity === undefined) throw new Error('entity 1 missing');
    expect([...(restored.get(entity, tags)?.tags ?? [])]).toEqual([
      'alpha',
      'mid',
      'zeta',
    ]);
  });

  it('keeps save bytes and configHash stable when a transient component is added', () => {
    const hp = defineComponent('Hp', { hp: 'i64' });
    const visual = defineComponent('Visual', {
      kind: 'transient',
      create: () => ({ x: 0 }),
    });
    const source = world();
    source.registerComponent(hp);
    const entity = source.createEntityWithId(1);
    source.add(entity, hp, { hp: 3n });
    const before = saveWorld(source);
    const hashBefore = configHash({ seed: 1 }, componentSchemaHashes(source));

    source.registerComponent(visual);
    source.add(entity, visual, { x: 1.25 });
    expect(saveWorld(source)).toEqual(before);
    expect(configHash({ seed: 1 }, componentSchemaHashes(source))).toBe(
      hashBefore
    );
    expect(componentSchemaHashes(source)).toEqual([
      { name: 'Hp', fields: [['hp', 'i64']] },
    ]);

    const restored = world();
    restored.registerComponent(hp);
    restored.registerComponent(visual);
    const kept = restored.createEntityWithId(1);
    restored.add(kept, hp, { hp: 0n });
    restored.add(kept, visual, { x: 9 });
    restoreWorld(restored, before);
    expect(restored.get(kept, visual)).toBeUndefined();
    expect(restored.get(kept, hp)?.hp).toBe(3n);
  });

  it('lets the owner section put a transient component back after restore', () => {
    const hp = defineComponent('Hp', { hp: 'i64' });
    const visual = defineComponent('Visual', {
      kind: 'transient',
      create: () => ({ x: 0 }),
    });
    const owner: SaveSection = {
      key: 'visuals',
      version: 1,
      write() {},
      read(_reader, restored) {
        for (const entity of restored.entityManager.getAllEntities()) {
          restored.add(entity, visual);
        }
      },
    };
    const source = world();
    source.registerComponent(hp);
    source.registerComponent(visual);
    source.registerSaveSection(owner);
    const entity = source.createEntityWithId(1);
    source.add(entity, hp, { hp: 1n });
    source.add(entity, visual, { x: 8 });
    const bytes = saveWorld(source);

    const restored = world();
    restored.registerComponent(hp);
    restored.registerComponent(visual);
    restored.registerSaveSection(owner);
    restoreWorld(restored, bytes);
    const next = restored.entityManager.getEntity(1);
    if (next === undefined) throw new Error('entity 1 missing');
    expect(restored.get(next, visual)).toEqual({ x: 0 });
    expect(restored.get(next, hp)?.hp).toBe(1n);
  });

  it('saves a Map with numeric keys in numeric order', () => {
    const counts = defineComponent('Counts', {
      kind: 'object',
      create: () => ({ values: new Map<number, number>() }),
      save(value, writer) {
        writeSorted(writer, value.values, (key, item) => {
          item.i32(key);
          const count = value.values.get(key);
          if (count === undefined) {
            throw new Error(`missing ${String(key)}`);
          }
          item.i32(count);
        });
      },
      load(reader) {
        const values = new Map<number, number>();
        for (const pair of reader.list(
          (item) => [item.i32(), item.i32()] as const
        )) {
          values.set(pair[0], pair[1]);
        }
        return { values };
      },
    });
    const save = (order: readonly number[]): Uint8Array => {
      const game = world();
      game.registerComponent(counts);
      const entity = game.createEntityWithId(1);
      game.add(entity, counts);
      const value = game.get(entity, counts);
      if (value === undefined) throw new Error('counts missing');
      for (const key of order) value.values.set(key, key + 1);
      return saveWorld(game);
    };
    const bytes = save([10, 2]);
    expect(save([2, 10])).toEqual(bytes);

    const restored = world();
    restored.registerComponent(counts);
    restoreWorld(restored, bytes);
    const entity = restored.entityManager.getEntity(1);
    if (entity === undefined) throw new Error('entity 1 missing');
    expect([...(restored.get(entity, counts)?.values ?? [])]).toEqual([
      [2, 3],
      [10, 11],
    ]);
  });

  it('drops object components on pool despawn so a respawn matches a restore', () => {
    const note = defineComponent('Note', {
      kind: 'object',
      create: () => ({ text: '' }),
      save(value, writer) {
        writer.str(value.text);
      },
      load(reader) {
        return { text: reader.str() };
      },
    });

    class NoteEntity extends Entity implements IPoolableEntity<void> {
      public onSpawn(): void {}

      public onDespawn(): void {}
    }

    const make = (): GameWorld =>
      new GameWorld({
        tickFrameProvider: manualTickProvider(),
        random: new DeterministicRandom(1),
        pooling: {
          entityTypes: {
            note: {
              factory: (id) => new NoteEntity(id),
              pool: { initialSize: 1 },
            },
          },
        },
      });

    const live = make();
    live.registerComponent(note);
    live.start();
    const pools = live.pools;
    if (pools === null) throw new Error('pools missing');
    const first = pools.spawn<NoteEntity>('note', undefined);
    live.add(first, note, { text: 'stale' });
    pools.despawn(first);
    const bytes = saveWorld(live);

    const restored = make();
    restored.registerComponent(note);
    restored.start();
    restoreWorld(restored, bytes);

    const againLive = pools.spawn<NoteEntity>('note', undefined);
    const restoredPools = restored.pools;
    if (restoredPools === null) throw new Error('restored pools missing');
    const againRestored = restoredPools.spawn<NoteEntity>('note', undefined);
    expect(live.get(againLive, note)).toBeUndefined();
    expect(restored.get(againRestored, note)).toBeUndefined();
    expect(saveWorld(live)).toEqual(saveWorld(restored));
    live.stop();
    restored.stop();
  });
});
