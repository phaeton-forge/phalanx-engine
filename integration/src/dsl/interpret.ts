import type {
  GameCommandJson,
  LogEntry,
  MatchSpec,
  Peer,
  SimDriver,
  StateDump,
} from '../driver/SimDriver.js';
import type { Scenario, TimelineEvent } from './scenario.js';
import { FaultGate, type FaultSpec } from '../transport/FaultyTransport.js';
import {
  diffDumps,
  firstDivergingTick,
  type FieldDiff,
} from '../oracle/oracle.js';
import { prng, type Prng } from '../util/prng.js';
import { errorMessage } from '../util/json.js';

export interface SimulationFailure {
  readonly message: string;
  readonly tick?: number;
  readonly diffs: readonly FieldDiff[];
  readonly peerId?: string;
}

export interface SimulationSuccess {
  readonly ticks: number;
  readonly note: string;
}

interface Book {
  gate: FaultGate;
  /** A drop happened; heal with the authoritative log, not a resend. */
  catchUp: boolean;
}

/** Completion without `failsWith`. The message must not contain that text. */
class ExpectedFailureMissing extends Error {
  public readonly expectedFailureMissing = true;

  public constructor() {
    super('scenario completed without the expected failure');
  }
}

/**
 * Run one scenario on L1.
 *
 * Human envelopes are offered to a FaultGate and, once released, submitted
 * to that peer's transport (`deliver`) in release order. The gate's horizon
 * only limits how far that peer steps; it does not sort the submissions.
 * Delay, duplicate and reorder take that path. A drop is not submitted;
 * when the fault ends the peer catch-up replays the authoritative log.
 * Bot commands are not forwarded: every live peer runs its own policies.
 */
export async function simulate(
  driver: SimDriver,
  scenario: Scenario
): Promise<SimulationSuccess> {
  const spec = specFor(scenario);
  const match = driver.createMatch(spec);
  const books = new Map<string, Book>();
  const digests = new Map<string, Map<number, string>>();
  const dumps = new Map<string, Map<number, StateDump>>();
  const peers = new Map<string, Peer>();
  const gone = new Set<string>();
  const faulting = new Set<string>();
  const notes: string[] = [];
  const authorityId = scenario.peers[0] ?? 'A';
  const disabled = scenario.options?.disableFaultGate === true;
  let paused = false;
  let authorityTick = -1;
  let sawLag = false;
  try {
    const authority = match.createPeer(authorityId, { role: 'authority' });
    peers.set(authority.id, authority);
    digests.set(authority.id, new Map());
    dumps.set(authority.id, new Map());
    for (const id of scenario.peers.slice(1)) {
      const peer = match.createPeer(id, { role: 'replica' });
      peers.set(id, peer);
      books.set(id, openBook(disabled));
      digests.set(id, new Map());
      dumps.set(id, new Map());
    }
    const rng = prng(scenario.seed);
    const offered = new Map<string, number>();
    let armInject = false;
    for (let clock = 0; clock < scenario.ticks; clock += 1) {
      const note = await applyPointEvents(
        driver,
        scenario,
        clock,
        authorityId,
        () => authorityTick,
        match,
        peers,
        books,
        digests,
        dumps,
        gone,
        faulting,
        () => {
          paused = true;
        },
        () => {
          paused = false;
        }
      );
      if (note !== '') notes.push(note);
      if (
        scenario.timeline.some(
          (event) => event.op === 'inject' && event.at === clock
        )
      ) {
        armInject = true;
      }
      const live = peers.get(authorityId);
      if (live === undefined || live.status() === 'disposed') break;
      if (paused) {
        const before = live.tick();
        live.step(1);
        if (live.tick() !== before) {
          throw new Error('pause did not hold the virtual clock');
        }
        continue;
      }
      if (armInject) {
        match.armInject(live.tick() + 1);
        armInject = false;
      }
      if (live.status() === 'ended' || live.status() === 'failed') break;
      scriptInputs(scenario, spec, rng, clock, live);
      live.step(1);
      authorityTick = live.tick();
      if (live.status() === 'failed') throw new Error('authority failed');
      remember(authorityId, live, digests, dumps);
      const lagged = await syncReplicas(
        scenario,
        clock,
        live,
        match.log(),
        peers,
        books,
        digests,
        dumps,
        gone,
        offered,
        faulting
      );
      if (lagged) sawLag = true;
      if (live.status() === 'ended') break;
    }
    if (scenario.expect.failsWith !== undefined) {
      throw new ExpectedFailureMissing();
    }
    if (scenario.expect.faultEffect === true && !sawLag) {
      throw new Error('fault gate had no effect');
    }
    const minContacts = scenario.expect.minContacts;
    if (minContacts !== undefined) {
      const live = peers.get(authorityId);
      const contacts =
        live === undefined ? 0 : Number(live.stateDump().contacts);
      if (!Number.isFinite(contacts) || contacts < minContacts) {
        throw new Error(
          `expected at least ${String(minContacts)} contacts, saw ${String(contacts)}`
        );
      }
    }
    if (scenario.expect.converge === false) {
      return {
        ticks: authorityTick + 1,
        note: notes.filter(Boolean).join('; '),
      };
    }
    await flushGates(
      match.log(),
      authorityTick,
      peers,
      books,
      digests,
      dumps,
      gone
    );
    await checkConvergence(
      driver,
      scenario,
      spec,
      match.log(),
      authorityTick,
      peers,
      digests,
      dumps,
      gone
    );
    return {
      ticks: authorityTick + 1,
      note: notes.filter(Boolean).join('; '),
    };
  } catch (error) {
    if (isExpectedFailureMissing(error)) {
      throw simulationError(error.message, {
        message: error.message,
        diffs: [],
      });
    }
    const message = errorMessage(error);
    if (
      scenario.expect.failsWith !== undefined &&
      message.includes(scenario.expect.failsWith)
    ) {
      return { ticks: scenario.ticks, note: message };
    }
    if (isSimulationFailure(error)) throw error;
    throw simulationError(message, { message, diffs: [] });
  } finally {
    match.dispose();
  }
}

