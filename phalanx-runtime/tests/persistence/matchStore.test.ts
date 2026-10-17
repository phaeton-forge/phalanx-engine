import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  IndexedDbMatchStore,
  LocalTransport,
  MatchRunner,
  MemoryMatchStore,
  decodeSnapshot,
  type MatchStore,
} from '../../src/index.js';
import { decodeInputCheckpoint } from '../../src/runner/InputCheckpoint.js';
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
  return new IndexedDbMatchStore({ databaseName: nextId('phalanx-test') });
}

describe.each([
  ['memory', memoryStore],
  ['indexeddb', idbStore],
] as const)('%s MatchStore', (_label, openStore) => {
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

  it('resumeLocal forwards snapshot, pause, and hash options', async () => {
    const store = openStore();
    const matchId = nextId('resume-options');
    const transport = LocalTransport.stepped({
      store,
      snapshotEveryTicks: 4,
      pauseWhenHidden: false,
    });
    const runner = keep(
      new MatchRunner(TinyGame, tinyConfig(matchId), transport, {
        hashEveryTicks: 1_000_000,
      })
    );
    runner.start();
    transport.step(5);
    expect(runner.tick).toBe(4);
    const digest = runner.digest();
    runner.dispose();
    await runner.whenPersisted();

    await expect(
      MatchRunner.resumeLocal(TinyGame, store, matchId, {
        snapshotEveryTicks: 0,
      })
    ).rejects.toThrow(/snapshotEveryTicks/);
    await expect(
      MatchRunner.resumeLocal(TinyGame, store, matchId, { hashEveryTicks: 0 })
    ).rejects.toThrow(/hashEveryTicks/);

    const resumed = await MatchRunner.resumeLocal(TinyGame, store, matchId, {
      snapshotEveryTicks: 8,
      pauseWhenHidden: false,
      hashEveryTicks: 4,
    });
    expect(resumed).not.toBeNull();
    if (resumed === null) return;
    keep(resumed);
    expect(resumed.tick).toBe(4);
    expect(resumed.digest()).toBe(digest);
  });

  it('keeps the last two snapshots and clears', async () => {
    const store = openStore();
    const matchId = nextId('direct');
    await store.saveHeader(matchId, tinyConfig(matchId));
    await store.saveSnapshot(matchId, 1, new Uint8Array([1]));
    await store.saveSnapshot(matchId, 2, new Uint8Array([2]));
    await store.saveSnapshot(matchId, 3, new Uint8Array([3, 4]));
    expect(await store.snapshotTicks(matchId)).toEqual([2, 3]);
    const loaded = await store.load(matchId);
    expect(loaded?.snapshot?.tick).toBe(3);
    expect(loaded?.snapshot?.bytes).toEqual(new Uint8Array([3, 4]));
    expect(await store.load(nextId('missing'))).toBeNull();
    await store.clear(matchId);
    expect(await store.load(matchId)).toBeNull();
    expect(await store.snapshotTicks(matchId)).toEqual([]);
  });

  it('stores the cursor and the tail after the newest snapshot', async () => {
    const store = openStore();
    const matchId = nextId('tail-direct');
    await store.saveHeader(matchId, tinyConfig(matchId));
    await store.appendCommands(matchId, [entry(3), entry(6), entry(6)], 9);
    await store.saveSnapshot(matchId, 5, new Uint8Array([9]));
    const loaded = await store.load(matchId);
    expect(loaded?.tick).toBe(9);
    expect(loaded?.tail.map((item) => item.tick)).toEqual([6]);
    expect(loaded?.snapshot?.tick).toBe(5);
    expect(loaded?.previous).toBeUndefined();
  });

  it('exposes the previous snapshot and the commands after it', async () => {
    const store = openStore();
    const matchId = nextId('previous');
    await store.saveHeader(matchId, tinyConfig(matchId));
    await store.appendCommands(matchId, [entry(6), entry(8), entry(12)], 12);
    await store.saveSnapshot(matchId, 5, new Uint8Array([5]));
    await store.saveSnapshot(matchId, 10, new Uint8Array([10]));
    const loaded = await store.load(matchId);
    expect(loaded?.snapshot?.tick).toBe(10);
    expect(loaded?.tail.map((item) => item.tick)).toEqual([12]);
    expect(loaded?.previous?.snapshot.tick).toBe(5);
    expect(loaded?.previous?.snapshot.bytes).toEqual(new Uint8Array([5]));
    expect(loaded?.previous?.tail.map((item) => item.tick)).toEqual([6, 8, 12]);
  });

  it('collapses one command when only the payload key order differs', async () => {
    const store = openStore();
    const matchId = nextId('key-order-one');
    const first: LogEntry = {
      tick: 4,
      playerId: 'local:0',
      type: 'spawn',
      data: { q: 1, p: { a: 1, b: 2 } },
    };
    const reordered: LogEntry = {
      tick: 4,
      playerId: 'local:0',
      type: 'spawn',
      data: { q: 1, p: { b: 2, a: 1 } },
    };
    await store.saveHeader(matchId, tinyConfig(matchId));
    await store.appendCommands(matchId, [first], 4);
    await store.appendCommands(matchId, [reordered], 4);
    expect((await store.load(matchId))?.tail).toHaveLength(1);
  });

  it('dedups a repeated newer command after one with an older tick', async () => {
    const store = openStore();
    const matchId = nextId('old-tick-dedup');
    await store.saveHeader(matchId, tinyConfig(matchId));
    await store.appendCommands(matchId, [entry(8)], 8);
    await store.appendCommands(matchId, [entry(10)], 10);
    await store.appendCommands(matchId, [entry(5)], 10);
    await store.appendCommands(matchId, [entry(8)], 10);
    const loaded = await store.load(matchId);
    expect(loaded?.tick).toBe(10);
    expect(loaded?.tail.map((item) => item.tick)).toEqual([8, 10, 5]);
  });

  it('deleteSnapshot keeps the cursor and the command log', async () => {
    const store = openStore();
    const matchId = nextId('delete-snap');
    await store.saveHeader(matchId, tinyConfig(matchId));
    await store.appendCommands(matchId, [entry(6), entry(12), entry(18)], 20);
    await store.saveSnapshot(matchId, 5, new Uint8Array([5]));
    await store.saveSnapshot(matchId, 10, new Uint8Array([10]));
    await store.saveSnapshot(matchId, 15, new Uint8Array([15]));
    expect(await store.snapshotTicks(matchId)).toEqual([10, 15]);
    await store.deleteSnapshot(matchId, 15);
    expect(await store.snapshotTicks(matchId)).toEqual([10]);
    const afterNewest = await store.load(matchId);
    expect(afterNewest?.tick).toBe(20);
    expect(afterNewest?.snapshot?.tick).toBe(10);
    expect(afterNewest?.previous).toBeUndefined();
    expect(afterNewest?.tail.map((item) => item.tick)).toEqual([12, 18]);
    await store.deleteSnapshot(matchId, 99);
    expect(await store.snapshotTicks(matchId)).toEqual([10]);
    expect((await store.load(matchId))?.tick).toBe(20);
    await store.saveSnapshot(matchId, 15, new Uint8Array([15]));
    await store.deleteSnapshot(matchId, 10);
    expect(await store.snapshotTicks(matchId)).toEqual([15]);
    const afterOldest = await store.load(matchId);
    expect(afterOldest?.tick).toBe(20);
    expect(afterOldest?.snapshot?.bytes).toEqual(new Uint8Array([15]));
    expect(afterOldest?.tail.map((item) => item.tick)).toEqual([18]);
  });

  it('rejects deleting the only snapshot once covered commands are gone', async () => {
    const store = openStore();
    const matchId = nextId('final-snapshot');
    await store.saveHeader(matchId, tinyConfig(matchId));
    await store.appendCommands(matchId, [entry(1), entry(6)], 6);
    await store.saveSnapshot(matchId, 5, new Uint8Array([5]));
    await expect(store.deleteSnapshot(matchId, 5)).rejects.toThrow(
      /final recovery snapshot/
    );
    const loaded = await store.load(matchId);
    expect(loaded?.tick).toBe(6);
    expect(loaded?.snapshot?.tick).toBe(5);
    expect(loaded?.snapshot?.bytes).toEqual(new Uint8Array([5]));
    expect(loaded?.tail.map((item) => item.tick)).toEqual([6]);
    expect(await store.snapshotTicks(matchId)).toEqual([5]);
  });

  it('deletes the only snapshot when every command is still stored', async () => {
    const store = openStore();
    const matchId = nextId('complete-log');
    await store.saveHeader(matchId, tinyConfig(matchId));
    await store.appendCommands(matchId, [entry(6)], 6);
    await store.saveSnapshot(matchId, 5, new Uint8Array([5]));
    await store.deleteSnapshot(matchId, 5);
    const loaded = await store.load(matchId);
    expect(loaded?.tick).toBe(6);
    expect(loaded?.snapshot).toBeUndefined();
    expect(loaded?.tail.map((item) => item.tick)).toEqual([6]);
    expect(await store.snapshotTicks(matchId)).toEqual([]);
  });

  it('resumes a malformed envelope beside the first command', async () => {
    const store = openStore();
    const matchId = nextId('malformed');
    const transport = LocalTransport.stepped({
      store,
      snapshotEveryTicks: 300,
      pauseWhenHidden: false,
    });
    const runner = keep(
      new MatchRunner(
        TinyGame,
        { ...tinyConfig(matchId), inputDelayTicks: 1 },
        transport,
        { hashEveryTicks: 1_000_000 }
      )
    );
    runner.start();
    transport.step(1);
    const target = runner.tick + 1;
    transport.submit(target, 0, [{ type: 'spawn', data: { q: -1, p: null } }]);
    runner.submit({ type: 'spawn', x: 3n });
    transport.step(40);
    const digest = runner.digest();
    runner.dispose();
    await runner.whenPersisted();
    const atTarget = (await store.load(matchId))?.tail.filter(
      (item) => item.tick === target
    );
    expect(atTarget?.some((item) => item.malformed === true)).toBe(true);
    expect(
      atTarget?.some((item) => item.malformed !== true && item.data.q === 0)
    ).toBe(true);
    const resumed = await MatchRunner.resumeLocal(TinyGame, store, matchId, {
      pauseWhenHidden: false,
    });
    expect(resumed).not.toBeNull();
    if (resumed === null) return;
    keep(resumed);
    expect(resumed.tick).toBe(runner.tick);
    expect(resumed.digest()).toBe(digest);
  });

  it('resumes tick 950 with the same digest', async () => {
    const store = openStore();
    const matchId = nextId('resume');
    const transport = LocalTransport.stepped({
      store,
      snapshotEveryTicks: 300,
      pauseWhenHidden: false,
    });
    const runner = keep(
      new MatchRunner(TinyGame, tinyConfig(matchId), transport, {
        hashEveryTicks: 1_000_000,
      })
    );
    runner.start();
    transport.step(951);
    expect(runner.tick).toBe(950);
    expect(await store.snapshotTicks(matchId)).toEqual([]);
    const digest = runner.digest();
    runner.dispose();
    await runner.whenPersisted();
    expect(await store.snapshotTicks(matchId)).toEqual([600, 900]);
    const resumed = await MatchRunner.resumeLocal(TinyGame, store, matchId);
    expect(resumed).not.toBeNull();
    if (resumed === null) return;
    keep(resumed);
    expect(resumed.tick).toBe(950);
    expect(resumed.digest()).toBe(digest);
  });

  it('replays the command tail after the snapshot', async () => {
    const store = openStore();
    const matchId = nextId('cmd');
    const transport = LocalTransport.stepped({
      store,
      snapshotEveryTicks: 10,
      pauseWhenHidden: false,
    });
    const runner = keep(
      new MatchRunner(TinyGame, tinyConfig(matchId), transport, {
        hashEveryTicks: 1_000_000,
      })
    );
    runner.start();
    transport.step(11);
    expect(runner.tick).toBe(10);
    runner.submit({ type: 'spawn', x: 3n });
    transport.step(5);
    expect(runner.tick).toBe(15);
    const digest = runner.digest();
    runner.dispose();
    await runner.whenPersisted();
    const loaded = await store.load(matchId);
    expect(loaded?.snapshot?.tick).toBe(10);
    expect(
      loaded?.tail.some((item) => item.type === 'spawn' && item.tick === 12)
    ).toBe(true);
    const resumed = await MatchRunner.resumeLocal(TinyGame, store, matchId);
    expect(resumed).not.toBeNull();
    if (resumed === null) return;
    keep(resumed);
    expect(resumed.tick).toBe(15);
    expect(resumed.digest()).toBe(digest);
  });

  it('keeps the controller and a unique system q across resume', async () => {
    const store = openStore();
    const matchId = nextId('ctrl');
    const transport = LocalTransport.stepped({
      store,
      snapshotEveryTicks: 4,
      pauseWhenHidden: false,
    });
    const runner = keep(
      new MatchRunner(TinyGame, tinyConfig(matchId), transport, {
        hashEveryTicks: 1_000_000,
      })
    );
    runner.start();
    transport.step(4);
    expect(runner.tick).toBe(3);
    runner.setController(0, 'bot', { policy: 'walker', fromTick: 5 });
    transport.step(5);
    expect(runner.tick).toBe(8);
    runner.dispose();
    await runner.whenPersisted();
    const loaded = await store.load(matchId);
    expect(loaded?.snapshot?.tick).toBe(8);
    expect(loaded?.tail.some((item) => item.type === 'setController')).toBe(
      false
    );
    const saved = loaded?.snapshot?.bytes;
    expect(saved).toBeInstanceOf(Uint8Array);
    if (saved === undefined) return;
    const decoded = decodeSnapshot(saved);
    expect(decoded.inputCheckpoint).toBeInstanceOf(Uint8Array);
    if (decoded.inputCheckpoint === null) return;
    expect(decodeInputCheckpoint(decoded.inputCheckpoint).systemSeq).toBe(1);

    const resumed = await MatchRunner.resumeLocal(TinyGame, store, matchId);
    expect(resumed).not.toBeNull();
    if (resumed === null) return;
    keep(resumed);
    const reasons: string[] = [];
    resumed.onRejected((_item, reason) => {
      reasons.push(reason);
    });
    resumed.setController(0, 'bot', { policy: 'walker' });
    expect(reasons).toEqual(['slot is already bot']);
    resumed.setController(0, 'human');
    const checkpoint = decodeInputCheckpoint(
      requireCheckpoint(resumed.snapshot())
    );
    expect(checkpoint.systemSeq).toBe(2);
    const pending = checkpoint.pending.flatMap((batch) => batch.entries);
    const system = pending.filter((item) => item.playerId === 'system');
    expect(system.map((item) => item.data.q)).toEqual([1]);
    expect(new Set([0, 1]).size).toBe(2);
  });

  it('keeps history when the header is written again', async () => {
    const store = openStore();
    const matchId = nextId('header-again');
    await store.saveHeader(matchId, tinyConfig(matchId));
    await store.saveSnapshot(matchId, 3, new Uint8Array([3]));
    await store.appendCommands(matchId, [entry(4)], 4);
    await store.saveHeader(matchId, tinyConfig(matchId));
    expect(await store.snapshotTicks(matchId)).toEqual([3]);
    expect((await store.load(matchId))?.tick).toBe(4);
    expect((await store.load(matchId))?.tail).toHaveLength(1);
  });

  it('dedupes a payload without depending on object key order', async () => {
    const store = openStore();
    const matchId = nextId('key-order');
    const first: LogEntry = {
      tick: 2,
      playerId: 'local:0',
      type: 'spawn',
      data: { q: 0, p: { a: 1, b: { c: 2, d: 3 } } },
    };
    const reordered: LogEntry = {
      tick: 2,
      playerId: 'local:0',
      type: 'spawn',
      data: { q: 0, p: { b: { d: 3, c: 2 }, a: 1 } },
    };
    const other: LogEntry = {
      tick: 2,
      playerId: 'local:0',
      type: 'spawn',
      data: { q: 0, p: { a: 1, b: { c: 9, d: 3 } } },
    };
    await store.saveHeader(matchId, tinyConfig(matchId));
    await store.appendCommands(matchId, [first, reordered, other], 2);
    expect((await store.load(matchId))?.tail).toHaveLength(2);
  });

  it('replaces a stored match when a fresh runner reuses its id', async () => {
    const inner = openStore();
    const store = new ClearCountingStore(inner);
    const matchId = 'local';
    await store.saveHeader(matchId, tinyConfig(matchId));
    await store.saveSnapshot(matchId, 40, new Uint8Array([9]));
    await store.appendCommands(matchId, [entry(50)], 80);
    const transport = LocalTransport.stepped({
      store,
      snapshotEveryTicks: 300,
      pauseWhenHidden: false,
    });
    const runner = keep(
      new MatchRunner(TinyGame, tinyConfig(matchId), transport, {
        hashEveryTicks: 1_000_000,
      })
    );
    runner.start();
    transport.step(3);
    expect(runner.tick).toBe(2);
    runner.dispose();
    await runner.whenPersisted();
    expect(store.clears).toBe(1);
    const loaded = await store.load(matchId);
    expect(loaded?.tick).toBe(2);
    expect(loaded?.snapshot).toBeUndefined();
    expect(loaded?.tail).toEqual([]);
  });

  it('does not clear when a resumed match flushes', async () => {
    const inner = openStore();
    const store = new ClearCountingStore(inner);
    const matchId = nextId('resume-keep');
    const transport = LocalTransport.stepped({
      store,
      snapshotEveryTicks: 4,
      pauseWhenHidden: false,
    });
    const runner = keep(
      new MatchRunner(TinyGame, tinyConfig(matchId), transport, {
        hashEveryTicks: 1_000_000,
      })
    );
    runner.start();
    transport.step(5);
    expect(runner.tick).toBe(4);
    runner.dispose();
    await runner.whenPersisted();
    expect(store.clears).toBe(1);
    expect(await store.snapshotTicks(matchId)).toEqual([4]);
    const resumed = await MatchRunner.resumeLocal(TinyGame, store, matchId, {
      pauseWhenHidden: false,
    });
    expect(resumed).not.toBeNull();
    if (resumed === null) return;
    keep(resumed);
    resumed.dispose();
    await resumed.whenPersisted();
    expect(store.clears).toBe(1);
    expect(await store.snapshotTicks(matchId)).toEqual([4]);
    expect((await store.load(matchId))?.tick).toBe(4);
  });

  it('stays ended when the winning tick was the stored snapshot', async () => {
    const store = openStore();
    const matchId = nextId('ended-snap');
    const transport = LocalTransport.stepped({
      store,
      snapshotEveryTicks: 1,
      pauseWhenHidden: false,
    });
    const runner = keep(
      new MatchRunner(
        TinyGame,
        { ...tinyConfig(matchId), arenaSize: 1 },
        transport,
        { hashEveryTicks: 1_000_000 }
      )
    );
    runner.submit({ type: 'spawn', x: 1n });
    runner.start();
    transport.step(2);
    expect(runner.tick).toBe(1);
    expect(runner.status).toBe('ended');
    runner.dispose();
    await runner.whenPersisted();
    const resumed = await MatchRunner.resumeLocal(TinyGame, store, matchId, {
      pauseWhenHidden: false,
    });
    expect(resumed).not.toBeNull();
    if (resumed === null) return;
    keep(resumed);
    expect(resumed.tick).toBe(1);
    expect(resumed.status).toBe('ended');
    expect(() => {
      resumed.start();
    }).toThrow(/match has ended/);
    expect(resumed.tick).toBe(1);
  });

  it('journals the tick when a listener disposes', async () => {
    const store = openStore();
    const matchId = nextId('dispose-tick');
    const transport = LocalTransport.stepped({
      store,
      snapshotEveryTicks: 300,
      pauseWhenHidden: false,
    });
    const runner = keep(
      new MatchRunner(
        TinyGame,
        { ...tinyConfig(matchId), inputDelayTicks: 1 },
        transport,
        { hashEveryTicks: 1_000_000 }
      )
    );
    runner.start();
    transport.step(1);
    runner.onTick((tick) => {
      if (tick === 1) runner.dispose();
    });
    runner.submit({ type: 'spawn', x: 4n });
    transport.step(1);
    expect(runner.tick).toBe(1);
    expect(runner.status).toBe('disposed');
    await runner.whenPersisted();
    const loaded = await store.load(matchId);
    expect(loaded?.tick).toBe(1);
    expect(
      loaded?.tail.some((item) => item.type === 'spawn' && item.tick === 1)
    ).toBe(true);
  });

  it('rejects a restore behind the persisted cursor', async () => {
    const store = openStore();
    const matchId = nextId('rewind');
    const transport = LocalTransport.stepped({
      store,
      snapshotEveryTicks: 5,
      pauseWhenHidden: false,
    });
    const runner = keep(
      new MatchRunner(TinyGame, tinyConfig(matchId), transport, {
        hashEveryTicks: 1_000_000,
      })
    );
    runner.start();
    transport.step(6);
    expect(runner.tick).toBe(5);
    const earlier = runner.snapshot();
    transport.step(5);
    expect(runner.tick).toBe(10);
    expect(() => {
      runner.restore(earlier);
    }).toThrow(/cannot rewind a persisted match/);
    expect(runner.tick).toBe(10);
  });
});

