/**
 * Sync snapshot and periodic-hash capture on a skirmish world.
 *
 *   pnpm --filter @phalanx-engine/runtime run bench
 *
 * Not part of test or build. Requires `node --expose-gc` (the script
 * sets it) and a built `dist/`. Skirmish is imported from integration.
 */
import {
  performance,
  PerformanceObserver,
  type PerformanceEntry,
} from 'node:perf_hooks';
import { cpus } from 'node:os';
import { stdout } from 'node:process';
import type {
  GameWorld,
  SoAComponentStore,
  SoASchemaDefinition,
} from '@phalanx-engine/ecs';
import {
  BinaryStateWriter,
  ENGINE_SNAPSHOT_FORMAT,
  LocalTransport,
  MatchRunner,
  digestBytes,
  encodeSnapshot,
  initDigest,
} from '../dist/index.js';
import { writeEntityIds, writePools } from '../dist/state/sections/entities.js';
import { writeRandom } from '../dist/state/sections/random.js';
import { writeSoAStore } from '../dist/state/sections/soa.js';
import { singletonHooks } from '../dist/world/singletons.js';
import {
  encodeInputCheckpoint,
  type PendingCommandBatch,
  type SlotSequence,
} from '../dist/runner/InputCheckpoint.js';
import {
  createSkirmishGame,
  type SkirmishSession,
} from '../../integration/src/facade/v65.js';

const SIZES = [500, 1000] as const;
const WARMUP = 60;
const ITERATIONS = 200;
const PRE_TICKS = 200;

interface GcSpan {
  readonly start: number;
  readonly duration: number;
}

const gcSpans: GcSpan[] = [];
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) recordGc(entry);
});
observer.observe({ entryTypes: ['gc'], buffered: true });

function recordGc(entry: PerformanceEntry): void {
  gcSpans.push({ start: entry.startTime, duration: entry.duration });
}

/** GC notifications are queued after the pause. Drain them before reading. */
async function settleGcObservations(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  for (const entry of observer.takeRecords()) recordGc(entry);
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  for (const entry of observer.takeRecords()) recordGc(entry);
}

/** GCs that began in `[start, end)`, not warmup or a pre-sample collection. */
function gcBeganDuring(start: number, end: number): readonly GcSpan[] {
  return gcSpans.filter((span) => span.start >= start && span.start < end);
}

/**
 * `captureBody` and the snapshot seal are private. The bench times those
 * same calls; this view is not public API.
 */
interface TickCapture {
  readonly scope: { run<T>(body: () => T): T };
  requireGameState(): { save(writer: BinaryStateWriter): void };
  readonly botHost: { save(writer: BinaryStateWriter): void };
  pendingBatches(): PendingCommandBatch[];
  sequenceSnapshot(): SlotSequence[];
  readonly systemSeq: number;
  readonly configDigest: string;
  readonly componentSchemaKey: string | null;
  readonly simulation: { readonly world: GameWorld } | null;
}

interface SectionProfile {
  readonly pools: ReturnType<typeof summarize>;
  readonly soa: ReturnType<typeof summarize>;
  readonly abilities: ReturnType<typeof summarize>;
  readonly rest: ReturnType<typeof summarize>;
  readonly split: ReturnType<typeof summarize>;
  readonly save: ReturnType<typeof summarize>;
}

function asTickCapture(runner: object): TickCapture {
  // Private seal fields. The bench times the same calls as the tick.
  return runner as unknown as TickCapture;
}

function exposedGc(): (() => void) | undefined {
  const host = globalThis as { gc?: () => void };
  return typeof host.gc === 'function' ? host.gc : undefined;
}

function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const last = sorted.length - 1;
  const index = Math.min(last, Math.floor((p / 100) * sorted.length));
  return sorted[index] ?? 0;
}