export function isSimulationFailure(
  error: unknown
): error is Error & SimulationFailure {
  if (!(error instanceof Error)) return false;
  if (!('diffs' in error)) return false;
  const diffs: unknown = error.diffs;
  return Array.isArray(diffs);
}

function openBook(disabled: boolean): Book {
  return { gate: new FaultGate(disabled), catchUp: false };
}

function isExpectedFailureMissing(
  error: unknown
): error is ExpectedFailureMissing {
  return (
    error instanceof ExpectedFailureMissing &&
    error.expectedFailureMissing === true
  );
}

function simulationError(message: string, body: SimulationFailure): Error {
  const error = new Error(message);
  Object.assign(error, body);
  return error;
}

function specFor(scenario: Scenario): MatchSpec {
  const injectEvent = scenario.timeline.find(
    (event): event is Extract<TimelineEvent, { op: 'inject' }> =>
      event.op === 'inject'
  );
  const throwEvent = scenario.timeline.find(
    (event): event is Extract<TimelineEvent, { op: 'throwSystem' }> =>
      event.op === 'throwSystem'
  );
  const throwBot = scenario.timeline.some((event) => event.op === 'throwBot');
  return {
    seed: scenario.seed >>> 0,
    inputDelayTicks: 1,
    slots: scenario.slots.map((slot) => parseSlot(slot)),
    options: {
      ...scenario.options,
      injectDesync:
        scenario.options?.injectDesync ??
        (injectEvent === undefined
          ? undefined
          : {
              peer: injectEvent.peer,
              afterTick: injectEvent.at,
              when: injectEvent.when ?? 'tick',
            }),
      throwOnTick: throwEvent?.at ?? scenario.options?.throwOnTick,
      throwBot: throwBot || scenario.options?.throwBot === true,
    },
  };
}

