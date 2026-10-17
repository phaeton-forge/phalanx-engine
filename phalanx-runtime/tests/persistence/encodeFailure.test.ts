import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LocalTransport,
  MatchRunner,
  MemoryMatchStore,
  type MatchStore,
} from '../../src/index.js';
import {
  TinyGame,
  resetTinyBotCalls,
  type TinyConfig,
} from '../fixtures/tinyGame.js';

const gate = vi.hoisted(() => ({ failEncode: false }));

vi.mock('../../src/state/snapshot.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/state/snapshot.js')
  >('../../src/state/snapshot.js');
  return {
    ...actual,
    encodeSnapshot: (
      ...args: Parameters<typeof actual.encodeSnapshot>
    ): ReturnType<typeof actual.encodeSnapshot> => {
      if (gate.failEncode) throw new Error('encode failed');
      return actual.encodeSnapshot(...args);
    },
  };
});

const ARENA = 2_000_000_000;

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

function trackUnhandled(): { errors: unknown[]; stop(): void } {
  const errors: unknown[] = [];
  const onUnhandled = (error: unknown): void => {
    errors.push(error);
  };
  process.on('unhandledRejection', onUnhandled);
  return {
    errors,
    stop(): void {
      process.off('unhandledRejection', onUnhandled);
    },
  };
}

describe('encode failure keeps the header', () => {
  afterEach(() => {
    gate.failEncode = false;
    resetTinyBotCalls();
  });

  it('commits the header and commands when urgent encode throws', async () => {
    const unhandled = trackUnhandled();
    const store = new MemoryMatchStore();
    const matchId = 'encode-urgent';
    const transport = LocalTransport.stepped({
      store,
      snapshotEveryTicks: 4,
      pauseWhenHidden: false,
    });
    const runner = new MatchRunner(TinyGame, tinyConfig(matchId), transport, {
      hashEveryTicks: 1_000_000,
    });
    const errors: unknown[] = [];
    runner.onPersistenceError((error) => {
      errors.push(error);
    });
    runner.start();
    transport.step(5);
    expect(runner.tick).toBe(4);
    expect(runner.lastTickPersistedSnapshot).toBe(true);
    gate.failEncode = true;
    runner.dispose();
    await runner.whenPersisted();
    await new Promise<void>((resolve) => {
      const host = globalThis as unknown as {
        setImmediate?: (callback: () => void) => void;
      };
      if (typeof host.setImmediate === 'function') host.setImmediate(resolve);
      else resolve();
    });
    const loaded = await store.load(matchId);
    expect(loaded).not.toBeNull();
    expect(loaded?.tick).toBe(4);
    expect(loaded?.snapshot).toBeUndefined();
    expect(errors.map((error) => (error as Error).message)).toEqual([
      'encode failed',
    ]);
    expect(unhandled.errors).toEqual([]);
    unhandled.stop();
  });

  it('commits after the off-tick encode rejects', async () => {
    const unhandled = trackUnhandled();
    const store = new MemoryMatchStore();
    const matchId = 'encode-idle';
    const transport = LocalTransport.stepped({
      store,
      snapshotEveryTicks: 4,
      pauseWhenHidden: false,
    });
    const runner = new MatchRunner(TinyGame, tinyConfig(matchId), transport, {
      hashEveryTicks: 1_000_000,
    });
    const errors: unknown[] = [];
    runner.onPersistenceError((error) => {
      errors.push(error);
    });
    runner.start();
    transport.step(5);
    gate.failEncode = true;
    await new Promise<void>((resolve) => {
      const host = globalThis as unknown as {
        setImmediate?: (callback: () => void) => void;
      };
      if (typeof host.setImmediate === 'function') host.setImmediate(resolve);
      else resolve();
    });
    expect(errors.map((error) => (error as Error).message)).toEqual([
      'encode failed',
    ]);
    expect(unhandled.errors).toEqual([]);
    runner.stop();
    await runner.whenPersisted();
    const loaded = await store.load(matchId);
    expect(loaded).not.toBeNull();
    expect(loaded?.tick).toBe(4);
    expect(loaded?.snapshot).toBeUndefined();
    expect(unhandled.errors).toEqual([]);
    runner.dispose();
    unhandled.stop();
  });
});

class HeaderFailStore implements MatchStore {
  public saveHeader(): Promise<void> {
    return Promise.reject(new Error('header failed'));
  }

  public appendCommands(): Promise<void> {
    return Promise.resolve();
  }

  public saveSnapshot(): Promise<void> {
    return Promise.resolve();
  }

  public load(): ReturnType<MatchStore['load']> {
    return Promise.resolve(null);
  }

  public clear(): Promise<void> {
    return Promise.resolve();
  }
}

class SnapshotFailStore extends MemoryMatchStore {
  public override saveSnapshot(): Promise<void> {
    return Promise.reject(new Error('snapshot store failed'));
  }
}

describe('persistence errors', () => {
  afterEach(() => {
    resetTinyBotCalls();
  });

  it('reports a store rejection from onPersistenceError', async () => {
    const unhandled = trackUnhandled();
    const store = new HeaderFailStore();
    const transport = LocalTransport.stepped({
      store,
      snapshotEveryTicks: 4,
      pauseWhenHidden: false,
    });
    const runner = new MatchRunner(
      TinyGame,
      tinyConfig('header-fail'),
      transport,
      { hashEveryTicks: 1_000_000 }
    );
    const errors: unknown[] = [];
    runner.onPersistenceError((error) => {
      errors.push(error);
    });
    runner.start();
    transport.step(2);
    runner.dispose();
    await expect(runner.whenPersisted()).rejects.toThrow('header failed');
    expect(errors.map((error) => (error as Error).message)).toEqual([
      'header failed',
    ]);
    await new Promise<void>((resolve) => {
      const host = globalThis as unknown as {
        setImmediate?: (callback: () => void) => void;
      };
      if (typeof host.setImmediate === 'function') host.setImmediate(resolve);
      else resolve();
    });
    expect(unhandled.errors).toEqual([]);
    unhandled.stop();
  });

  it('keeps the header when only the snapshot write fails', async () => {
    const store = new SnapshotFailStore();
    const matchId = 'snapshot-fail';
    const transport = LocalTransport.stepped({
      store,
      snapshotEveryTicks: 4,
      pauseWhenHidden: false,
    });
    const runner = new MatchRunner(TinyGame, tinyConfig(matchId), transport, {
      hashEveryTicks: 1_000_000,
    });
    const errors: unknown[] = [];
    runner.onPersistenceError((error) => {
      errors.push(error);
    });
    runner.start();
    transport.step(5);
    runner.dispose();
    await runner.whenPersisted();
    const loaded = await store.load(matchId);
    expect(loaded).not.toBeNull();
    expect(loaded?.tick).toBe(4);
    expect(loaded?.snapshot).toBeUndefined();
    expect(errors.map((error) => (error as Error).message)).toEqual([
      'snapshot store failed',
    ]);
  });
});