describe('LocalTransport persistence', () => {
  const live: MatchRunner<typeof TinyGame>[] = [];
  const restores: Array<() => void> = [];

  afterEach(() => {
    while (restores.length > 0) restores.pop()?.();
    resetTinyBotCalls();
    while (live.length > 0) live.pop()?.dispose();
  });

  it('rejects a snapshot interval that is not a positive integer', () => {
    expect(
      () => new LocalTransport({ tickRate: 1, snapshotEveryTicks: 0 })
    ).toThrow(/snapshotEveryTicks/);
    expect(() => LocalTransport.stepped({ snapshotEveryTicks: 1.5 })).toThrow(
      /snapshotEveryTicks/
    );
  });

  it('flushes on the 5s timer without writing during step', async () => {
    const store = new MemoryMatchStore();
    const matchId = nextId('timer');
    const timers = captureTimers();
    restores.push(timers.restore);
    const transport = LocalTransport.stepped({
      store,
      pauseWhenHidden: false,
      snapshotEveryTicks: 300,
    });
    const runner = new MatchRunner(TinyGame, tinyConfig(matchId), transport, {
      hashEveryTicks: 1_000_000,
    });
    live.push(runner);
    runner.start();
    transport.step(3);
    expect(runner.tick).toBe(2);
    expect(await store.load(matchId)).toBeNull();
    timers.fire(5000);
    await runner.whenPersisted();
    expect((await store.load(matchId))?.tick).toBe(2);
  });

  it('pauses and flushes when the document is hidden', async () => {
    const store = new MemoryMatchStore();
    const matchId = nextId('hide');
    const host = installDocument();
    restores.push(host.restore);
    const transport = LocalTransport.stepped({
      store,
      pauseWhenHidden: true,
      snapshotEveryTicks: 50,
    });
    const runner = new MatchRunner(TinyGame, tinyConfig(matchId), transport, {
      hashEveryTicks: 1_000_000,
    });
    live.push(runner);
    runner.start();
    transport.step(2);
    expect(runner.tick).toBe(1);
    host.visibility = 'hidden';
    host.emitDocument('visibilitychange');
    transport.step(5);
    expect(runner.tick).toBe(1);
    await runner.whenPersisted();
    expect((await store.load(matchId))?.tick).toBe(1);
    host.emitPage('pagehide');
    await runner.whenPersisted();
    expect((await store.load(matchId))?.tick).toBe(1);
  });

  it('does not pause when pauseWhenHidden is false, and still flushes', async () => {
    const store = new MemoryMatchStore();
    const matchId = nextId('visible');
    const host = installDocument();
    restores.push(host.restore);
    const transport = LocalTransport.stepped({
      store,
      pauseWhenHidden: false,
    });
    const runner = new MatchRunner(TinyGame, tinyConfig(matchId), transport, {
      hashEveryTicks: 1_000_000,
    });
    live.push(runner);
    runner.start();
    host.visibility = 'hidden';
    host.emitDocument('visibilitychange');
    transport.step(2);
    expect(runner.tick).toBe(1);
    await runner.whenPersisted();
    expect((await store.load(matchId))?.tick).toBe(1);
  });

  it('starts paused when the document is already hidden', () => {
    const host = installDocument();
    restores.push(host.restore);
    host.visibility = 'hidden';
    const transport = LocalTransport.stepped({ pauseWhenHidden: true });
    const runner = new MatchRunner(
      TinyGame,
      tinyConfig(nextId('already')),
      transport,
      { hashEveryTicks: 1_000_000 }
    );
    live.push(runner);
    runner.start();
    transport.step(1);
    expect(runner.tick).toBe(-1);
  });

  it('does not pause until the transport has started', () => {
    const host = installDocument();
    restores.push(host.restore);
    const transport = LocalTransport.stepped({ pauseWhenHidden: true });
    const runner = new MatchRunner(
      TinyGame,
      tinyConfig(nextId('hide-early')),
      transport,
      { hashEveryTicks: 1_000_000 }
    );
    live.push(runner);
    let pauses = 0;
    transport.onPause(() => {
      pauses += 1;
    });
    host.visibility = 'hidden';
    host.emitDocument('visibilitychange');
    expect(pauses).toBe(0);
    host.visibility = 'visible';
    runner.start();
    host.visibility = 'hidden';
    host.emitDocument('visibilitychange');
    expect(pauses).toBe(1);
    transport.step(2);
    expect(runner.tick).toBe(-1);
  });

  it('keeps catch-up running when the page hides before start', async () => {
    const store = new MemoryMatchStore();
    const matchId = nextId('catch-up-hide');
    const transport = LocalTransport.stepped({
      store,
      snapshotEveryTicks: 4,
      pauseWhenHidden: false,
    });
    const runner = new MatchRunner(
      TinyGame,
      { ...tinyConfig(matchId), inputDelayTicks: 1 },
      transport,
      { hashEveryTicks: 1_000_000 }
    );
    live.push(runner);
    runner.start();
    transport.step(1);
    runner.submit({ type: 'spawn', x: 3n });
    transport.step(6);
    expect(runner.tick).toBe(6);
    const digest = runner.digest();
    runner.dispose();
    await runner.whenPersisted();
    expect(await store.snapshotTicks(matchId)).toEqual([4]);

    const host = installDocument();
    restores.push(host.restore);
    const restoreClock = installFastClock();
    const restoreChannel = installYieldHider(() => {
      host.visibility = 'hidden';
      host.emitDocument('visibilitychange');
    });
    try {
      const resumed = await MatchRunner.resumeLocal(TinyGame, store, matchId, {
        pauseWhenHidden: true,
        snapshotEveryTicks: 4,
      });
      expect(resumed).not.toBeNull();
      if (resumed === null) return;
      live.push(resumed);
      expect(resumed.tick).toBe(6);
      expect(resumed.digest()).toBe(digest);
    } finally {
      restoreClock();
      restoreChannel();
    }
  });

  it('still restores an older snapshot when persistence is off', () => {
    const transport = LocalTransport.stepped({ pauseWhenHidden: false });
    const runner = new MatchRunner(
      TinyGame,
      tinyConfig(nextId('plain-restore')),
      transport,
      { hashEveryTicks: 1_000_000 }
    );
    live.push(runner);
    runner.start();
    transport.step(6);
    const earlier = runner.snapshot();
    transport.step(5);
    expect(runner.tick).toBe(10);
    runner.restore(earlier);
    expect(runner.tick).toBe(5);
  });
});