function summarize(samples: readonly number[]): {
  p50: number;
  p99: number;
  max: number;
} {
  return {
    p50: percentile(samples, 50),
    p99: percentile(samples, 99),
    max: Math.max(...samples),
  };
}

function session(): SkirmishSession {
  return {
    currentPeer: 'a',
    spawnOnRestore: false,
    suppressThrow: false,
    throwBot: false,
    poolProbe: false,
    dirtyAfterRestore: false,
    breakBotRestore: false,
    corruptOnRestore: false,
    injectTick: -1,
    bots: {},
    bound: {},
    controls: [],
  };
}

function open(size: number) {
  const game = createSkirmishGame(session(), { armySize: size, slotCount: 2 });
  const transport = LocalTransport.stepped();
  const runner = new MatchRunner(
    game,
    {
      matchId: 'bench',
      gameId: 'skirmish',
      simVersion: 'skirmish-1',
      seed: 1234,
      side: 'client',
      inputDelayTicks: 1,
      tickLimit: 1_000_000,
      armySize: size,
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
    },
    transport,
    { hashEveryTicks: 1_000_000, localSlots: [0] }
  );
  runner.start();
  return { runner, transport, capture: asTickCapture(runner), game };
}

function hashBody(capture: TickCapture, writer: BinaryStateWriter): Uint8Array {
  return capture.scope.run(() => {
    writer.reset();
    capture.requireGameState().save(writer);
    return writer.finish();
  });
}

function sealSnapshot(
  capture: TickCapture,
  writer: BinaryStateWriter
): { body: Uint8Array; botState: Uint8Array; inputCheckpoint: Uint8Array } {
  const body = hashBody(capture, writer);
  const botWriter = new BinaryStateWriter();
  capture.botHost.save(botWriter);
  const inputCheckpoint = encodeInputCheckpoint({
    pending: capture.pendingBatches(),
    nextSeq: capture.sequenceSnapshot(),
    systemSeq: capture.systemSeq,
  });
  return { body, botState: botWriter.finish(), inputCheckpoint };
}

async function medianAlloc(sample: () => void): Promise<number | null> {
  const gc = exposedGc();
  if (gc === undefined) return null;
  const samples: number[] = [];
  for (let round = 0; round < 15; round += 1) {
    gc();
    const before = process.memoryUsage().heapUsed;
    const start = performance.now();
    sample();
    const end = performance.now();
    const after = process.memoryUsage().heapUsed;
    await settleGcObservations();
    if (gcBeganDuring(start, end).length === 0) samples.push(after - before);
  }
  if (samples.length === 0) return null;
  return percentile(samples, 50);
}

function mb(bytes: number | null): string {
  if (bytes === null) return 'n/a';
  return (bytes / (1024 * 1024)).toFixed(3);
}

function ms(value: number): string {
  return value.toFixed(3);
}

interface SizeResult {
  readonly entities: number;
  readonly bodyBytes: number;
  readonly hashCapture: ReturnType<typeof summarize>;
  readonly snapshotCapture: ReturnType<typeof summarize>;
  readonly digest: ReturnType<typeof summarize>;
  readonly encode: ReturnType<typeof summarize>;
  readonly allocHashCapture: number | null;
  readonly allocSnapshotCapture: number | null;
  readonly allocSnapshotApi: number | null;
  readonly gcCount: number;
  readonly gcMaxMs: number;
  readonly sections: SectionProfile | null;
}

function writeSoASection(writer: BinaryStateWriter, world: GameWorld): void {
  for (const store of world.entityManager.getAllSoAStores().values()) {
    // getAllSoAStores types every store as SoAComponentStore<any>.
    writeSoAStore(
      writer,
      store as unknown as SoAComponentStore<SoASchemaDefinition>
    );
  }
}

/**
 * Same section order as `writeWorld`, timed apart, plus one full
 * `GameState.save` in that loop. Roster is omitted from the split:
 * this skirmish pools every entity, so that section is empty.
 */
