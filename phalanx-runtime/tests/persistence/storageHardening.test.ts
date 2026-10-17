import 'fake-indexeddb/auto';
import { serialize } from 'node:v8';
import { afterEach, describe, expect, it } from 'vitest';
import {
  IndexedDbMatchStore,
  LocalTransport,
  MatchResumeError,
  MatchRunner,
  MemoryMatchStore,
  SnapshotRejectedError,
  decodeSnapshot,
  type MatchStore,
} from '../../src/index.js';
import type { LogEntry } from '../../src/runner/CommandLog.js';
import {
  TinyGame,
  resetTinyBotCalls,
  type TinyConfig,
} from '../fixtures/tinyGame.js';

const ARENA = 2_000_000_000;

interface InspectableStore extends MatchStore {
  snapshotTicks(matchId: string): Promise<readonly number[]>;
  deleteSnapshot(matchId: string, tick: number): Promise<void>;
}

interface CommandChunk {
  firstTick: number;
  lastTick: number;
  entries: { tick: number }[];
}

let sequence = 0;

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${String(sequence)}`;
}

function tinyConfig(matchId: string): TinyConfig {
  return {
    matchId,
    gameId: 'tiny',
    simVersion: 'tiny-1',
    seed: 7,
    side: 'client',
    inputDelayTicks: 2,
    arenaSize: ARENA,
    slots: [{ slot: 0, team: 0, kind: 'human', playerId: 'local:0', color: 1 }],
  };
}

function entry(tick: number, q = 0): LogEntry {
  return {
    tick,
    playerId: 'local:0',
    type: 'spawn',
    data: { q, p: { x: '1' } },
  };
}

function memoryStore(): InspectableStore {
  return new MemoryMatchStore();
}

function idbStore(): InspectableStore {
  return new IndexedDbMatchStore({ databaseName: nextId('phalanx-71') });
}

function settle<T>(work: Promise<T>, ms = 1000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('hung'));
    }, ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

describe.each([
  ['memory', memoryStore],
  ['indexeddb', idbStore],
] as const)('%s snapshot fallback', (_label, openStore) => {
  const live: MatchRunner<typeof TinyGame>[] = [];

  afterEach(() => {
    resetTinyBotCalls();
    while (live.length > 0) live.pop()?.dispose();
  });

  function keep(
    runner: MatchRunner<typeof TinyGame>
  ): MatchRunner<typeof TinyGame> {
    live.push(runner);
    return runner;
  }

  it('replays from tick 0 when nothing was snapshotted', async () => {
    const store = openStore();
    const matchId = nextId('no-snap');
    const played = await play(store, matchId, 5, 300);
    expect(played.runner.resumeReport).toBeNull();
    expect(await store.snapshotTicks(matchId)).toEqual([]);
    const resumed = await MatchRunner.resumeLocal(TinyGame, store, matchId, {
      pauseWhenHidden: false,
    });
    expect(resumed).not.toBeNull();
    if (resumed === null) return;
    keep(resumed);
    expect(resumed.tick).toBe(played.tick);
    expect(resumed.digest()).toBe(played.digest);
    expect(resumed.resumeReport).toEqual({ snapshotTick: null, skipped: [] });
  });

  it.each([
    ['truncated bytes', truncateSnapshot],
    ['a bad magic', badMagic],
    ['a flipped body bit', flipBodyBit],
  ])(
    'restores the previous snapshot when the newest has %s',
    async (_label, corrupt) => {
      const store = openStore();
      const matchId = nextId('fallback');
      const played = await play(store, matchId, 9, 4);
      expect(played.tick).toBe(8);
      expect(await store.snapshotTicks(matchId)).toEqual([4, 8]);
      const loaded = await store.load(matchId);
      const newest = loaded?.snapshot;
      expect(newest?.tick).toBe(8);
      if (newest === undefined) return;
      const beforeTicks = await store.snapshotTicks(matchId);
      const beforeLoad = await store.load(matchId);
      await store.saveSnapshot(matchId, newest.tick, corrupt(newest.bytes));
      const notices: number[] = [];
      const resumed = await MatchRunner.resumeLocal(TinyGame, store, matchId, {
        pauseWhenHidden: false,
        snapshotEveryTicks: 4,
        onSnapshotFallback: (report) => {
          notices.push(report.skipped.length);
        },
      });
      expect(resumed).not.toBeNull();
      if (resumed === null) return;
      keep(resumed);
      expect(resumed.tick).toBe(played.tick);
      expect(resumed.digest()).toBe(played.digest);
      expect(resumed.resumeReport?.snapshotTick).toBe(4);
      expect(resumed.resumeReport?.skipped.map((item) => item.tick)).toEqual([
        8,
      ]);
      expect(notices).toEqual([1]);
      expect(await store.snapshotTicks(matchId)).toEqual([4]);
      expect(beforeTicks).toEqual([4, 8]);
      expect(beforeLoad?.snapshot?.tick).toBe(8);
    }
  );

  it('deletes the rejected snapshot and the next save keeps the good one', async () => {
    const store = openStore();
    const matchId = nextId('next-save');
    await play(store, matchId, 9, 4);
    const loaded = await store.load(matchId);
    const newest = loaded?.snapshot;
    if (newest === undefined) throw new Error('expected a snapshot');
    await store.saveSnapshot(
      matchId,
      newest.tick,
      truncateSnapshot(newest.bytes)
    );
    const host = installDocument();
    const resumed = await MatchRunner.resumeLocal(TinyGame, store, matchId, {
      pauseWhenHidden: false,
      snapshotEveryTicks: 4,
      hashEveryTicks: 1_000_000,
    });
    expect(resumed).not.toBeNull();
    if (resumed === null) return;
    keep(resumed);
    expect(await store.snapshotTicks(matchId)).toEqual([4]);
    const clock = installFastClock();
    const timers = installManualTimers();
    try {
      resumed.start();
      for (let step = 0; step < 40 && resumed.tick < 12; step += 1) {
        const fired = timers.fireNextUnder(1000);
        if (fired === null) break;
      }
      expect(resumed.tick).toBeGreaterThanOrEqual(12);
      expect(resumed.tick).toBeLessThan(16);
      host.emitPage('pagehide');
      await resumed.whenPersisted();
    } finally {
      timers.restore();
      clock();
      host.restore();
    }
    expect(await store.snapshotTicks(matchId)).toEqual([4, 12]);
    const again = await store.load(matchId);
    expect(again?.snapshot?.tick).toBe(12);
    expect(again?.previous?.snapshot.tick).toBe(4);
    const previousBytes = again?.previous?.snapshot.bytes;
    expect(previousBytes).toBeInstanceOf(Uint8Array);
    if (previousBytes === undefined) return;
    expect(previousBytes.byteLength).toBeGreaterThan(0);
    expect(() => {
      decodeSnapshot(previousBytes);
    }).not.toThrow();
  });

  it('throws MatchResumeError when every snapshot is corrupt', async () => {
    const store = openStore();
    const matchId = nextId('all-bad');
    await play(store, matchId, 9, 4);
    const loaded = await store.load(matchId);
    const newest = loaded?.snapshot;
    const older = loaded?.previous?.snapshot;
    if (newest === undefined || older === undefined) {
      throw new Error('expected two snapshots');
    }
    const beforeTicks = [...(await store.snapshotTicks(matchId))];
    await store.saveSnapshot(
      matchId,
      newest.tick,
      truncateSnapshot(newest.bytes)
    );
    await store.saveSnapshot(matchId, older.tick, badMagic(older.bytes));
    const wrapped = new CountingStore(store);
    const timersBefore = timeoutCount();
    await expect(
      settle(
        MatchRunner.resumeLocal(TinyGame, wrapped, matchId, {
          pauseWhenHidden: false,
          snapshotEveryTicks: 4,
        })
      )
    ).rejects.toBeInstanceOf(MatchResumeError);
    try {
      await MatchRunner.resumeLocal(TinyGame, store, matchId, {
        pauseWhenHidden: false,
        snapshotEveryTicks: 4,
      });
      throw new Error('expected MatchResumeError');
    } catch (error) {
      expect(error).toBeInstanceOf(MatchResumeError);
      if (!(error instanceof MatchResumeError)) return;
      expect(error.matchId).toBe(matchId);
      expect(error.attempts.map((item) => item.tick)).toEqual([8, 4]);
      expect(error.cause).toBe(error.attempts[0]?.error);
      expect(error.attempts[0]?.error).toBeInstanceOf(SnapshotRejectedError);
      expect(error.attempts[1]?.error).toBeInstanceOf(SnapshotRejectedError);
    }
    expect(wrapped.deletes).toBe(0);
    expect(wrapped.writes).toBe(0);
    expect([...(await store.snapshotTicks(matchId))]).toEqual(beforeTicks);
    expect((await store.load(matchId))?.snapshot?.tick).toBe(8);
    expect(timeoutCount()).toBe(timersBefore);
  });

  it('does not fall back when fast-forward fails', async () => {
    const store = openStore();
    const matchId = nextId('ff-fail');
    await play(store, matchId, 12, 4);
    const wrapped = new BadTailStore(store);
    await expect(
      MatchRunner.resumeLocal(TinyGame, wrapped, matchId, {
        pauseWhenHidden: false,
        snapshotEveryTicks: 4,
      })
    ).rejects.toThrow(/outside/);
    expect(await store.snapshotTicks(matchId)).toEqual([4, 8]);
    expect((await store.load(matchId))?.snapshot?.tick).toBe(8);
  });

  it('keeps a rejected snapshot when the store cannot delete it', async () => {
    const store = new NoDeleteStore(openStore());
    const matchId = nextId('no-delete');
    await play(store, matchId, 9, 4);
    const loaded = await store.load(matchId);
    if (loaded?.snapshot === undefined) throw new Error('expected a snapshot');
    await store.saveSnapshot(
      matchId,
      loaded.snapshot.tick,
      truncateSnapshot(loaded.snapshot.bytes)
    );
    const resumed = await MatchRunner.resumeLocal(TinyGame, store, matchId, {
      pauseWhenHidden: false,
      snapshotEveryTicks: 4,
    });
    expect(resumed).not.toBeNull();
    if (resumed === null) return;
    keep(resumed);
    expect(resumed.resumeReport?.snapshotTick).toBe(4);
    expect(resumed.resumeReport?.cleanupError).toBeUndefined();
    expect(await store.snapshotTicks(matchId)).toEqual([4, 8]);
  });

  it('records a cleanup error and still returns the runner', async () => {
    const store = new DeleteFailStore(openStore());
    const matchId = nextId('cleanup');
    await play(store, matchId, 9, 4);
    const loaded = await store.load(matchId);
    if (loaded?.snapshot === undefined) throw new Error('expected a snapshot');
    await store.saveSnapshot(
      matchId,
      loaded.snapshot.tick,
      truncateSnapshot(loaded.snapshot.bytes)
    );
    const resumed = await MatchRunner.resumeLocal(TinyGame, store, matchId, {
      pauseWhenHidden: false,
      snapshotEveryTicks: 4,
    });
    expect(resumed).not.toBeNull();
    if (resumed === null) return;
    keep(resumed);
    expect(resumed.resumeReport?.cleanupError).toBeInstanceOf(Error);
    expect(await store.snapshotTicks(matchId)).toEqual([4, 8]);
  });
});

describe('IndexedDbMatchStore schema v2', () => {
  it('opens meta, commands, and snapshots', async () => {
    const databaseName = nextId('schema');
    const matchId = nextId('schema-match');
    const store = new IndexedDbMatchStore({ databaseName });
    await store.saveHeader(matchId, tinyConfig(matchId));
    await store.appendCommands(matchId, [entry(3)], 3);
    await store.saveSnapshot(matchId, 2, new Uint8Array([9, 8]));
    const opened = await inspectDatabase(databaseName);
    expect(opened.version).toBe(2);
    expect([...opened.names].sort()).toEqual(['commands', 'meta', 'snapshots']);
    expect(opened.names).not.toContain('matches');
    expect(await readMeta(databaseName, matchId)).toMatchObject({
      cursor: 3,
      nextSeq: 1,
      maxEntryTick: 3,
      snapshotTicks: [2],
    });
    const chunks = await readChunks(databaseName, matchId);
    expect(chunks).toEqual([
      {
        firstTick: 3,
        lastTick: 3,
        entries: [expect.objectContaining({ tick: 3 })],
      },
    ]);
    expect(await readSnapshot(databaseName, matchId, 2)).toEqual(
      new Uint8Array([9, 8])
    );
  });

  it('stores one chunk per batch and skips a cursor-only append', async () => {
    const databaseName = nextId('chunks');
    const matchId = nextId('chunks-match');
    const store = new IndexedDbMatchStore({ databaseName });
    await store.saveHeader(matchId, tinyConfig(matchId));
    for (let tick = 1; tick <= 5; tick += 1) {
      await store.appendCommands(matchId, [entry(tick)], tick);
    }
    let chunks = await readChunks(databaseName, matchId);
    expect(chunks.map((chunk) => [chunk.firstTick, chunk.lastTick])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
    ]);
    await store.appendCommands(matchId, [], 9);
    chunks = await readChunks(databaseName, matchId);
    expect(chunks).toHaveLength(5);
    expect((await store.load(matchId))?.tick).toBe(9);
    await store.appendCommands(matchId, [entry(3)], 9);
    chunks = await readChunks(databaseName, matchId);
    expect(chunks).toHaveLength(5);
  });

  it('reads only the overlapping command chunks', async () => {
    const databaseName = nextId('overlap');
    const matchId = nextId('overlap-match');
    const store = new IndexedDbMatchStore({ databaseName });
    await store.saveHeader(matchId, tinyConfig(matchId));
    for (let tick = 1; tick <= 6; tick += 1) {
      await store.appendCommands(matchId, [entry(tick)], tick);
    }
    const visits = spyCursorVisits();
    try {
      await store.appendCommands(matchId, [entry(7)], 7);
      expect(visits()).toBe(0);
      await store.appendCommands(matchId, [entry(5, 1)], 7);
      // Chunks 7, 6 and 5 overlap tick 5. The cursor also reads chunk 4,
      // then stops because its lastTick is below the batch.
      expect(visits()).toBe(4);
    } finally {
      visits.restore();
    }
    expect(await readChunks(databaseName, matchId)).toHaveLength(8);
  });

  it('drops covered chunks in the snapshot transaction and filters a partial chunk', async () => {
    const databaseName = nextId('prune');
    const matchId = nextId('prune-match');
    const store = new IndexedDbMatchStore({ databaseName });
    await store.saveHeader(matchId, tinyConfig(matchId));
    await store.appendCommands(matchId, [entry(8), entry(12), entry(15)], 15);
    await store.saveSnapshot(matchId, 10, new Uint8Array([10]));
    const partial = await readChunks(databaseName, matchId);
    expect(partial).toHaveLength(1);
    expect(partial[0]?.entries.map((item) => item.tick)).toEqual([8, 12, 15]);
    expect((await store.load(matchId))?.tail.map((item) => item.tick)).toEqual([
      12, 15,
    ]);
    await store.appendCommands(matchId, [entry(16)], 16);
    await store.saveSnapshot(matchId, 20, new Uint8Array([20]));
    await store.appendCommands(matchId, [entry(21)], 21);
    const before = (await readChunks(databaseName, matchId)).map(
      (chunk) => chunk.lastTick
    );
    expect(before).toEqual([15, 16, 21]);
    const aborting = spyAbortOnSnapshotPut();
    try {
      await expect(
        store.saveSnapshot(matchId, 30, new Uint8Array([30]))
      ).rejects.toThrow();
    } finally {
      aborting.restore();
    }
    expect(await store.snapshotTicks(matchId)).toEqual([10, 20]);
    expect(
      (await readChunks(databaseName, matchId)).map((chunk) => chunk.lastTick)
    ).toEqual(before);
    await store.saveSnapshot(matchId, 30, new Uint8Array([30]));
    expect(await store.snapshotTicks(matchId)).toEqual([20, 30]);
    expect(
      (await readChunks(databaseName, matchId)).map((chunk) => chunk.lastTick)
    ).toEqual([21]);
    const loaded = await store.load(matchId);
    expect(loaded?.tail).toEqual([]);
    expect(loaded?.previous?.tail.map((item) => item.tick)).toEqual([21]);
  });

  it('drops a version-1 matches row and accepts new writes', async () => {
    const databaseName = nextId('upgrade');
    const matchId = nextId('upgrade-match');
    await createVersion1(databaseName, matchId, {
      config: tinyConfig(matchId),
      cursor: 4,
      commands: [entry(4)],
      snapshots: [{ tick: 2, bytes: new Uint8Array([1]) }],
    });
    const store = new IndexedDbMatchStore({ databaseName });
    expect(await store.load(matchId)).toBeNull();
    const opened = await inspectDatabase(databaseName);
    expect(opened.version).toBe(2);
    expect(opened.names).not.toContain('matches');
    await store.saveHeader(matchId, tinyConfig(matchId));
    await store.appendCommands(matchId, [entry(1)], 1);
    expect((await store.load(matchId))?.tick).toBe(1);
    expect((await store.load(matchId))?.tail).toHaveLength(1);
  });

  it('rejects when another connection blocks the upgrade', async () => {
    const databaseName = nextId('blocked');
    const held = await holdVersion1(databaseName);
    try {
      const store = new IndexedDbMatchStore({ databaseName });
      await expect(settle(store.load(nextId('blocked-match')))).rejects.toThrow(
        /blocked/
      );
    } finally {
      held.close();
    }
  });

  it('closes the database when another connection upgrades', async () => {
    const databaseName = nextId('versionchange');
    const matchId = nextId('versionchange-match');
    const store = new IndexedDbMatchStore({ databaseName });
    await store.saveHeader(matchId, tinyConfig(matchId));
    await settle(openVersion(databaseName, 3));
    expect(await inspectDatabase(databaseName)).toMatchObject({ version: 3 });
  });

  it('rejects a corrupt command chunk', async () => {
    const databaseName = nextId('bad-chunk');
    const matchId = nextId('bad-chunk-match');
    const store = new IndexedDbMatchStore({ databaseName });
    await store.saveHeader(matchId, tinyConfig(matchId));
    await store.appendCommands(matchId, [entry(2)], 2);
    await putChunk(databaseName, matchId, 0, { firstTick: 'nope' });
    await expect(
      store.appendCommands(matchId, [entry(2, 1)], 2)
    ).rejects.toThrow(/corrupt command chunk/);
  });

  it('writes the same number of bytes on the 10th and 1000th append', async () => {
    const databaseName = nextId('bytes');
    const matchId = nextId('bytes-match');
    const store = new IndexedDbMatchStore({ databaseName });
    await store.saveHeader(matchId, tinyConfig(matchId));
    const spy = spyPutBytes();
    const measured: number[] = [];
    try {
      for (let tick = 1; tick <= 1000; tick += 1) {
        spy.reset();
        await store.appendCommands(matchId, [sizedEntry(tick)], tick);
        measured.push(spy.total());
        expect(spy.stores()).not.toContain('snapshots');
      }
      const tenth = measured[9];
      const thousandth = measured[999];
      expect(tenth).toBeGreaterThan(0);
      expect(thousandth).toBeGreaterThan(0);
      if (tenth === undefined || thousandth === undefined) return;
      expect(Math.abs(tenth - thousandth) / tenth).toBeLessThanOrEqual(0.05);
      spy.reset();
      const snapshot = new Uint8Array(200);
      await store.saveSnapshot(matchId, 1000, snapshot);
      expect(spy.stores().sort()).toEqual(['meta', 'snapshots']);
      expect(spy.byStore('snapshots')).toBe(snapshot.byteLength);
      expect(spy.byStore('meta')).toBeGreaterThan(0);
    } finally {
      spy.restore();
    }
  });
});

async function play(
  store: MatchStore,
  matchId: string,
  steps: number,
  snapshotEveryTicks: number
): Promise<{
  digest: string;
  tick: number;
  runner: MatchRunner<typeof TinyGame>;
}> {
  const transport = LocalTransport.stepped({
    store,
    snapshotEveryTicks,
    pauseWhenHidden: false,
  });
  const runner = new MatchRunner(TinyGame, tinyConfig(matchId), transport, {
    hashEveryTicks: 1_000_000,
  });
  runner.start();
  transport.step(steps);
  const digest = runner.digest();
  const tick = runner.tick;
  runner.dispose();
  await runner.whenPersisted();
  return { digest, tick, runner };
}

function sizedEntry(tick: number): LogEntry {
  return {
    tick,
    playerId: 'local:0',
    type: 'spawn',
    data: { q: 0, p: { x: '1234567890', y: '1234567890' } },
  };
}

function truncateSnapshot(bytes: Uint8Array): Uint8Array {
  return bytes.slice(0, Math.min(8, bytes.byteLength));
}

function badMagic(bytes: Uint8Array): Uint8Array {
  const copy = bytes.slice();
  copy[0] = 0;
  return copy;
}

function flipBodyBit(bytes: Uint8Array): Uint8Array {
  for (let index = 4; index < bytes.byteLength; index += 1) {
    const flipped = bytes.slice();
    const current = flipped[index];
    if (current === undefined) continue;
    flipped[index] = current ^ 0x01;
    try {
      decodeSnapshot(flipped);
    } catch (error) {
      if (
        error instanceof SnapshotRejectedError &&
        error.message.includes('digest')
      ) {
        return flipped;
      }
    }
  }
  throw new Error('snapshot body bit did not fail the digest');
}

class CountingStore implements MatchStore {
  public deletes = 0;
  public writes = 0;

  public constructor(private readonly inner: InspectableStore) {}

  public saveHeader(
    matchId: string,
    config: Parameters<MatchStore['saveHeader']>[1]
  ): Promise<void> {
    this.writes += 1;
    return this.inner.saveHeader(matchId, config);
  }

  public appendCommands(
    matchId: string,
    entries: readonly LogEntry[],
    cursorTick?: number
  ): Promise<void> {
    this.writes += 1;
    return this.inner.appendCommands(matchId, entries, cursorTick);
  }

  public saveSnapshot(
    matchId: string,
    tick: number,
    bytes: Uint8Array
  ): Promise<void> {
    this.writes += 1;
    return this.inner.saveSnapshot(matchId, tick, bytes);
  }

  public load(matchId: string): ReturnType<MatchStore['load']> {
    return this.inner.load(matchId);
  }

  public clear(matchId: string): Promise<void> {
    this.writes += 1;
    return this.inner.clear(matchId);
  }

  public deleteSnapshot(matchId: string, tick: number): Promise<void> {
    this.deletes += 1;
    return this.inner.deleteSnapshot(matchId, tick);
  }

  public snapshotTicks(matchId: string): Promise<readonly number[]> {
    return this.inner.snapshotTicks(matchId);
  }
}

class NoDeleteStore implements MatchStore {
  public constructor(private readonly inner: InspectableStore) {}

  public saveHeader(
    matchId: string,
    config: Parameters<MatchStore['saveHeader']>[1]
  ): Promise<void> {
    return this.inner.saveHeader(matchId, config);
  }

  public appendCommands(
    matchId: string,
    entries: readonly LogEntry[],
    cursorTick?: number
  ): Promise<void> {
    return this.inner.appendCommands(matchId, entries, cursorTick);
  }

  public saveSnapshot(
    matchId: string,
    tick: number,
    bytes: Uint8Array
  ): Promise<void> {
    return this.inner.saveSnapshot(matchId, tick, bytes);
  }

  public load(matchId: string): ReturnType<MatchStore['load']> {
    return this.inner.load(matchId);
  }

  public clear(matchId: string): Promise<void> {
    return this.inner.clear(matchId);
  }

  public snapshotTicks(matchId: string): Promise<readonly number[]> {
    return this.inner.snapshotTicks(matchId);
  }
}

class DeleteFailStore extends NoDeleteStore {
  public deleteSnapshot(): Promise<void> {
    return Promise.reject(new Error('cleanup failed'));
  }
}

class BadTailStore extends NoDeleteStore {
  public override async load(matchId: string): ReturnType<MatchStore['load']> {
    const loaded = await super.load(matchId);
    if (loaded?.snapshot === undefined) return loaded;
    const stale: LogEntry = {
      tick: loaded.tick + 5,
      playerId: 'local:0',
      type: 'spawn',
      data: { q: 0, p: { x: 'stale' } },
    };
    return { ...loaded, tail: [stale, ...loaded.tail] };
  }
}

function timeoutCount(): number {
  const proc = process as unknown as {
    _getActiveHandles?: () => { constructor?: { name?: string } }[];
  };
  const handles = proc._getActiveHandles?.() ?? [];
  return handles.filter((handle) => handle.constructor?.name === 'Timeout')
    .length;
}

function installFastClock(): () => void {
  const perf = performance;
  const original = perf.now.bind(perf);
  let clock = 0;
  perf.now = () => {
    clock += 100;
    return clock;
  };
  return () => {
    perf.now = original;
  };
}

function installManualTimers(): {
  fireNextUnder(ms: number): number | null;
  restore(): void;
} {
  const host = globalThis as unknown as {
    setTimeout: (handler: () => void, timeout?: number) => unknown;
    clearTimeout: (handle?: unknown) => void;
  };
  const originalSet = host.setTimeout;
  const originalClear = host.clearTimeout;
  const pending = new Map<number, { ms: number; fn: () => void }>();
  let next = 1;
  host.setTimeout = (fn, ms) => {
    const id = next;
    next += 1;
    pending.set(id, { ms: ms ?? 0, fn });
    return id;
  };
  host.clearTimeout = (id) => {
    if (typeof id === 'number') pending.delete(id);
  };
  return {
    fireNextUnder(limit: number): number | null {
      let chosen: number | null = null;
      let chosenMs = Infinity;
      for (const [id, item] of pending) {
        if (item.ms < limit && item.ms < chosenMs) {
          chosen = id;
          chosenMs = item.ms;
        }
      }
      if (chosen === null) return null;
      const item = pending.get(chosen);
      pending.delete(chosen);
      item?.fn();
      return chosenMs;
    },
    restore(): void {
      host.setTimeout = originalSet;
      host.clearTimeout = originalClear;
    },
  };
}

function installDocument(): {
  emitPage(type: string): void;
  restore(): void;
} {
  const docListeners = new Map<string, () => void>();
  const pageListeners = new Map<string, () => void>();
  const doc = {
    get visibilityState(): string {
      return 'visible';
    },
    addEventListener(type: string, listener: () => void): void {
      docListeners.set(type, listener);
    },
    removeEventListener(type: string, listener: () => void): void {
      if (docListeners.get(type) === listener) docListeners.delete(type);
    },
  };
  const host = globalThis as unknown as Record<string, unknown>;
  const previousDoc = host['document'];
  const previousAdd = host['addEventListener'];
  const previousRemove = host['removeEventListener'];
  host['document'] = doc;
  host['addEventListener'] = (type: string, listener: () => void): void => {
    pageListeners.set(type, listener);
  };
  host['removeEventListener'] = (type: string, listener: () => void): void => {
    if (pageListeners.get(type) === listener) pageListeners.delete(type);
  };
  return {
    emitPage(type: string): void {
      pageListeners.get(type)?.();
    },
    restore(): void {
      if (previousDoc === undefined) delete host['document'];
      else host['document'] = previousDoc;
      if (previousAdd === undefined) delete host['addEventListener'];
      else host['addEventListener'] = previousAdd;
      if (previousRemove === undefined) delete host['removeEventListener'];
      else host['removeEventListener'] = previousRemove;
    },
  };
}

interface PutRecord {
  store: string;
  bytes: number;
}

function spyPutBytes(): {
  reset(): void;
  total(): number;
  stores(): string[];
  byStore(name: string): number;
  restore(): void;
} {
  const proto = objectStorePrototype();
  const original = proto.put;
  const calls: PutRecord[] = [];
  proto.put = function put(this: unknown, value: unknown, key?: unknown) {
    const store = this as { name?: string };
    calls.push({
      store: store.name ?? '',
      bytes:
        value instanceof Uint8Array
          ? value.byteLength
          : serialize(value).byteLength,
    });
    return original.call(this, value, key);
  };
  return {
    reset(): void {
      calls.length = 0;
    },
    total(): number {
      return calls.reduce((sum, call) => sum + call.bytes, 0);
    },
    stores(): string[] {
      return calls.map((call) => call.store);
    },
    byStore(name: string): number {
      return calls
        .filter((call) => call.store === name)
        .reduce((sum, call) => sum + call.bytes, 0);
    },
    restore(): void {
      proto.put = original;
    },
  };
}

function spyCursorVisits(): (() => number) & { restore(): void } {
  const proto = objectStorePrototype();
  const original = proto.openCursor;
  let visits = 0;
  proto.openCursor = function openCursor(
    this: unknown,
    range?: unknown,
    direction?: string
  ) {
    const request = original.call(this, range, direction) as {
      result: unknown;
      onsuccess: (() => void) | null;
    };
    const slot = { handler: null as (() => void) | null };
    Object.defineProperty(request, 'onsuccess', {
      configurable: true,
      get() {
        return slot.handler;
      },
      set(handler: (() => void) | null) {
        slot.handler = () => {
          if (request.result != null) visits += 1;
          handler?.();
        };
      },
    });
    return request;
  };
  const read = (): number => visits;
  read.restore = (): void => {
    proto.openCursor = original;
  };
  return read;
}

function spyAbortOnSnapshotPut(): { restore(): void } {
  const proto = objectStorePrototype();
  const original = proto.put;
  proto.put = function put(this: unknown, value: unknown, key?: unknown) {
    const store = this as {
      name?: string;
      transaction?: { abort(): void };
    };
    const request = original.call(this, value, key);
    if (store.name === 'snapshots') store.transaction?.abort();
    return request;
  };
  return {
    restore(): void {
      proto.put = original;
    },
  };
}

function objectStorePrototype(): {
  put: (this: unknown, value: unknown, key?: unknown) => unknown;
  openCursor: (this: unknown, range?: unknown, direction?: string) => unknown;
} {
  const host = globalThis as unknown as {
    IDBObjectStore?: {
      prototype: {
        put: (this: unknown, value: unknown, key?: unknown) => unknown;
        openCursor: (
          this: unknown,
          range?: unknown,
          direction?: string
        ) => unknown;
      };
    };
  };
  const proto = host.IDBObjectStore?.prototype;
  if (proto === undefined) throw new Error('IDBObjectStore missing');
  return proto;
}

interface OpenedDatabase {
  version: number;
  names: string[];
  close(): void;
}

function factory(): {
  open(
    name: string,
    version?: number
  ): {
    result: RawDatabase;
    error: unknown;
    onupgradeneeded: ((event: unknown) => void) | null;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
    onblocked: (() => void) | null;
  };
} {
  const host = globalThis as unknown as {
    indexedDB?: ReturnType<typeof factory>;
  };
  const indexed = host.indexedDB;
  if (indexed === undefined) throw new Error('indexedDB missing');
  return indexed;
}

interface RawDatabase {
  version: number;
  objectStoreNames: {
    contains(name: string): boolean;
    readonly length: number;
    item(index: number): string | null;
  };
  createObjectStore(name: string): unknown;
  transaction(name: string, mode: 'readonly' | 'readwrite'): RawTransaction;
  close(): void;
}

interface RawTransaction {
  objectStore(name: string): {
    put(value: unknown, key: unknown): unknown;
    get(key: unknown): {
      result: unknown;
      onsuccess: (() => void) | null;
      onerror: (() => void) | null;
    };
    openCursor(range?: unknown): {
      result: {
        value: unknown;
        continue(): void;
      } | null;
      onsuccess: (() => void) | null;
      onerror: (() => void) | null;
    };
  };
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  error: unknown;
}

function inspectDatabase(name: string): Promise<OpenedDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory().open(name);
    request.onsuccess = () => {
      const db = request.result;
      const names: string[] = [];
      for (let index = 0; index < db.objectStoreNames.length; index += 1) {
        const item = db.objectStoreNames.item(index);
        if (item !== null) names.push(item);
      }
      resolve({
        version: db.version,
        names,
        close(): void {
          db.close();
        },
      });
      db.close();
    };
    request.onerror = () => {
      reject(errorOf(request.error));
    };
  });
}

function readMeta(name: string, matchId: string): Promise<unknown> {
  return readValue(name, 'meta', matchId);
}

function readSnapshot(
  name: string,
  matchId: string,
  tick: number
): Promise<unknown> {
  return readValue(name, 'snapshots', [matchId, tick]);
}

function readValue(
  name: string,
  storeName: string,
  key: unknown
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = factory().open(name);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(storeName, 'readonly');
      const get = tx.objectStore(storeName).get(key);
      get.onsuccess = () => {
        db.close();
        resolve(get.result);
      };
      get.onerror = () => {
        db.close();
        reject(errorOf(tx.error));
      };
    };
    request.onerror = () => {
      reject(errorOf(request.error));
    };
  });
}

function readChunks(name: string, matchId: string): Promise<CommandChunk[]> {
  const range = (
    globalThis as unknown as {
      IDBKeyRange: { bound(lower: unknown, upper: unknown): unknown };
    }
  ).IDBKeyRange.bound([matchId, -Infinity], [matchId, Infinity]);
  return new Promise((resolve, reject) => {
    const request = factory().open(name);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('commands', 'readonly');
      const cursorRequest = tx.objectStore('commands').openCursor(range);
      const chunks: CommandChunk[] = [];
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor === null) {
          db.close();
          resolve(chunks);
          return;
        }
        chunks.push(cursor.value as CommandChunk);
        cursor.continue();
      };
      cursorRequest.onerror = () => {
        db.close();
        reject(errorOf(tx.error));
      };
    };
    request.onerror = () => {
      reject(errorOf(request.error));
    };
  });
}

function putChunk(
  name: string,
  matchId: string,
  seq: number,
  value: unknown
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory().open(name);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('commands', 'readwrite');
      tx.objectStore('commands').put(value, [matchId, seq]);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(errorOf(tx.error));
      };
    };
    request.onerror = () => {
      reject(errorOf(request.error));
    };
  });
}

function createVersion1(
  name: string,
  matchId: string,
  value: unknown
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory().open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('matches')) {
        db.createObjectStore('matches');
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('matches', 'readwrite');
      tx.objectStore('matches').put(value, matchId);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(errorOf(tx.error));
      };
    };
    request.onerror = () => {
      reject(errorOf(request.error));
    };
  });
}

function holdVersion1(name: string): Promise<{ close(): void }> {
  return new Promise((resolve, reject) => {
    const request = factory().open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('matches')) {
        db.createObjectStore('matches');
      }
    };
    request.onsuccess = () => {
      resolve({
        close(): void {
          request.result.close();
        },
      });
    };
    request.onerror = () => {
      reject(errorOf(request.error));
    };
  });
}

function openVersion(name: string, version: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory().open(name, version);
    request.onupgradeneeded = () => {
      // The test only needs the version change to proceed.
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => {
      reject(errorOf(request.error));
    };
    request.onblocked = () => {
      reject(new Error('upgrade blocked'));
    };
  });
}

function errorOf(error: unknown): Error {
  return error instanceof Error ? error : new Error('indexedDB request failed');
}