describe('fresh-match header retry', () => {
  afterEach(() => {
    resetTinyBotCalls();
  });

  it('clears a reused id once when the header write fails', async () => {
    const matchId = nextId('clear-once');
    const inner = new MemoryMatchStore();
    await inner.saveHeader(matchId, tinyConfig(matchId));
    await inner.saveSnapshot(matchId, 40, new Uint8Array([9]));
    await inner.appendCommands(matchId, [entry(50)], 80);
    const store = new FlakyHeaderStore(inner);
    const transport = LocalTransport.stepped({
      store,
      snapshotEveryTicks: 300,
      pauseWhenHidden: false,
    });
    const runner = new MatchRunner(TinyGame, tinyConfig(matchId), transport, {
      hashEveryTicks: 1_000_000,
    });
    runner.start();
    transport.step(3);
    runner.stop();
    await expect(runner.whenPersisted()).rejects.toThrow('header failed');
    expect(store.clears).toBe(1);
    runner.dispose();
    await runner.whenPersisted();
    expect(store.clears).toBe(1);
    const loaded = await store.load(matchId);
    expect(loaded?.tick).toBe(2);
    expect(loaded?.snapshot).toBeUndefined();
    expect(loaded?.tail).toEqual([]);
  });
});

describe('IndexedDbMatchStore corrupt rows', () => {
  it('rejects a corrupt read and still clears', async () => {
    const databaseName = nextId('corrupt-db');
    const matchId = nextId('corrupt');
    const store = new IndexedDbMatchStore({ databaseName });
    await store.saveHeader(matchId, tinyConfig(matchId));
    await putMeta(databaseName, matchId, { cursor: 'nope' });
    await expect(settle(store.load(matchId))).rejects.toThrow(/corrupt/);
    await settle(store.clear(matchId));
    expect(await settle(store.load(matchId))).toBeNull();
  });

  it('rejects a corrupt update and still clears', async () => {
    const databaseName = nextId('corrupt-write-db');
    const matchId = nextId('corrupt-write');
    const store = new IndexedDbMatchStore({ databaseName });
    await store.saveHeader(matchId, tinyConfig(matchId));
    await putMeta(databaseName, matchId, { cursor: 'nope' });
    await expect(
      settle(store.appendCommands(matchId, [entry(1)], 1))
    ).rejects.toThrow(/corrupt/);
    await settle(store.clear(matchId));
    expect(await settle(store.load(matchId))).toBeNull();
  });
});

