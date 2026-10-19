import { afterEach, describe, expect, it } from 'vitest';
import {
  BinaryStateReader,
  BinaryStateWriter,
  GameWorld,
  SoAComponent,
  resetEntityIdCounter,
  type SaveSection,
} from '@phalanx-engine/ecs';
import { DeterministicRandom } from '@phalanx-engine/math';
import {
  ENGINE_SNAPSHOT_FORMAT,
  LocalTransport,
  MatchResumeError,
  MatchRunner,
  MemoryMatchStore,
  SnapshotRejectedError,
  checkSnapshotCompatibility,
  decodeSnapshot,
  encodeSnapshot,
} from '../../src/index.js';
import { TinyGame, type TinyConfig } from '../fixtures/tinyGame.js';

function world(): GameWorld {
  return new GameWorld({ random: new DeterministicRandom(1) });
}

function probe(key: string, seen: string[]): SaveSection {
  return {
    key,
    version: 1,
    write(writer) {
      writer.str(key);
    },
    read(reader) {
      seen.push(key);
      expect(reader.str()).toBe(key);
    },
  };
}

interface ListedSection {
  readonly key: string;
  readonly body: Uint8Array;
}

function topLevelSections(bytes: Uint8Array): ListedSection[] {
  const reader = new BinaryStateReader(bytes);
  const sections: ListedSection[] = [];
  while (reader.remainingBytes().byteLength > 0) {
    const key = reader.str();
    reader.varint();
    sections.push({ key, body: reader.bytes() });
  }
  return sections;
}

function moduleEntries(bytes: Uint8Array): { key: string; version: number }[] {
  const modules = topLevelSections(bytes).find(
    (section) => section.key === 'modules'
  );
  if (modules === undefined) {
    throw new Error('missing modules section');
  }
  const reader = new BinaryStateReader(modules.body);
  const count = reader.varint();
  const entries: { key: string; version: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    const key = reader.str();
    const version = reader.varint();
    reader.bytes();
    entries.push({ key, version });
  }
  reader.done();
  return entries;
}

function replaceModules(
  bytes: Uint8Array,
  entries: readonly { readonly key: string; readonly version: number }[]
): Uint8Array {
  const reader = new BinaryStateReader(bytes);
  let start = -1;
  let end = -1;
  while (reader.remainingBytes().byteLength > 0) {
    const at = bytes.byteLength - reader.remainingBytes().byteLength;
    const key = reader.str();
    reader.varint();
    reader.bytes();
    const after = bytes.byteLength - reader.remainingBytes().byteLength;
    if (key === 'modules') {
      start = at;
      end = after;
    }
  }
  if (start < 0 || end !== bytes.byteLength) {
    throw new Error('modules section is not the trailing section');
  }
  const writer = new BinaryStateWriter();
  writer.section('modules', 1, (section) => {
    section.list(entries, (entry, item) => {
      item.section(entry.key, entry.version, () => {});
    });
  });
  const encoded = writer.finish();
  const out = new Uint8Array(start + encoded.byteLength);
  out.set(bytes.subarray(0, start));
  out.set(encoded, start);
  return out;
}

function tinyConfig(matchId: string): TinyConfig {
  return {
    matchId,
    gameId: 'tiny',
    simVersion: 'tiny-1',
    seed: 7,
    side: 'client',
    inputDelayTicks: 2,
    arenaSize: 2_000_000_000,
    slots: [{ slot: 0, team: 0, kind: 'human', playerId: 'local:0', color: 1 }],
  };
}

