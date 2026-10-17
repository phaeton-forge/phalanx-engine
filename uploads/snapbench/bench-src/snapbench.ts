/* Snapshot save-cost bench. Read-only use of the engine; private fields reached via `any`. */
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { cpus, loadavg } from 'node:os';
import {
  LocalTransport,
  MatchRunner,
  BinaryStateWriter,
  encodeSnapshot,
  digestBytes,
  ENGINE_SNAPSHOT_FORMAT,
} from '@phalanx-engine/runtime';
import {
  createSkirmishGame,
  type SkirmishSession,
} from '../src/facade/current.js';
// dist helpers (same module instances as the runtime build)
import {
  writePools,
  writeEntityIds,
} from '../../phalanx-runtime/dist/helpers/entities.js';
import { writeSoAStores } from '../../phalanx-runtime/dist/helpers/soa.js';
import { writeAbilities } from '../../phalanx-runtime/dist/helpers/abilities.js';
import { writeRandom } from '../../phalanx-runtime/dist/helpers/random.js';
import {
  writeBroadphase,
  hasBroadphase,
} from '../../phalanx-runtime/dist/helpers/physics.js';
import { singletonHooks } from '../../phalanx-runtime/dist/world/singletons.js';
import { encodeInputCheckpoint } from '../../phalanx-runtime/dist/runner/InputCheckpoint.js';

const SIZES = (process.env.SIZES ?? '150,500,1000').split(',').map(Number);
const ITERS = Number(process.env.ITERS ?? 300);
const WARM = Number(process.env.WARM ?? 60);
const PRE_TICKS = Number(process.env.PRE_TICKS ?? 200);
const gc = (globalThis as any).gc as (() => void) | undefined;

let gcEvents: { kind: number; ms: number }[] = [];
new PerformanceObserver((list) => {
  for (const e of list.getEntries())
    gcEvents.push({ kind: (e as any).detail?.kind ?? 0, ms: e.duration });
}).observe({ entryTypes: ['gc'] });

function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}
const f = (x: number) => x.toFixed(3);

function makeRunner(n: number) {
  const session: SkirmishSession = {
    currentPeer: 'a',
    spawnOnRestore: false,
    suppressThrow: false,
    throwBot: false,
    poolProbe: false,
    dirtyAfterRestore: false,
    breakBotRestore: false,
    injectTick: -1,
    bots: {},
  };
  const game = createSkirmishGame(session, { armySize: n, slotCount: 2 });
  const config: any = {
    matchId: 'bench',
    gameId: 'skirmish',
    simVersion: 'skirmish-1',
    seed: 1234,
    side: 'client',
    inputDelayTicks: 1,
    tickLimit: 1_000_000,
    armySize: n,
    slots: [
      { slot: 0, team: 0, kind: 'human', playerId: 'local:0' },
      {
        slot: 1,
        team: 1,
        kind: 'bot',
        policy: 'aggressive',
        level: 1,
        runsOn: 'local',
      },
    ],
  };
  const transport = LocalTransport.stepped();
  const runner = new MatchRunner(game, config, transport, { localSlots: [0] });
  runner.start();
  return { runner, transport };
}