function parseSlot(slot: string): MatchSpec['slots'][number] {
  const parts = slot.split(':');
  const kind = parts[0];
  if (kind === 'human') {
    const team = parts[1] === undefined ? 0 : Number(parts[1]);
    if (!Number.isInteger(team)) throw new Error(`unknown slot '${slot}'`);
    return { kind: 'human', team };
  }
  if (kind === 'bot') {
    const policy = parts[1] ?? 'aggressive';
    const team = parts[2] === undefined ? 1 : Number(parts[2]);
    if (!Number.isInteger(team)) throw new Error(`unknown slot '${slot}'`);
    return { kind: 'bot', team, policy, level: 1 };
  }
  throw new Error(`unknown slot '${slot}'`);
}

function scriptInputs(
  scenario: Scenario,
  spec: MatchSpec,
  rng: Prng,
  clock: number,
  authority: Peer
): void {
  if (scenario.inputs === 'bots') return;
  spec.slots.forEach((slot, index) => {
    if (slot.kind !== 'human') return;
    if (scenario.inputs === 'scripted:always') {
      authority.submit({ type: 'move', dir: clock % 4 }, index);
      return;
    }
    const roll = rng.int(8);
    const command = scriptedCommand(roll, rng, clock);
    if (command !== null) authority.submit(command, index);
  });
}

function scriptedCommand(
  roll: number,
  rng: Prng,
  clock: number
): GameCommandJson | null {
  if (roll === 0) return { type: 'move', dir: rng.int(4) };
  if (roll === 1) return { type: 'attack', target: 1 + rng.int(8) };
  if (roll === 2) {
    return { type: 'cast', ability: rng.int(2), target: 1 + rng.int(8) };
  }
  if (roll === 3 && clock % 8 === 0)
    return { type: 'spawn', kind: 1 + rng.int(3) };
  if (roll === 4 && clock % 11 === 0) return { type: 'recall' };
  return null;
}

async function applyPointEvents(
  driver: SimDriver,
  scenario: Scenario,
  clock: number,
  authorityId: string,
  authorityTick: () => number,
  match: ReturnType<SimDriver['createMatch']>,
  peers: Map<string, Peer>,
  books: Map<string, Book>,
  digests: Map<string, Map<number, string>>,
  dumps: Map<string, Map<number, StateDump>>,
  gone: Set<string>,
  faulting: Set<string>,
  pause: () => void,
  resume: () => void
): Promise<string> {
  const skipped: string[] = [];
  for (const event of scenario.timeline) {
    if (!('at' in event) || event.at !== clock) continue;
    const skip = skipReason(driver, event);
    if (skip !== null) {
      skipped.push(`${event.op}: ${skip}`);
      continue;
    }
    await applyEvent(
      driver,
      scenario,
      event,
      authorityId,
      authorityTick,
      match,
      peers,
      books,
      digests,
      dumps,
      gone,
      pause,
      resume
    );
  }
  for (const event of scenario.timeline) {
    if (event.op !== 'faults') continue;
    const book = books.get(event.peer);
    if (book === undefined) continue;
    if (clock === event.from) {
      book.gate.setFault(faultOf(event));
      faulting.add(event.peer);
    }
    if (clock === event.to) {
      book.catchUp = book.gate.hasDrop();
      const released = book.gate.retransmit();
      if (!book.catchUp) deliverReleased(peers.get(event.peer), released);
      book.gate.setFault(null);
      faulting.delete(event.peer);
    }
  }
  return skipped.join('; ');
}

function skipReason(driver: SimDriver, event: TimelineEvent): string | null {
  if (event.op === 'replaceWithBot' || event.op === 'returnFromBot') {
    if (!driver.capabilities.setController) {
      return 'needs capabilities.setController';
    }
  }
  if (event.op === 'restartServer' && !driver.capabilities.restartServer) {
    return 'stage B (L2): restartServer is not on the in-process host';
  }
  return null;
}