function profileSections(capture: TickCapture): SectionProfile {
  const world = capture.simulation?.world;
  if (world === undefined) throw new Error('bench: simulation is missing');
  const writer = new BinaryStateWriter(65_536);
  const pools: number[] = [];
  const soa: number[] = [];
  const abilities: number[] = [];
  const rest: number[] = [];
  const split: number[] = [];
  const save: number[] = [];
  const sample = (record: boolean): void => {
    capture.scope.run(() => {
      writer.reset();
      const splitStart = performance.now();
      let started = splitStart;
      writePools(writer, world);
      const poolsMs = performance.now() - started;
      started = performance.now();
      writeSoASection(writer, world);
      const soaMs = performance.now() - started;
      started = performance.now();
      writeEntityIds(writer, world);
      writeRandom(writer, world.random);
      let abilitiesMs = 0;
      writer.section('modules', 1, (container) => {
        container.list(world.saveSections, (section, item) => {
          const sectionStart =
            section.key === 'abilities' ? performance.now() : 0;
          item.section(section.key, section.version, (body) => {
            section.write(body, world);
          });
          if (section.key === 'abilities') {
            abilitiesMs = performance.now() - sectionStart;
          }
        });
      });
      singletonHooks(world)?.onSave?.(writer);
      const restMs = performance.now() - started - abilitiesMs;
      const splitMs = performance.now() - splitStart;
      writer.reset();
      const saveStart = performance.now();
      capture.requireGameState().save(writer);
      writer.finish();
      const saveMs = performance.now() - saveStart;
      if (!record) return;
      pools.push(poolsMs);
      soa.push(soaMs);
      abilities.push(abilitiesMs);
      rest.push(restMs);
      split.push(splitMs);
      save.push(saveMs);
    });
  };
  for (let index = 0; index < WARMUP; index += 1) sample(false);
  for (let index = 0; index < ITERATIONS; index += 1) sample(true);
  return {
    pools: summarize(pools),
    soa: summarize(soa),
    abilities: summarize(abilities),
    rest: summarize(rest),
    split: summarize(split),
    save: summarize(save),
  };
}

async function measure(size: number): Promise<SizeResult> {
  const { runner, transport, capture, game } = open(size);
  for (let tick = 0; tick < PRE_TICKS; tick += 1) {
    if (tick % 3 === 0) {
      runner.submit({ type: 'cast', ability: 1, target: 1 });
    }
    transport.step(1);
    runner.flush();
  }
  const writer = new BinaryStateWriter(65_536);
  const hashCapture: number[] = [];
  const snapshotCapture: number[] = [];
  const digest: number[] = [];
  const encode: number[] = [];
  let bodyBytes = 0;

  const once = (record: boolean): void => {
    transport.step(1);
    if (runner.tick % 3 === 0) {
      runner.submit({ type: 'cast', ability: 1, target: 1 });
    }
    const hashStart = performance.now();
    const body = hashBody(capture, writer);
    const hashEnd = performance.now();
    const botWriter = new BinaryStateWriter();
    capture.botHost.save(botWriter);
    const botState = botWriter.finish();
    const inputCheckpoint = encodeInputCheckpoint({
      pending: capture.pendingBatches(),
      nextSeq: capture.sequenceSnapshot(),
      systemSeq: capture.systemSeq,
    });
    const sealEnd = performance.now();
    const digestStart = performance.now();
    digestBytes(body);
    const digestEnd = performance.now();
    const encodeStart = performance.now();
    encodeSnapshot(
      {
        engineFormat: ENGINE_SNAPSHOT_FORMAT,
        gameId: game.id,
        simVersion: game.simVersion,
        formatVersion: game.save.formatVersion,
        configHash: capture.configDigest,
        tick: runner.tick,
      },
      body,
      {
        botState,
        inputCheckpoint,
        componentSchemas: capture.componentSchemaKey,
      }
    );
    const encodeEnd = performance.now();
    if (!record) return;
    hashCapture.push(hashEnd - hashStart);
    snapshotCapture.push(sealEnd - hashStart);
    digest.push(digestEnd - digestStart);
    encode.push(encodeEnd - encodeStart);
    bodyBytes = body.byteLength;
  };

  for (let index = 0; index < WARMUP; index += 1) once(false);
  const timedStart = performance.now();
  for (let index = 0; index < ITERATIONS; index += 1) once(true);
  const timedEnd = performance.now();
  await settleGcObservations();
  const gcDuring = gcBeganDuring(timedStart, timedEnd);

  const allocHashCapture = await medianAlloc(() => {
    hashBody(capture, writer);
  });
  const allocSnapshotCapture = await medianAlloc(() => {
    sealSnapshot(capture, writer);
  });
  const allocSnapshotApi = await medianAlloc(() => {
    runner.snapshot();
  });
  const sections = size === 1000 ? profileSections(capture) : null;
  runner.dispose();

  return {
    entities: size,
    bodyBytes,
    hashCapture: summarize(hashCapture),
    snapshotCapture: summarize(snapshotCapture),
    digest: summarize(digest),
    encode: summarize(encode),
    allocHashCapture,
    allocSnapshotCapture,
    allocSnapshotApi,
    gcCount: gcDuring.length,
    gcMaxMs:
      gcDuring.length === 0
        ? 0
        : Math.max(...gcDuring.map((span) => span.duration)),
    sections,
  };
}