function sectionTimes(r: any) {
  const world = r.simulation.world;
  const t: Record<string, number> = {};
  const time = (k: string, fn: (w: any) => void) => {
    const w = new BinaryStateWriter();
    const t0 = performance.now();
    fn(w);
    w.finish();
    t[k] = performance.now() - t0;
  };
  r.scope.run(() => {
    time('pools', (w) => writePools(w, world));
    time('soa', (w) =>
      writeSoAStores(
        w,
        world,
        [...world.entityManager.getAllSoAStores().values()].map(
          (s: any) => s.schema
        )
      )
    );
    time('abilities', (w) => writeAbilities(w, world));
    time('ids+rng+bp+single', (w) => {
      writeEntityIds(w, world);
      writeRandom(w, world.random);
      if (hasBroadphase(world)) writeBroadphase(w, world);
      singletonHooks(world)?.onSave?.(w);
    });
  });
  return t;
}
function sectionSizes(r: any) {
  const world = r.simulation.world;
  const out: Record<string, number> = {};
  r.scope.run(() => {
    const sz = (k: string, fn: (w: any) => void) => {
      const w = new BinaryStateWriter();
      fn(w);
      out[k] = w.finish().byteLength;
    };
    sz('pools', (w) => writePools(w, world));
    sz('soa', (w) =>
      writeSoAStores(
        w,
        world,
        [...world.entityManager.getAllSoAStores().values()].map(
          (s: any) => s.schema
        )
      )
    );
    sz('abilities', (w) => writeAbilities(w, world));
    sz('ids+rng+bp+single', (w) => {
      writeEntityIds(w, world);
      writeRandom(w, world.random);
      if (hasBroadphase(world)) writeBroadphase(w, world);
      singletonHooks(world)?.onSave?.(w);
    });
  });
  return out;
}

const results: any[] = [];
console.log(
  `CPU: ${cpus()[0]?.model} x${cpus().length}; node ${process.version}; load ${loadavg()
    .map((x) => x.toFixed(2))
    .join(' ')}; gc exposed: ${gc !== undefined}`
);