async function applyEvent(
  driver: SimDriver,
  scenario: Scenario,
  event: TimelineEvent,
  authorityId: string,
  authorityTick: () => number,
  match: ReturnType<SimDriver['createMatch']>,
  peers: Map<string, Peer>,
  books: Map<string, Book>,
  digests: Map<string, Map<number, string>>,
  dumps: Map<string, Map<number, StateDump>>,
  gone: Set<string>,
  pause: () => void,
  resume: () => void
): Promise<void> {
  if (event.op === 'disconnect' || event.op === 'crash') {
    gone.add(event.peer);
    if (event.op === 'crash') {
      match.log();
      peers.get(event.peer)?.dispose();
      peers.delete(event.peer);
    }
    return;
  }
  if (event.op === 'reconnect') {
    await reconnect(
      event.peer,
      event.via,
      authorityId,
      authorityTick(),
      match,
      peers,
      books,
      digests,
      dumps,
      gone,
      scenario.options?.disableFaultGate === true
    );
    return;
  }
  if (event.op === 'pause') {
    peers.forEach((peer) => peer.pause());
    pause();
    return;
  }
  if (event.op === 'resume') {
    peers.forEach((peer) => peer.resume());
    resume();
    return;
  }
  if (event.op === 'malformed') {
    peers.get(event.peer)?.injectMalformed(0);
    return;
  }
  if (event.op === 'roundTrip') {
    roundTrip(
      driver,
      scenario,
      event.at,
      event.peer,
      authorityTick(),
      match,
      peers,
      books,
      digests,
      dumps
    );
    return;
  }
  if (event.op === 'schemaChange') {
    const peer = peers.get(event.peer);
    if (peer === undefined || peer.tick() < 0) return;
    const bytes = peer.snapshot();
    const mode = event.mode ?? 'version';
    const mutated =
      mode === 'swap'
        ? driver.swapSchemaFields(bytes)
        : mode === 'type'
          ? driver.changeSchemaFieldType(bytes)
          : driver.incompatibleSnapshot(bytes);
    peer.restore(mutated);
    return;
  }
  if (event.op === 'restoreSelf') {
    const peer = peers.get(event.peer);
    if (peer === undefined || peer.tick() < 0) return;
    const before = peer.stateDump();
    peer.restore(peer.snapshot());
    const after = peer.stateDump();
    const diffs = diffDumps(after, before);
    if (diffs.length > 0) {
      throw simulationError(
        `restore changed state at tick ${String(peer.tick())}`,
        {
          message: `restore changed state at tick ${String(peer.tick())}`,
          tick: peer.tick(),
          peerId: peer.id,
          diffs,
        }
      );
    }
    remember(peer.id, peer, digests, dumps);
  }
}

function roundTrip(
  driver: SimDriver,
  scenario: Scenario,
  at: number,
  peerId: string,
  authorityTick: number,
  match: ReturnType<SimDriver['createMatch']>,
  peers: Map<string, Peer>,
  books: Map<string, Book>,
  digests: Map<string, Map<number, string>>,
  dumps: Map<string, Map<number, StateDump>>
): void {
  const peer = peers.get(peerId);
  if (peer === undefined || peer.tick() < 0) return;
  const before = peer.stateDump();
  const bytes = peer.snapshot();
  const twinId = `rt-${String(at)}`;
  const twin = match.createPeer(twinId, { role: 'replica' });
  peers.set(twinId, twin);
  books.set(twinId, openBook(scenario.options?.disableFaultGate === true));
  digests.set(twinId, new Map());
  dumps.set(twinId, new Map());
  try {
    twin.restore(bytes);
  } catch (error) {
    if (!isRoundTrip(error)) throw error;
    const found = bisectRoundTrip(
      driver,
      scenario,
      specFor(scenario),
      authorityTick
    );
    throw simulationError(
      `snapshot round-trip mismatch at tick ${String(found.tick)}`,
      {
        message: `snapshot round-trip mismatch at tick ${String(found.tick)}`,
        tick: found.tick,
        peerId,
        diffs: found.diffs,
      }
    );
  }
  const diffs = diffDumps(twin.stateDump(), before);
  if (diffs.length > 0) {
    throw simulationError(`round-trip state mismatch at tick ${String(at)}`, {
      message: `round-trip state mismatch at tick ${String(at)}`,
      tick: peer.tick(),
      peerId: twinId,
      diffs,
    });
  }
  remember(twinId, twin, digests, dumps);
}