describe('module save sections', () => {
  afterEach(() => {
    SoAComponent.resetContext();
    resetEntityIdCounter();
  });

  it('writes registered sections in ascending key order and restores them', () => {
    const seen: string[] = [];
    const source = world();
    source.registerSaveSection(probe('b', seen));
    source.registerSaveSection(probe('a', seen));
    const bytes = source.save();
    expect(moduleEntries(bytes).map((entry) => entry.key)).toEqual(['a', 'b']);

    const target = world();
    target.registerSaveSection(probe('b', seen));
    target.registerSaveSection(probe('a', seen));
    target.restore(bytes);
    expect(seen).toEqual(['a', 'b']);
  });

  it('rejects an unknown section with the registered key list', () => {
    const source = world();
    source.registerSaveSection(probe('b', []));
    source.registerSaveSection(probe('a', []));
    const bytes = replaceModules(source.save(), [
      { key: 'a', version: 1 },
      { key: 'b', version: 1 },
      { key: 'x', version: 1 },
    ]);
    const target = world();
    target.registerSaveSection(probe('b', []));
    target.registerSaveSection(probe('a', []));
    expect(() => target.restore(bytes)).toThrow(
      "restore: unknown save section 'x' (registered: a, b)"
    );
  });

  it('rejects a snapshot that omits a registered section', () => {
    const source = world();
    source.registerSaveSection(probe('b', []));
    source.registerSaveSection(probe('a', []));
    const bytes = replaceModules(source.save(), [{ key: 'a', version: 1 }]);
    const target = world();
    target.registerSaveSection(probe('b', []));
    target.registerSaveSection(probe('a', []));
    expect(() => target.restore(bytes)).toThrow(
      "restore: save section 'b' is missing from the snapshot"
    );
  });

  it('rejects sections that are not in key order', () => {
    const source = world();
    source.registerSaveSection(probe('b', []));
    source.registerSaveSection(probe('a', []));
    const bytes = replaceModules(source.save(), [
      { key: 'b', version: 1 },
      { key: 'a', version: 1 },
    ]);
    const target = world();
    target.registerSaveSection(probe('b', []));
    target.registerSaveSection(probe('a', []));
    expect(() => target.restore(bytes)).toThrow(
      'restore: save sections out of order'
    );
  });

  it('rejects a section whose version does not match the registry', () => {
    const source = world();
    source.registerSaveSection(probe('b', []));
    source.registerSaveSection(probe('a', []));
    const bytes = replaceModules(source.save(), [
      { key: 'a', version: 9 },
      { key: 'b', version: 1 },
    ]);
    const target = world();
    target.registerSaveSection(probe('b', []));
    target.registerSaveSection(probe('a', []));
    expect(() => target.restore(bytes)).toThrow(
      "restore: save section 'a' has version 9, expected 1"
    );
  });

  it('rejects an engine snapshot format 2', async () => {
    expect(ENGINE_SNAPSHOT_FORMAT).toBe(3);
    expect(
      checkSnapshotCompatibility(
        {
          magic: 'PHXS',
          engineFormat: 2,
          gameId: 'tiny',
          simVersion: 'tiny-1',
          formatVersion: 1,
          configHash: 'ab'.repeat(8),
          tick: 1,
          digest: 'cd'.repeat(8),
        },
        {
          engineFormat: ENGINE_SNAPSHOT_FORMAT,
          gameId: 'tiny',
          simVersion: 'tiny-1',
          formatVersion: 1,
          configHash: 'ab'.repeat(8),
        }
      )
    ).toEqual({
      decision: 'reject',
      reason: 'unsupported engine snapshot format 2; expected 3',
    });

    const matchId = 'format-2';
    const transport = LocalTransport.stepped();
    const runner = new MatchRunner(TinyGame, tinyConfig(matchId), transport);
    runner.start();
    transport.step(2);
    const decoded = decodeSnapshot(runner.snapshot());
    runner.dispose();
    const rewritten = encodeSnapshot(
      { ...decoded.header, engineFormat: 2 },
      decoded.body,
      {
        botState: decoded.botState,
        inputCheckpoint: decoded.inputCheckpoint,
        componentSchemas: decoded.componentSchemas,
      }
    );
    const store = new MemoryMatchStore();
    await store.saveHeader(matchId, tinyConfig(matchId));
    await store.saveSnapshot(matchId, decoded.header.tick, rewritten);

    const error = await MatchRunner.resumeLocal(TinyGame, store, matchId).then(
      () => {
        throw new Error('resumeLocal accepted format 2');
      },
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(MatchResumeError);
    if (!(error instanceof MatchResumeError)) return;
    expect(error.cause).toBeInstanceOf(SnapshotRejectedError);
    expect((error.cause as Error).message).toBe(
      'snapshot rejected: unsupported engine snapshot format 2; expected 3'
    );
  });

  it('rejects trailing bytes in a module section body', () => {
    const source = world();
    source.registerSaveSection({
      key: 'a',
      version: 1,
      write(writer) {
        writer.str('a');
        writer.u8(1);
      },
      read(reader) {
        expect(reader.str()).toBe('a');
      },
    });
    const bytes = source.save();
    const target = world();
    target.registerSaveSection({
      key: 'a',
      version: 1,
      write() {},
      read(reader) {
        expect(reader.str()).toBe('a');
      },
    });
    expect(() => target.restore(bytes)).toThrow(
      'StateReader.done: 1 unread byte(s) remain'
    );
  });

  it('rejects a modules container whose version is not 1', () => {
    const source = world();
    const saved = source.save();
    const reader = new BinaryStateReader(saved);
    let start = -1;
    let body: Uint8Array | undefined;
    while (reader.remainingBytes().byteLength > 0) {
      const at = saved.byteLength - reader.remainingBytes().byteLength;
      const key = reader.str();
      reader.varint();
      const sectionBody = reader.bytes();
      if (key === 'modules') {
        start = at;
        body = sectionBody;
      }
    }
    if (start < 0 || body === undefined) {
      throw new Error('modules section is not present');
    }
    const writer = new BinaryStateWriter();
    writer.str('modules');
    writer.varint(2);
    writer.bytes(body);
    const encoded = writer.finish();
    const rewritten = new Uint8Array(start + encoded.byteLength);
    rewritten.set(saved.subarray(0, start));
    rewritten.set(encoded, start);
    expect(() => world().restore(rewritten)).toThrow(
      "restore: save section 'modules' has version 2, expected 1"
    );
  });

  it('rejects a save when physics is assigned without its section', () => {
    const source = world();
    source.context.physics = {
      getInterpolatedTransform: () => undefined,
      getEntityPosition: () => undefined,
      applyImpulse: () => {},
    };
    expect(() => source.save()).toThrow(
      "save: physics is assigned but save section 'physics.broadphase' is not registered; call PhysicsWorld.attach(world)"
    );
  });

  it('round-trips a world that registered no sections', () => {
    const source = world();
    const bytes = source.save();
    expect(
      topLevelSections(bytes).some((section) => section.key === 'modules')
    ).toBe(true);
    expect(moduleEntries(bytes)).toEqual([]);
    const target = world();
    target.restore(bytes);
    expect(target.save()).toEqual(bytes);
  });
});
