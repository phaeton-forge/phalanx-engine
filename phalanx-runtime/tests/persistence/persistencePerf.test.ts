import { writeFileSync } from 'node:fs';
import { GameSystem } from '@phalanx-engine/ecs';
import { describe, expect, it } from 'vitest';
import {
  LocalTransport,
  MatchRunner,
  MemoryMatchStore,
  defineCommands,
  defineComponent,
  defineGame,
  type MatchStore,
} from '../../src/index.js';

const FRAME_BUDGET_MS = 16;
const TICKS = 1000;
const SNAPSHOT_EVERY = 300;

const PersistBenchUnit = defineComponent('PersistBenchUnit', {
  x: 'i64',
  hp: 'i64',
});

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

class BenchSystem extends GameSystem {
  public override processTick(_tick: number): void {
    const store = this.entityManager.getSoAStore(PersistBenchUnit.schema);
    if (store === undefined) return;
    const xs = store.arrays.x;
    for (const id of store.entityIds()) {
      const index = store.indexOf(id);
      if (index < 0) continue;
      const current = xs[index];
      if (current === undefined) continue;
      xs[index] = current + 1n;
    }
  }
}

function benchGame(entityCount: number) {
  return defineGame({
    id: `persist-bench-${String(entityCount)}`,
    simVersion: 'bench-1',
    tickRate: 20,
    commands: defineCommands({}),
    components: [PersistBenchUnit],
    systems: [() => new BenchSystem()],
    onStart(ctx) {
      if (ctx.purpose !== 'fresh') return;
      for (let index = 0; index < entityCount; index += 1) {
        ctx.world.spawn({
          PersistBenchUnit: { x: 0n, hp: 1n },
        });
      }
    },
    onCommand() {},
    checkOutcome: () => null,
  });
}

interface TickStat {
  readonly p50: number;
  readonly p99: number;
  readonly max: number;
  readonly n: number;
}

interface CountReport {
  readonly entities: number;
  readonly normalFullMs: TickStat;
  readonly snapshotFullMs: TickStat;
  readonly normalSyncMs: TickStat;
  readonly snapshotSyncMs: TickStat;
  readonly snapshotSamples: readonly {
    readonly tick: number;
    readonly fullMs: number;
    readonly syncMs: number;
  }[];
  readonly syncSnapshotWithinFrame: boolean;
  readonly fullSnapshotWithinFrame: boolean;
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
    p50: percentile(values, 50),
    p99: percentile(values, 99),
    max: percentile(values, 100),
    n: values.length,
  };
}

async function measure(entityCount: number): Promise<CountReport> {
  const game = benchGame(entityCount);
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
    transport,
    { hashEveryTicks: 1_000_000 }
  );
  runner.start();
  const rows = runner.sim.world.entityManager.getSoAStore(
    PersistBenchUnit.schema
  );
  expect(rows?.entityIds().length).toBe(entityCount);

  const normalFull: number[] = [];
  const snapshotFull: number[] = [];
  const normalSync: number[] = [];
  const snapshotSync: number[] = [];
  const snapshotSamples: CountReport['snapshotSamples'][number][] = [];

  const now = hostNow;
  for (let step = 0; step < TICKS; step += 1) {
    const started = now();
    transport.step(1);
    const fullMs = now() - started;
    expect(store.calls).toBe(0);
    const tick = runner.tick;
    if (tick === 0) continue;
    const syncMs = runner.lastPersistenceSyncMs;
    if (runner.lastTickPersistedSnapshot) {
      snapshotFull.push(fullMs);
      snapshotSync.push(syncMs);
      snapshotSamples.push({ tick, fullMs, syncMs });
    } else {
      normalFull.push(fullMs);
      normalSync.push(syncMs);
    }
  }

  expect(runner.tick).toBe(TICKS - 1);
  expect(snapshotSamples.map((sample) => sample.tick)).toEqual([300, 600, 900]);
  await Promise.resolve();
  expect(store.calls).toBe(0);
  await new Promise<void>((resolve) => {
    const host = globalThis as unknown as {
      setImmediate?: (callback: () => void) => void;
    };
    if (typeof host.setImmediate === 'function') host.setImmediate(resolve);
    else resolve();
  });
  expect(store.snapshotCalls).toBe(0);
  runner.dispose();
  await runner.whenPersisted();
  expect(await store.snapshotTicks(matchId)).toEqual([300, 600, 900]);
  expect(store.snapshotCalls).toBe(3);

  const snapshotSyncMs = summarize(snapshotSync);
  const snapshotFullMs = summarize(snapshotFull);
  return {
    entities: entityCount,
    normalFullMs: summarize(normalFull),
    snapshotFullMs,
    normalSyncMs: summarize(normalSync),
    snapshotSyncMs,
    snapshotSamples,
    syncSnapshotWithinFrame: snapshotSyncMs.max < FRAME_BUDGET_MS,
    fullSnapshotWithinFrame: snapshotFullMs.max < FRAME_BUDGET_MS,
  };
}

describe('persistence tick cost', () => {
  it('measures synchronous persist cost at 500 and 1000 entities', async () => {
    const report = {
      frameBudgetMs: FRAME_BUDGET_MS,
      counts: [await measure(500), await measure(1000)],
    };
    writeFileSync('/tmp/persist-perf.json', JSON.stringify(report, null, 2));
    console.log(`PERSIST_PERF ${JSON.stringify(report)}`);
    expect(report.counts).toHaveLength(2);
  }, 60_000);
});