const flush = () => new Promise((r) => setTimeout(r, 20));
for (const n of SIZES) {
  const { runner, transport } = makeRunner(n);
  const r: any = runner;
  // run the sim so GAS effects, contacts and respawns are live
  for (let i = 0; i < PRE_TICKS; i++) {
    if (i % 3 === 0)
      runner.submit({ type: 'cast', ability: 1, target: 1 } as any, 0);
    transport.step(1);
  }
  const world = r.simulation.world;
  const entities = world.entityManager.getAllEntities().length;
  const stores = world.entityManager.getAllSoAStores().size;
  const samples: Record<string, number[]> = {
    capture: [],
    bot: [],
    checkpoint: [],
    digest: [],
    encode: [],
    total: [],
    snapshotApi: [],
    digestApi: [],
  };
  const secs: Record<string, number[]> = {};
  let size = 0,
    bodySize = 0;
  const one = (record: boolean) => {
    transport.step(1);
    if (runner.tick % 3 === 0)
      runner.submit({ type: 'cast', ability: 1, target: 1 } as any, 0);
    let body!: Uint8Array, bot!: Uint8Array, cp!: Uint8Array, snap!: Uint8Array;
    const t0 = performance.now();
    r.scope.run(() => {
      const w = new BinaryStateWriter();
      r.requireGameState().save(w);
      body = w.finish();
    });
    const t1 = performance.now();
    {
      const w = new BinaryStateWriter();
      r.botHost.save(w);
      bot = w.finish();
    }
    const t2 = performance.now();
    cp = encodeInputCheckpoint({
      pending: r.pendingBatches(),
      nextSeq: r.sequenceSnapshot(),
      systemSeq: r.systemSeq,
    });
    const t3 = performance.now();
    snap = encodeSnapshot(
      {
        engineFormat: ENGINE_SNAPSHOT_FORMAT,
        gameId: 'skirmish',
        simVersion: 'skirmish-1',
        formatVersion: 1,
        configHash: r.configDigest,
        tick: runner.tick,
      },
      body,
      {
        botState: bot,
        inputCheckpoint: cp,
        componentSchemas: r.componentSchemaKey,
      }
    );
    const t4 = performance.now();
    const d0 = performance.now();
    digestBytes(body);
    const d1 = performance.now();
    const s0 = performance.now();
    const real = runner.snapshot();
    const s1 = performance.now();
    const g0 = performance.now();
    runner.digest();
    const g1 = performance.now();
    if (record) {
      samples.capture!.push(t1 - t0);
      samples.bot!.push(t2 - t1);
      samples.checkpoint!.push(t3 - t2);
      samples.encode!.push(t4 - t3);
      samples.total!.push(t4 - t0);
      samples.digest!.push(d1 - d0);
      samples.snapshotApi!.push(s1 - s0);
      samples.digestApi!.push(g1 - g0);
      for (const [k, v] of Object.entries(sectionTimes(r)))
        (secs[k] ??= []).push(v);
      size = real.byteLength;
      bodySize = body.byteLength;
      if (snap.byteLength !== real.byteLength)
        throw new Error('bench snapshot != runner.snapshot size');
    }
  };
  for (let i = 0; i < WARM; i++) one(false);
  await flush();
  gcEvents = [];
  for (let i = 0; i < ITERS; i++) one(true);
  await flush();
  const gcDuringTimed = gcEvents.slice();

  // allocation per runner.snapshot(): gc, snapshot, heap delta (no gc in between)
  const allocs: number[] = [];
  if (gc) {
    for (let i = 0; i < 30; i++) {
      gc();
      await flush();
      gcEvents = [];
      const h0 = process.memoryUsage().heapUsed;
      runner.snapshot();
      const h1 = process.memoryUsage().heapUsed;
      await flush();
      if (gcEvents.length === 0) allocs.push(h1 - h0);
    }
  }
  // GC during a tight loop of 200 snapshots only (no sim)
  await flush();
  gcEvents = [];
  const lt0 = performance.now();
  for (let i = 0; i < 200; i++) runner.snapshot();
  const loopMs = performance.now() - lt0;
  await flush();
  const loopGc = gcEvents.slice();

  const row: any = {
    n,
    entities,
    stores,
    size,
    bodySize,
    sizes: sectionSizes(r),
    stats: {} as any,
    secs: {} as any,
    allocKB: allocs.length ? pct(allocs, 50) / 1024 : null,
    gcTimed: {
      count: gcDuringTimed.length,
      maxMs: Math.max(0, ...gcDuringTimed.map((g) => g.ms)),
    },
    loop: {
      perSnapMs: loopMs / 200,
      gcCount: loopGc.length,
      gcTotalMs: loopGc.reduce((a, g) => a + g.ms, 0),
      gcMaxMs: Math.max(0, ...loopGc.map((g) => g.ms)),
    },
  };
  for (const [k, xs] of Object.entries(samples))
    row.stats[k] = { p50: pct(xs, 50), p99: pct(xs, 99), max: Math.max(...xs) };
  for (const [k, xs] of Object.entries(secs))
    row.secs[k] = { p50: pct(xs, 50), p99: pct(xs, 99), max: Math.max(...xs) };
  results.push(row);
  console.log(
    `\n== N=${n}: entities=${entities} soaStores=${stores} snapshot=${size}B body=${bodySize}B sections=${JSON.stringify(row.sizes)}`
  );
  for (const [k, s] of Object.entries(row.stats) as any)
    console.log(
      `  ${k.padEnd(12)} p50 ${f(s.p50)}  p99 ${f(s.p99)}  max ${f(s.max)} ms`
    );
  for (const [k, s] of Object.entries(row.secs) as any)
    console.log(
      `  [sec] ${k.padEnd(18)} p50 ${f(s.p50)}  p99 ${f(s.p99)}  max ${f(s.max)} ms`
    );
  console.log(
    `  alloc/snapshot ~${row.allocKB?.toFixed(0)} KB; GC in timed phase: ${row.gcTimed.count} events, max ${f(row.gcTimed.maxMs)} ms; tight loop: ${f(row.loop.perSnapMs)} ms/snap, ${row.loop.gcCount} GCs total ${f(row.loop.gcTotalMs)} ms max ${f(row.loop.gcMaxMs)} ms`
  );
  runner.dispose?.();
}
import('node:fs').then((fs) =>
  fs.writeFileSync(
    process.env.OUT ?? '/tmp/snapbench/results.json',
    JSON.stringify(results, null, 2)
  )
);