async function reconnect(
  id: string,
  via: 'snapshot' | 'log',
  authorityId: string,
  authorityTick: number,
  match: ReturnType<SimDriver['createMatch']>,
  peers: Map<string, Peer>,
  books: Map<string, Book>,
  digests: Map<string, Map<number, string>>,
  dumps: Map<string, Map<number, StateDump>>,
  gone: Set<string>,
  disabled: boolean
): Promise<void> {
  match.log();
  peers.get(id)?.dispose();
  const peer = match.createPeer(id, { role: 'replica' });
  peers.set(id, peer);
  books.set(id, openBook(disabled));
  const series = seriesFor(digests, id);
  const dumpSeries = seriesFor(dumps, id);
  gone.delete(id);
  const log = match.log();
  if (via === 'snapshot') {
    const source = snapshotSource(peers, authorityId, id);
    if (source.tick() < 0) return;
    peer.restore(source.snapshot());
    remember(id, peer, digests, dumps);
    return;
  }
  await catchUp(peer, log, authorityTick, series, dumpSeries, -1);
}

async function flushGates(
  log: readonly LogEntry[],
  authorityTick: number,
  peers: Map<string, Peer>,
  books: Map<string, Book>,
  digests: Map<string, Map<number, string>>,
  dumps: Map<string, Map<number, StateDump>>,
  gone: Set<string>
): Promise<void> {
  for (const book of books.values()) {
    book.gate.setFault(null);
    book.gate.retransmit();
    book.catchUp = false;
  }
  for (const [id, peer] of peers) {
    if (gone.has(id)) continue;
    if (peer.tick() >= authorityTick) continue;
    await catchUp(
      peer,
      log,
      authorityTick,
      seriesFor(digests, id),
      seriesFor(dumps, id),
      peer.tick()
    );
  }
}

async function syncReplicas(
  scenario: Scenario,
  clock: number,
  authority: Peer,
  log: readonly LogEntry[],
  peers: Map<string, Peer>,
  books: Map<string, Book>,
  digests: Map<string, Map<number, string>>,
  dumps: Map<string, Map<number, StateDump>>,
  gone: Set<string>,
  offered: Map<string, number>,
  faulting: Set<string>
): Promise<boolean> {
  const fresh = log.filter(
    (entry) => entry.tick === authority.tick() && isHuman(entry)
  );
  let sawLag = false;
  for (const [id, peer] of peers) {
    if (id === authority.id || gone.has(id)) continue;
    const book = books.get(id) ?? openBook(false);
    books.set(id, book);
    if (book.catchUp) {
      book.catchUp = false;
      await catchUp(
        peer,
        log,
        authority.tick(),
        seriesFor(digests, id),
        seriesFor(dumps, id),
        peer.tick()
      );
      continue;
    }
    const cursor = offered.get(id) ?? -1;
    if (authority.tick() > cursor) {
      const rng = prng(mix(scenario.seed, clock, id));
      for (const entry of fresh) book.gate.offer(authority.tick(), entry, rng);
      offered.set(id, authority.tick());
    }
    deliverReleased(peer, book.gate.releaseDue(authority.tick()));
    const through = Math.min(
      authority.tick(),
      book.gate.horizon(authority.tick()) - 1
    );
    while (peer.tick() < through) {
      if (peer.status() === 'ended' || peer.status() === 'failed') break;
      peer.step(1);
      remember(id, peer, digests, dumps);
    }
    if (faulting.has(id) && peer.tick() < authority.tick()) sawLag = true;
  }
  return sawLag;
}