class ClearCountingStore implements InspectableStore {
  public clears = 0;

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
    this.clears += 1;
    return this.inner.clear(matchId);
  }

  public snapshotTicks(matchId: string): Promise<readonly number[]> {
    return this.inner.snapshotTicks(matchId);
  }

  public deleteSnapshot(matchId: string, tick: number): Promise<void> {
    return this.inner.deleteSnapshot(matchId, tick);
  }
}

class FlakyHeaderStore extends ClearCountingStore {
  public headerFailures = 1;

  public override saveHeader(
    matchId: string,
    config: Parameters<MatchStore['saveHeader']>[1]
  ): Promise<void> {
    if (this.headerFailures > 0) {
      this.headerFailures -= 1;
      return Promise.reject(new Error('header failed'));
    }
    return super.saveHeader(matchId, config);
  }
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

function installYieldHider(onYield: () => void): () => void {
  const host = globalThis as unknown as {
    MessageChannel: new () => {
      port1: {
        onmessage: ((event: unknown) => void) | null;
        close(): void;
      };
      port2: { postMessage(data: null): void; close(): void };
    };
  };
  const original = host.MessageChannel;
  let yielded = false;
  class HidingChannel {
    public readonly port1 = {
      onmessage: null as ((event: unknown) => void) | null,
      close(): void {
        /* test double */
      },
    };
    public readonly port2 = {
      postMessage: (_data: null): void => {
        if (!yielded) {
          yielded = true;
          onYield();
        }
        this.port1.onmessage?.(null);
      },
      close(): void {
        /* test double */
      },
    };
  }
  // The test double only needs the port pair fast-forward yields on.
  host.MessageChannel = HidingChannel as unknown as typeof host.MessageChannel;
  return () => {
    host.MessageChannel = original;
  };
}

interface RawDatabase {
  transaction(
    name: string,
    mode: 'readwrite'
  ): {
    objectStore(name: string): { put(value: unknown, key: string): unknown };
    oncomplete: (() => void) | null;
    onerror: (() => void) | null;
    error: unknown;
  };
  close(): void;
}

function putMeta(
  databaseName: string,
  matchId: string,
  value: unknown
): Promise<void> {
  const host = globalThis as unknown as {
    indexedDB?: {
      open(name: string): {
        result: RawDatabase;
        error: unknown;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
      };
    };
  };
  const factory = host.indexedDB;
  if (factory === undefined) {
    return Promise.reject(new Error('indexedDB missing'));
  }
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put(value, matchId);
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

function errorOf(error: unknown): Error {
  return error instanceof Error ? error : new Error('indexedDB request failed');
}

function requireCheckpoint(bytes: Uint8Array): Uint8Array {
  const checkpoint = decodeSnapshot(bytes).inputCheckpoint;
  if (checkpoint === null) {
    throw new Error('expected an input checkpoint');
  }
  return checkpoint;
}

function captureTimers(): { fire(ms: number): void; restore(): void } {
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
    fire(ms: number): void {
      const due: number[] = [];
      for (const [id, item] of pending) {
        if (item.ms === ms) due.push(id);
      }
      for (const id of due) {
        const item = pending.get(id);
        pending.delete(id);
        item?.fn();
      }
    },
    restore(): void {
      host.setTimeout = originalSet;
      host.clearTimeout = originalClear;
    },
  };
}

function installDocument(): {
  visibility: string;
  emitDocument(type: string): void;
  emitPage(type: string): void;
  restore(): void;
} {
  const docListeners = new Map<string, () => void>();
  const pageListeners = new Map<string, () => void>();
  const state = { visibility: 'visible' };
  const doc = {
    get visibilityState(): string {
      return state.visibility;
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
    get visibility(): string {
      return state.visibility;
    },
    set visibility(value: string) {
      state.visibility = value;
    },
    emitDocument(type: string): void {
      docListeners.get(type)?.();
    },
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
