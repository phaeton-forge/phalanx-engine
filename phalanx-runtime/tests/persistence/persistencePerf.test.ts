import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLIENT_SNAPSHOT_EVERY_TICKS,
  DEFAULT_HASH_EVERY_TICKS,
  LocalTransport,
  MatchRunner,
  MemoryMatchStore,
  type MatchStore,
} from '../../src/index.js';
import { createPersistBenchGame } from '../fixtures/persistBenchGame.js';

const PERF_ENABLED = process.env['PHALANX_PERF'] === '1';
const SNAPSHOT_EVERY = DEFAULT_CLIENT_SNAPSHOT_EVERY_TICKS;
const SNAPSHOT_COUNT = 30;
/** Tick 9000 is the 30th snapshot (300, 600, …, 9000). step(9001) lands there. */
const LAST_TICK = SNAPSHOT_EVERY * SNAPSHOT_COUNT;

class CountingStore implements MatchStore {
  public headerCalls = 0;
  public commandCalls = 0;
  public snapshotCalls = 0;
  private readonly inner = new MemoryMatchStore();

  public async saveHeader(
    matchId: string,
    config: Parameters<MatchStore['saveHeader']>[1]
  ): Promise<void> {
    this.headerCalls += 1;
    await this.inner.saveHeader(matchId, config);
  }

  public async appendCommands(
    matchId: string,
    entries: Parameters<MatchStore['appendCommands']>[1],
    cursorTick?: number
  ): Promise<void> {
    this.commandCalls += 1;
    await this.inner.appendCommands(matchId, entries, cursorTick);
  }

  public async saveSnapshot(
    matchId: string,
    tick: number,
    bytes: Uint8Array
  ): Promise<void> {
    this.snapshotCalls += 1;
    await this.inner.saveSnapshot(matchId, tick, bytes);
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

  public get calls(): number {
    return this.headerCalls + this.commandCalls + this.snapshotCalls;
  }
}

interface TickStat {
  readonly p50: number;
  readonly p99: number;
  readonly max: number;
  readonly n: number;
}

interface CountReport {
  readonly entities: number;
  readonly ticks: number;
  readonly hashEveryTicks: number;
  readonly snapshotEveryTicks: number;
  readonly plainFullMs: TickStat;
  readonly hashOnlyFullMs: TickStat;
  readonly snapshotFullMs: TickStat;
  readonly snapshotSyncMs: TickStat;
}

function hostNow(): number {
  const host = globalThis as unknown as { performance: { now(): number } };
  return host.performance.now();
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.min(sorted.length - 1, Math.max(0, rank));
  return sorted[index] ?? 0;
}

function summarize(values: readonly number[]): TickStat {
  return {
    p50: roundMs(percentile(values, 50)),
    p99: roundMs(percentile(values, 99)),
    max: roundMs(percentile(values, 100)),
    n: values.length,
  };
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

async function measure(entityCount: number): Promise<CountReport> {
  const game = createPersistBenchGame(entityCount);
  const store = new CountingStore();
  const matchId = `bench-${String(entityCount)}`;
  const transport = LocalTransport.stepped({
    store,
    snapshotEveryTicks: SNAPSHOT_EVERY,
    pauseWhenHidden: false,
  });
  const runner = new MatchRunner(
    game,
    {
      matchId,
      seed: 1,
      side: 'client',
      inputDelayTicks: 2,
      slots: [{ slot: 0, team: 0, kind: 'human', playerId: 'local:0' }],
    },
    transport
  );
  runner.start();

  const plainFull: number[] = [];
  const hashOnlyFull: number[] = [];
  const snapshotFull: number[] = [];
  const snapshotSync: number[] = [];

  for (let step = 0; step < LAST_TICK + 1; step += 1) {
    const started = hostNow();
    transport.step(1);
    const fullMs = hostNow() - started;
    expect(store.calls).toBe(0);
    const tick = runner.tick;
    if (tick === 0) continue;
    if (runner.lastTickPersistedSnapshot) {
      snapshotFull.push(fullMs);
      snapshotSync.push(runner.lastPersistenceSyncMs);
    } else if (tick % DEFAULT_HASH_EVERY_TICKS === 0) {
      hashOnlyFull.push(fullMs);
    } else {
      plainFull.push(fullMs);
    }
  }

  expect(runner.tick).toBe(LAST_TICK);
  expect(snapshotFull).toHaveLength(SNAPSHOT_COUNT);
  // The loop is synchronous, so the 5s flush cannot run inside it. A
  // microtask is also too early: encode is not a microtask, and the store
  // write waits for a flush. A run this long is past the flush interval, so
  // the next timer turn may write; that is the batch, not the tick.
  await Promise.resolve();
  expect(store.calls).toBe(0);
  runner.dispose();
  await runner.whenPersisted();
  expect(store.snapshotCalls).toBe(SNAPSHOT_COUNT);
  expect(await store.snapshotTicks(matchId)).toEqual([
    LAST_TICK - SNAPSHOT_EVERY,
    LAST_TICK,
  ]);

  return {
    entities: entityCount,
    ticks: LAST_TICK,
    hashEveryTicks: DEFAULT_HASH_EVERY_TICKS,
    snapshotEveryTicks: SNAPSHOT_EVERY,
    plainFullMs: summarize(plainFull),
    hashOnlyFullMs: summarize(hashOnlyFull),
    snapshotFullMs: summarize(snapshotFull),
    snapshotSyncMs: summarize(snapshotSync),
  };
}

describe.skipIf(!PERF_ENABLED)('persistence tick cost', () => {
  it('measures a GAS and pooled world at the default hash interval', async () => {
    const report = {
      counts: [await measure(500), await measure(1000)],
    };
    writeFileSync('/tmp/persist-perf.json', JSON.stringify(report, null, 2));
    console.log(`PERSIST_PERF ${JSON.stringify(report)}`);
    expect(report.counts).toHaveLength(2);
    for (const count of report.counts) {
      expect(count.snapshotFullMs.n).toBe(SNAPSHOT_COUNT);
      expect(count.hashEveryTicks).toBe(DEFAULT_HASH_EVERY_TICKS);
    }
  }, 600_000);
});