async function catchUp(
  peer: Peer,
  log: readonly LogEntry[],
  through: number,
  series: Map<number, string>,
  dumpSeries: Map<number, StateDump>,
  after: number
): Promise<void> {
  let cursor = peer.tick();
  while (cursor < through) {
    if (peer.status() === 'ended' || peer.status() === 'failed') return;
    cursor += 1;
    const slice: LogEntry[] = [];
    for (const entry of log) if (entry.tick === cursor) slice.push(entry);
    await peer.fastForward(slice, cursor);
    if (cursor > after) {
      series.set(cursor, peer.digest());
      dumpSeries.set(cursor, peer.stateDump());
    }
  }
}

async function checkConvergence(
  driver: SimDriver,
  scenario: Scenario,
  spec: MatchSpec,
  log: readonly LogEntry[],
  endTick: number,
  peers: Map<string, Peer>,
  digests: Map<string, Map<number, string>>,
  dumps: Map<string, Map<number, StateDump>>,
  gone: Set<string>
): Promise<void> {
  const reference =
    scenario.expect.liveReference === true
      ? liveReference(driver, scenario, spec)
      : await logReference(driver, spec, log, endTick);
  for (const [id, series] of digests) {
    const tick = firstDivergingTick(series, reference.digests);
    if (tick !== null) {
      const peerDump = dumps.get(id)?.get(tick) ?? null;
      const referenceDump = reference.dumps.get(tick) ?? null;
      throw simulationError(`peer ${id} diverged at tick ${String(tick)}`, {
        message: `peer ${id} diverged at tick ${String(tick)}`,
        tick,
        peerId: id,
        diffs:
          peerDump === null || referenceDump === null
            ? []
            : diffDumps(peerDump, referenceDump),
      });
    }
    const peer = peers.get(id);
    if (peer === undefined || gone.has(id)) continue;
    if (peer.tick() !== endTick) {
      throw new Error(
        `peer ${id} ended at tick ${String(peer.tick())}, reference at ${String(endTick)}`
      );
    }
  }
}

async function logReference(
  driver: SimDriver,
  spec: MatchSpec,
  log: readonly LogEntry[],
  through: number
): Promise<{ digests: Map<number, string>; dumps: Map<number, StateDump> }> {
  const clean = cleanSpec(spec);
  const match = driver.createMatch(clean);
  const digests = new Map<number, string>();
  const dumps = new Map<number, StateDump>();
  try {
    const peer = match.createPeer('reference', { role: 'replica' });
    await catchUp(peer, log, through, digests, dumps, -1);
    return { digests, dumps };
  } finally {
    match.dispose();
  }
}

function liveReference(
  driver: SimDriver,
  scenario: Scenario,
  spec: MatchSpec
): { digests: Map<number, string>; dumps: Map<number, StateDump> } {
  const clean = cleanSpec(spec);
  const match = driver.createMatch(clean);
  const digests = new Map<number, string>();
  const dumps = new Map<number, StateDump>();
  try {
    const peer = match.createPeer('live-ref', { role: 'authority' });
    const rng = prng(scenario.seed);
    let paused = false;
    for (let clock = 0; clock < scenario.ticks; clock += 1) {
      if (peer.status() === 'ended' || peer.status() === 'failed') break;
      for (const event of scenario.timeline) {
        if (!('at' in event) || event.at !== clock) continue;
        if (event.op === 'pause') {
          peer.pause();
          paused = true;
        } else if (event.op === 'resume') {
          peer.resume();
          paused = false;
        }
      }
      if (paused) {
        const before = peer.tick();
        peer.step(1);
        if (peer.tick() !== before) {
          throw new Error('pause did not hold the virtual clock');
        }
        continue;
      }
      scriptInputs(scenario, clean, rng, clock, peer);
      peer.step(1);
      digests.set(peer.tick(), peer.digest());
      dumps.set(peer.tick(), peer.stateDump());
    }
    return { digests, dumps };
  } finally {
    match.dispose();
  }
}

