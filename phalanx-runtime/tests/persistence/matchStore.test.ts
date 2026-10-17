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
});

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