function sectionLine(label: string, row: ReturnType<typeof summarize>): string {
  return `${label} p50 ${ms(row.p50)}  p99 ${ms(row.p99)}  max ${ms(row.max)}`;
}

const cpu = cpus()[0]?.model ?? 'unknown';
stdout.write(
  `cpu ${cpu} x${String(cpus().length)}; node ${process.version}; gc ${String(exposedGc() !== undefined)}\n`
);

await initDigest();
const results: SizeResult[] = [];
for (const size of SIZES) {
  const row = await measure(size);
  results.push(row);
  stdout.write(
    `\n${String(size)} entities body ${String(row.bodyBytes)} B\n` +
      `hash capture ms     p50 ${ms(row.hashCapture.p50)}  p99 ${ms(row.hashCapture.p99)}  max ${ms(row.hashCapture.max)}\n` +
      `snapshot capture ms p50 ${ms(row.snapshotCapture.p50)}  p99 ${ms(row.snapshotCapture.p99)}  max ${ms(row.snapshotCapture.max)}\n` +
      `off-tick digest ms  p50 ${ms(row.digest.p50)}  p99 ${ms(row.digest.p99)}  max ${ms(row.digest.max)}\n` +
      `off-tick encode ms  p50 ${ms(row.encode.p50)}  p99 ${ms(row.encode.p99)}  max ${ms(row.encode.max)}\n` +
      `alloc hash MB ${mb(row.allocHashCapture)}  snapshot seal MB ${mb(row.allocSnapshotCapture)}  snapshot() MB ${mb(row.allocSnapshotApi)}\n` +
      `gc during timed phase count ${String(row.gcCount)} max ${ms(row.gcMaxMs)} ms\n`
  );
  if (row.sections !== null) {
    stdout.write(
      `sections @${String(size)} ms\n` +
        `  ${sectionLine('pools    ', row.sections.pools)}\n` +
        `  ${sectionLine('soa      ', row.sections.soa)}\n` +
        `  ${sectionLine('abilities', row.sections.abilities)}\n` +
        `  ${sectionLine('rest     ', row.sections.rest)}\n` +
        `  ${sectionLine('split    ', row.sections.split)}\n` +
        `  ${sectionLine('save     ', row.sections.save)}\n`
    );
  }
}

stdout.write('\n');
stdout.write(JSON.stringify(results, null, 2));
stdout.write('\n');
observer.disconnect();