function cleanSpec(spec: MatchSpec): MatchSpec {
  return {
    ...spec,
    options: {
      ...spec.options,
      injectDesync: undefined,
      throwOnTick: undefined,
      suppressThrow: false,
      dirtyAfterRestore: false,
      breakBotRestore: false,
    },
  };
}

function bisectRoundTrip(
  driver: SimDriver,
  scenario: Scenario,
  spec: MatchSpec,
  endTick: number
): { tick: number; diffs: readonly FieldDiff[] } {
  let low = 0;
  let high = endTick;
  let bad = endTick;
  let diffs: readonly FieldDiff[] = [];
  while (low <= high) {
    const mid = (low + high) >> 1;
    const probe = probeRoundTrip(driver, scenario, spec, mid);
    if (probe.ok) {
      low = mid + 1;
    } else {
      bad = mid;
      diffs = probe.diffs;
      high = mid - 1;
    }
  }
  return { tick: bad, diffs };
}

function probeRoundTrip(
  driver: SimDriver,
  scenario: Scenario,
  spec: MatchSpec,
  tick: number
): { ok: boolean; diffs: readonly FieldDiff[] } {
  const match = driver.createMatch(cleanSpec(spec));
  try {
    const peer = match.createPeer('probe', { role: 'authority' });
    const rng = prng(scenario.seed);
    let previous: StateDump | null = null;
    for (let clock = 0; clock <= tick; clock += 1) {
      scriptInputs(scenario, cleanSpec(spec), rng, clock, peer);
      peer.step(1);
      if (peer.tick() !== tick) {
        previous = peer.stateDump();
        continue;
      }
      const dump = peer.stateDump();
      try {
        const twin = match.createPeer('probe-twin', { role: 'replica' });
        twin.restore(peer.snapshot());
        twin.dispose();
        return { ok: true, diffs: [] };
      } catch (error) {
        if (!isRoundTrip(error)) throw error;
        return {
          ok: false,
          diffs: previous === null ? [] : diffDumps(dump, previous),
        };
      }
    }
    return { ok: true, diffs: [] };
  } finally {
    match.dispose();
  }
}

function isRoundTrip(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'SnapshotRoundTripError' ||
      error.message.includes('round-trip'))
  );
}

function snapshotSource(
  peers: Map<string, Peer>,
  authorityId: string,
  skip: string
): Peer {
  if (skip !== authorityId) {
    const authority = peers.get(authorityId);
    if (authority !== undefined && authority.status() !== 'disposed') {
      return authority;
    }
  }
  for (const [id, peer] of peers) {
    if (id !== skip && peer.status() !== 'disposed') return peer;
  }
  throw new Error('reconnect: no peer to snapshot');
}

function remember(
  id: string,
  peer: Peer,
  digests: Map<string, Map<number, string>>,
  dumps: Map<string, Map<number, StateDump>>
): void {
  seriesFor(digests, id).set(peer.tick(), peer.digest());
  seriesFor(dumps, id).set(peer.tick(), peer.stateDump());
}

function seriesFor<T>(
  maps: Map<string, Map<number, T>>,
  id: string
): Map<number, T> {
  const series = maps.get(id);
  if (series !== undefined) return series;
  const created = new Map<number, T>();
  maps.set(id, created);
  return created;
}

function deliverReleased(
  peer: Peer | undefined,
  entries: readonly LogEntry[]
): void {
  if (peer === undefined) return;
  for (const entry of entries) peer.deliver(entry);
}

function isHuman(entry: LogEntry): boolean {
  return entry.playerId.startsWith('local:');
}

function faultOf(event: Extract<TimelineEvent, { op: 'faults' }>): FaultSpec {
  return {
    delay: event.delay,
    dup: event.dup,
    reorder: event.reorder,
    drop: event.drop,
  };
}

function mix(seed: number, clock: number, id: string): number {
  let salt = clock + 1;
  for (let index = 0; index < id.length; index += 1) {
    salt = (Math.imul(salt, 33) + id.charCodeAt(index)) >>> 0;
  }
  return (seed ^ salt) >>> 0;
}
