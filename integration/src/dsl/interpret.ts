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
import { canonicalDigest } from '../oracle/digest.js';
import {
  diffDumps,
  firstDivergingTick,
  type FieldDiff,
} from '../oracle/oracle.js';
import { prng, type Prng } from '../util/prng.js';
import { errorMessage } from '../util/json.js';

export interface ControllerTick {
  readonly tick: number;
  readonly slots: readonly {
    readonly slot: number;
    readonly mode: 'human' | 'bot';
  }[];
}

export interface SimulationFailure {
  readonly message: string;
  readonly tick?: number;
  readonly diffs: readonly FieldDiff[];
  readonly peerId?: string;
  readonly before?: StateDump;
  readonly after?: StateDump;
}

export interface SimulationSuccess {
  readonly ticks: number;
  readonly note: string;
  readonly controller?: readonly ControllerTick[];
}

interface ControlPlan {
  readonly slot: number;
  readonly mode: 'human' | 'bot';
  readonly policy?: string;
  readonly fromTick: number;
  /** Explicit `fromTick`: ask every peer once, even when the window rejects. */
  readonly once: boolean;
  readonly armed: Set<string>;
}

interface Book {
  gate: FaultGate;
  /**
   * Released, not yet submitted. Order is release order. An envelope the
   * transport would reject as too far ahead stays here until a step
   * brings it into the window; nearer envelopes are not held behind it.
   */
  pending: LogEntry[];
  /**
   * Malformed targets still outside this peer's submit window. Drained
   * the same way as `pending`: injected once `target` is at most
   * {@link TRANSPORT_WINDOW} ticks ahead, dropped when a log catch-up
   * will replay the envelope.
   */
  malformed: number[];
  /**
   * Slots handed to a bot whose pending commands a restored replica does
   * not own. Replay those log entries through `replayBotsThrough`.
   */
  replayBotSlots: number[];
  replayBotsThrough: number;
  /** A drop happened; heal with the authoritative log, not a resend. */
  catchUp: boolean;
}

/**
 * `LocalTransport.manual` rejects a submit more than this many ticks
 * ahead. The interpreter does not import the engine, so the default
 * lives here too.
 */
const TRANSPORT_WINDOW = 8;

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
  const plans: ControlPlan[] = [];
  const controller: ControllerTick[] = [];
  const handoffShot: { bytes: Uint8Array | null } = { bytes: null };
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
        spec,
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
        plans,
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
      notes.push(...armControls(plans, peers, gone, spec));
      // 'before' must include the queued system command. Capturing above
      // armControls snapshots an empty checkpoint, and the proof then
      // passes by replaying the command from the log.
      captureHandoff(scenario, plans, live, handoffShot);
      scriptInputs(scenario, spec, rng, clock, live);
      live.step(1);
      authorityTick = live.tick();
      captureHandoff(scenario, plans, live, handoffShot);
      if (tracksController(scenario)) {
        controller.push({
          tick: live.tick(),
          slots: spec.slots.map((_slot, index) => ({
            slot: index,
            mode: live.controllerOf(index),
          })),
        });
      }
      if (live.status() === 'failed') throw new Error('authority failed');
      remember(authorityId, live, digests, dumps);
      const lagged = await syncReplicas(
        scenario,
        spec,
        clock,
        live,
        match.log(),
        peers,
        books,
        digests,
        dumps,
        gone,
        offered,
        faulting,
        plans
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
    // A lagging replica has not yet applied a late rejection. Catch up
    // before comparing histories, or a convergent run fails sameRejection.
    if (scenario.expect.converge !== false) {
      await flushGates(
        match.log(),
        authorityTick,
        peers,
        books,
        digests,
        dumps,
        gone,
        plans
      );
    }
    const rejectionNote = rejectionFailure(scenario, peers);
    if (rejectionNote !== null) throw new Error(rejectionNote);
    const differed = sameRejection(scenario, peers);
    if (differed !== null) throw new Error(differed);
    if (scenario.expect.converge === false) {
      return {
        ticks: authorityTick + 1,
        note: notes.filter(Boolean).join('; '),
        ...(controller.length === 0 ? {} : { controller }),
      };
    }
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
    const authorityPeer = peers.get(authorityId);
    if (scenario.expect.replay === true && authorityPeer !== undefined) {
      const series = dumps.get(authorityId);
      if (series !== undefined) {
        await replayDigests(driver, authorityPeer, series);
      }
    }
    if (
      scenario.expect.handoffRestore !== undefined &&
      authorityPeer !== undefined
    ) {
      await proveHandoffRestore(
        scenario,
        plans,
        handoffShot.bytes,
        authorityPeer,
        authorityTick,
        match,
        digests.get(authorityId)
      );
    }
    if (scenario.expect.botReinit === true && authorityPeer !== undefined) {
      proveBotReinit(driver, spec, authorityPeer, plans);
    }
    if (scenario.expect.systemSeq === true && authorityPeer !== undefined) {
      proveSystemSeq(match, authorityPeer, spec);
    }
    return {
      ticks: authorityTick + 1,
      note: notes.filter(Boolean).join('; '),
      ...(controller.length === 0 ? {} : { controller }),
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
  return {
    gate: new FaultGate(disabled),
    pending: [],
    malformed: [],
    replayBotSlots: [],
    replayBotsThrough: -1,
    catchUp: false,
  };
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
  spec: MatchSpec,
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
  plans: ControlPlan[],
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
      spec,
      event,
      authorityId,
      authorityTick,
      match,
      peers,
      books,
      digests,
      dumps,
      gone,
      plans,
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
      if (!book.catchUp) book.pending.push(...released);
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
    return 'stage B (L2): needs relay/SimHost process (tasks 8, 11)';
  }
  return null;
}

async function applyEvent(
  driver: SimDriver,
  scenario: Scenario,
  spec: MatchSpec,
  event: TimelineEvent,
  authorityId: string,
  authorityTick: () => number,
  match: ReturnType<SimDriver['createMatch']>,
  peers: Map<string, Peer>,
  books: Map<string, Book>,
  digests: Map<string, Map<number, string>>,
  dumps: Map<string, Map<number, StateDump>>,
  gone: Set<string>,
  plans: ControlPlan[],
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
      plans,
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
    // Every live peer gets the extra envelope on the authority's next
    // tick. Injecting on one transport, then replaying the log, lets the
    // replica drop the slot's real command (the runner stores a malformed
    // envelope as q 0).
    const clockPeer = peers.get(authorityId) ?? peers.get(event.peer);
    const target = (clockPeer?.tick() ?? -1) + 1;
    for (const [id, peer] of peers) {
      if (gone.has(id)) continue;
      if (peer.status() === 'disposed' || peer.status() === 'failed') continue;
      // A dropped command can leave this peer more than TRANSPORT_WINDOW
      // ticks behind. submit() throws on that target; hold it with the
      // rest of the peer's pending traffic.
      if (fitsSubmit(peer, target)) {
        peer.injectMalformed(0, target);
        continue;
      }
      const book = books.get(id) ?? openBook(false);
      books.set(id, book);
      book.malformed.push(target);
    }
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
      dumps,
      plans
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
  if (event.op === 'replaceWithBot' || event.op === 'returnFromBot') {
    const clockPeer = peers.get(authorityId) ?? peers.get(event.peer);
    if (clockPeer === undefined) return;
    const fromTick =
      event.fromTick ??
      clockPeer.tick() + (event.delay ?? spec.inputDelayTicks);
    plans.push({
      slot: event.slot ?? slotOfPeer(event.peer),
      mode: event.op === 'replaceWithBot' ? 'bot' : 'human',
      ...(event.op === 'replaceWithBot' ? { policy: event.policy } : {}),
      fromTick,
      once: event.fromTick !== undefined,
      armed: new Set(),
    });
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
  dumps: Map<string, Map<number, StateDump>>,
  plans: readonly ControlPlan[]
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
  let after: StateDump | null = null;
  try {
    twin.restore(bytes);
  } catch (error) {
    if (!isRoundTrip(error)) throw error;
    try {
      after = twin.stateDump();
    } catch {
      after = null;
    }
    const found =
      after === null
        ? bisectRoundTrip(driver, scenario, specFor(scenario), authorityTick)
        : {
            tick: peer.tick(),
            diffs: diffDumps(after, before).slice(0, 11),
          };
    const first = found.diffs[0];
    const field =
      first === undefined
        ? ''
        : ` ${first.entity}/${first.component}/${first.field}`;
    throw simulationError(
      `snapshot round-trip mismatch at tick ${String(found.tick)}${field}`,
      {
        message: `snapshot round-trip mismatch at tick ${String(found.tick)}${field}`,
        tick: found.tick,
        peerId,
        diffs: found.diffs,
        before,
        ...(after === null ? {} : { after }),
      }
    );
  }
  const restored = twin.stateDump();
  const diffs = diffDumps(restored, before).slice(0, 11);
  if (diffs.length > 0) {
    const first = diffs[0];
    const field =
      first === undefined
        ? ''
        : ` ${first.entity}/${first.component}/${first.field}`;
    throw simulationError(
      `round-trip state mismatch at tick ${String(peer.tick())}${field}`,
      {
        message: `round-trip state mismatch at tick ${String(peer.tick())}${field}`,
        tick: peer.tick(),
        peerId: twinId,
        diffs,
        before,
        after: restored,
      }
    );
  }
  // The snapshot already applied every handoff at or before this tick.
  // Leaving the twin unarmed makes the next pass throw setController missed.
  noteReplayedControls(plans, twinId, twin);
  const book = books.get(twinId);
  if (book !== undefined) {
    // A replica does not own a slot that started human. The checkpoint
    // drops that bot's already-queued command; replay it from the log
    // for the delay window, then let the restored policy decide.
    const spec = specFor(scenario);
    book.replayBotSlots = handedBotSlots(plans, twin.tick(), spec);
    book.replayBotsThrough = twin.tick() + spec.inputDelayTicks;
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
  plans: readonly ControlPlan[],
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
    noteReplayedControls(plans, id, peer);
    return;
  }
  await catchUp(peer, log, authorityTick, series, dumpSeries, -1);
  noteReplayedControls(plans, id, peer);
}

async function flushGates(
  log: readonly LogEntry[],
  authorityTick: number,
  peers: Map<string, Peer>,
  books: Map<string, Book>,
  digests: Map<string, Map<number, string>>,
  dumps: Map<string, Map<number, StateDump>>,
  gone: Set<string>,
  plans: readonly ControlPlan[]
): Promise<void> {
  for (const book of books.values()) {
    book.gate.setFault(null);
    book.gate.retransmit();
    book.pending = [];
    book.catchUp = false;
  }
  for (const [id, peer] of peers) {
    if (gone.has(id)) continue;
    if (peer.tick() >= authorityTick) continue;
    const book = books.get(id);
    // The log replay applies the malformed envelope. A late inject would
    // target a tick this peer is about to leave behind.
    if (book !== undefined) book.malformed = [];
    await catchUp(
      peer,
      log,
      authorityTick,
      seriesFor(digests, id),
      seriesFor(dumps, id),
      peer.tick()
    );
    noteReplayedControls(plans, id, peer);
  }
}

async function syncReplicas(
  scenario: Scenario,
  spec: MatchSpec,
  clock: number,
  authority: Peer,
  log: readonly LogEntry[],
  peers: Map<string, Peer>,
  books: Map<string, Book>,
  digests: Map<string, Map<number, string>>,
  dumps: Map<string, Map<number, StateDump>>,
  gone: Set<string>,
  offered: Map<string, number>,
  faulting: Set<string>,
  plans: ControlPlan[]
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
      book.pending = [];
      book.malformed = [];
      await catchUp(
        peer,
        log,
        authority.tick(),
        seriesFor(digests, id),
        seriesFor(dumps, id),
        peer.tick()
      );
      noteReplayedControls(plans, id, peer);
      continue;
    }
    const cursor = offered.get(id) ?? -1;
    if (authority.tick() > cursor) {
      const rng = prng(mix(scenario.seed, clock, id));
      for (const entry of fresh) book.gate.offer(authority.tick(), entry, rng);
      offered.set(id, authority.tick());
    }
    if (
      book.replayBotSlots.length > 0 &&
      authority.tick() <= book.replayBotsThrough
    ) {
      for (const entry of log) {
        if (entry.tick !== authority.tick() || !isBot(entry)) continue;
        const slot = botSlot(entry.playerId);
        if (slot === null || !book.replayBotSlots.includes(slot)) continue;
        book.pending.push(entry);
      }
    }
    book.pending.push(...book.gate.releaseDue(authority.tick()));
    armControls(plans, peers, gone, spec);
    const through = Math.min(
      authority.tick(),
      book.gate.horizon(authority.tick()) - 1
    );
    drainPending(
      id,
      peer,
      book,
      through,
      digests,
      dumps,
      plans,
      peers,
      gone,
      spec
    );
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

function drainPending(
  id: string,
  peer: Peer,
  book: Book,
  through: number,
  digests: Map<string, Map<number, string>>,
  dumps: Map<string, Map<number, StateDump>>,
  plans: readonly ControlPlan[],
  peers: ReadonlyMap<string, Peer>,
  gone: ReadonlySet<string>,
  spec: MatchSpec
): void {
  const limit = Math.max(through, 0) + book.pending.length + TRANSPORT_WINDOW;
  for (let guard = 0; guard <= limit; guard += 1) {
    if (peer.status() === 'ended' || peer.status() === 'failed') return;
    flushMalformed(peer, book);
    const deferred: LogEntry[] = [];
    for (const entry of book.pending) {
      if (fitsWindow(peer, entry)) peer.deliver(entry);
      else deferred.push(entry);
    }
    book.pending = deferred;
    if (peer.tick() >= through) return;
    // A delayed peer can cross fromTick in this loop. Arm on the tick
    // that is still inside the window, before the step that applies it.
    armControls(plans, peers, gone, spec);
    const before = peer.tick();
    peer.step(1);
    if (peer.tick() === before) return;
    remember(id, peer, digests, dumps);
  }
  throw new Error('replica delivery did not advance');
}

function fitsWindow(peer: Peer, entry: LogEntry): boolean {
  return fitsSubmit(peer, entry.tick);
}

/** `LocalTransport.submit` accepts `target` in `[nextTick, nextTick + window]`. */
function fitsSubmit(peer: Peer, target: number): boolean {
  const next = peer.tick() + 1;
  return target >= next && target <= next + TRANSPORT_WINDOW;
}

function flushMalformed(peer: Peer, book: Book): void {
  if (book.malformed.length === 0) return;
  const deferred: number[] = [];
  for (const target of book.malformed) {
    if (fitsSubmit(peer, target)) peer.injectMalformed(0, target);
    else if (target > peer.tick() + 1 + TRANSPORT_WINDOW) deferred.push(target);
  }
  book.malformed = deferred;
}

function isHuman(entry: LogEntry): boolean {
  return entry.playerId.startsWith('local:');
}

function isBot(entry: LogEntry): boolean {
  return botSlot(entry.playerId) !== null;
}

function botSlot(playerId: string): number | null {
  if (!playerId.startsWith('bot:')) return null;
  const slot = Number(playerId.slice('bot:'.length));
  if (!Number.isInteger(slot) || slot < 0) return null;
  return slot;
}

/**
 * Slots a handoff moved onto a bot. Slots that started as bots already
 * keep their queued commands on restore, so replaying those would apply
 * the attack twice.
 */
function handedBotSlots(
  plans: readonly ControlPlan[],
  now: number,
  spec: MatchSpec
): number[] {
  const startedBot = new Set<number>();
  spec.slots.forEach((slot, index) => {
    if (slot.kind === 'bot') startedBot.add(index);
  });
  const mode = new Map<number, 'human' | 'bot'>();
  const ordered = [...plans].sort(
    (left, right) => left.fromTick - right.fromTick
  );
  for (const plan of ordered) {
    if (plan.fromTick > now) continue;
    mode.set(plan.slot, plan.mode);
  }
  const slots: number[] = [];
  for (const [slot, value] of mode) {
    if (value === 'bot' && !startedBot.has(slot)) slots.push(slot);
  }
  slots.sort((left, right) => left - right);
  return slots;
}

function faultOf(event: Extract<TimelineEvent, { op: 'faults' }>): FaultSpec {
  return {
    delay: event.delay,
    dup: event.dup,
    reorder: event.reorder,
    drop: event.drop,
  };
}

/** Peer A is slot 0, B is slot 1, C is slot 2. An explicit `slot` wins. */
export function slotOfPeer(peer: string): number {
  if (peer === 'B') return 1;
  if (peer === 'C') return 2;
  return 0;
}

/**
 * A snapshot or log replay already applied controller changes that were
 * in the past. Mark those peers armed so a later step does not treat the
 * missed live window as a second handoff.
 */
function noteReplayedControls(
  plans: readonly ControlPlan[],
  id: string,
  peer: Peer
): void {
  const now = peer.tick();
  for (const plan of plans) {
    if (plan.armed.has(id) || plan.fromTick > now) continue;
    plan.armed.add(id);
  }
}

function tracksController(scenario: Scenario): boolean {
  return scenario.timeline.some(
    (event) => event.op === 'replaceWithBot' || event.op === 'returnFromBot'
  );
}

function armControls(
  plans: readonly ControlPlan[],
  peers: ReadonlyMap<string, Peer>,
  gone: ReadonlySet<string>,
  spec: MatchSpec
): string[] {
  const notes: string[] = [];
  for (const plan of plans) {
    for (const [id, peer] of peers) {
      if (plan.armed.has(id) || gone.has(id)) continue;
      const status = peer.status();
      if (status === 'disposed' || status === 'failed') continue;
      const now = peer.tick();
      const inWindow =
        plan.fromTick > now && plan.fromTick <= now + spec.inputDelayTicks;
      if (!plan.once && plan.fromTick <= now) {
        throw new Error(
          `setController missed on ${id}: slot ${String(plan.slot)} fromTick ${String(plan.fromTick)} at tick ${String(now)}`
        );
      }
      if (!plan.once && !inWindow) continue;
      const reason = peer.setController(plan.slot, plan.mode, {
        fromTick: plan.fromTick,
        ...(plan.policy === undefined ? {} : { policy: plan.policy }),
      });
      plan.armed.add(id);
      if (reason !== null) {
        notes.push(`${plan.mode} slot ${String(plan.slot)}: ${reason}`);
      }
    }
  }
  return notes;
}

function rejectionFailure(
  scenario: Scenario,
  peers: ReadonlyMap<string, Peer>
): string | null {
  const reasons: { type: string; reason: string }[] = [];
  for (const peer of peers.values()) reasons.push(...peer.rejections());
  const expected = scenario.expect.rejection;
  if (
    expected !== undefined &&
    !reasons.some((item) => item.reason.includes(expected))
  ) {
    return `expected rejection '${expected}'`;
  }
  if (scenario.expect.converge === false) return null;
  const unexpected = reasons.filter(
    (item) =>
      item.type === 'setController' &&
      (expected === undefined || !item.reason.includes(expected))
  );
  if (unexpected.length === 0) return null;
  return `setController rejected: ${unexpected
    .map((item) => item.reason)
    .join('; ')}`;
}

async function replayDigests(
  driver: SimDriver,
  authority: Peer,
  series: ReadonlyMap<number, StateDump>
): Promise<void> {
  const replay = authority.toReplay();
  const peer = driver.openReplay(replay);
  try {
    const ticks = [...series.keys()].sort((left, right) => left - right);
    for (const tick of ticks) {
      const slice = replay.log.filter((entry) => entry.tick === tick);
      await peer.fastForward(slice, tick);
      const live = series.get(tick);
      if (live === undefined) continue;
      if (digestWithoutBots(peer.stateDump()) !== digestWithoutBots(live)) {
        throw new Error(`replay diverged at tick ${String(tick)}`);
      }
    }
  } finally {
    peer.dispose();
  }
}

function digestWithoutBots(dump: StateDump): string {
  return canonicalDigest({ ...dump, bots: {} });
}

function captureHandoff(
  scenario: Scenario,
  plans: readonly ControlPlan[],
  peer: Peer,
  shot: { bytes: Uint8Array | null }
): void {
  if (shot.bytes !== null || scenario.expect.handoffRestore === undefined) {
    return;
  }
  const plan = plans[0];
  if (plan === undefined) return;
  const offset =
    scenario.expect.handoffRestore === 'before'
      ? -1
      : scenario.expect.handoffRestore === 'at'
        ? 0
        : 1;
  if (peer.tick() !== plan.fromTick + offset) return;
  shot.bytes = peer.snapshot();
}

async function proveHandoffRestore(
  scenario: Scenario,
  plans: readonly ControlPlan[],
  bytes: Uint8Array | null,
  authority: Peer,
  authorityTick: number,
  match: ReturnType<SimDriver['createMatch']>,
  series: Map<number, string> | undefined
): Promise<void> {
  const plan = plans[0];
  const mode = scenario.expect.handoffRestore;
  if (plan === undefined || mode === undefined) {
    throw new Error('handoff restore: no controller plan');
  }
  const offset = mode === 'before' ? -1 : mode === 'at' ? 0 : 1;
  const target = plan.fromTick + offset;
  if (bytes === null || series === undefined) {
    throw new Error(`handoff restore: no snapshot at tick ${String(target)}`);
  }
  const twin = match.createPeer('handoff-restore', { role: 'replica' });
  try {
    twin.restore(bytes);
    if (twin.tick() !== target) {
      throw new Error(
        `handoff restore: restored tick ${String(twin.tick())}, wanted ${String(target)}`
      );
    }
    const atShot = series.get(target);
    if (atShot === undefined || twin.digest() !== atShot) {
      throw new Error(
        `handoff restore: digest mismatch at tick ${String(target)}`
      );
    }
    const replayed = new Map<number, string>();
    let after = target;
    if (mode === 'before') {
      // Cross fromTick from the restored checkpoint. Replaying the system
      // command here would hide a restore that dropped pending handoffs.
      for (const entry of match.log()) {
        if (entry.tick === plan.fromTick) twin.deliver(entry);
      }
      twin.step(1);
      if (twin.tick() !== plan.fromTick) {
        throw new Error(
          `handoff restore: checkpoint advanced to ${String(twin.tick())}, wanted ${String(plan.fromTick)}`
        );
      }
      const crossed = series.get(plan.fromTick);
      if (crossed === undefined || twin.digest() !== crossed) {
        throw new Error(
          `handoff restore: digest mismatch at tick ${String(plan.fromTick)}`
        );
      }
      replayed.set(plan.fromTick, twin.digest());
      after = plan.fromTick;
    }
    await catchUp(twin, match.log(), authorityTick, replayed, new Map(), after);
    for (const [tick, digest] of replayed) {
      if (series.get(tick) !== digest) {
        throw new Error(
          `handoff restore: digest mismatch at tick ${String(tick)}`
        );
      }
    }
    if (twin.tick() !== authority.tick()) {
      throw new Error('handoff restore: restored run ended early');
    }
  } finally {
    twin.dispose();
  }
}

function proveBotReinit(
  driver: SimDriver,
  spec: MatchSpec,
  authority: Peer,
  plans: readonly ControlPlan[]
): void {
  const second = plans.filter((plan) => plan.mode === 'bot')[1];
  if (second === undefined) {
    throw new Error('bot reinit: expected a second handoff');
  }
  const slot = String(second.slot);
  const live = authority.stateDump().bots[slot];
  if (live === undefined) throw new Error('bot reinit: live bot has no note');
  const match = driver.createMatch(spec);
  try {
    const ref = match.createPeer('reinit', { role: 'authority' });
    ref.step(1);
    const fromTick = ref.tick() + spec.inputDelayTicks;
    const reason = ref.setController(second.slot, 'bot', {
      fromTick,
      policy: second.policy ?? 'defensive',
    });
    if (reason !== null) {
      throw new Error(`bot reinit reference rejected: ${reason}`);
    }
    while (ref.tick() < fromTick) ref.step(1);
    const note = ref.stateDump().bots[slot];
    if (note === undefined)
      throw new Error('bot reinit: reference has no note');
    if (note.phase !== live.phase || note.rng !== live.rng) {
      throw new Error(
        `bot reinit: phase/rng ${live.phase}/${live.rng} !== reference ${note.phase}/${note.rng}`
      );
    }
  } finally {
    match.dispose();
  }
}

function proveSystemSeq(
  match: ReturnType<SimDriver['createMatch']>,
  authority: Peer,
  spec: MatchSpec
): void {
  const first = authority.snapshot();
  const second = authority.snapshot();
  if (!sameBytes(first, second)) {
    throw new Error('systemSeq: second save differed');
  }
  const priorQs = match
    .log()
    .filter((entry) => entry.playerId === 'system')
    .map((entry) => entry.data.q);
  assertUniqueQs(priorQs);
  const expected = priorQs.length === 0 ? 0 : Math.max(...priorQs) + 1;
  const twin = match.createPeer('system-seq', { role: 'replica' });
  try {
    twin.restore(first);
    const slot = 0;
    const mode = twin.controllerOf(slot) === 'bot' ? 'human' : 'bot';
    const fromTick = twin.tick() + spec.inputDelayTicks;
    const reason = twin.setController(slot, mode, {
      fromTick,
      ...(mode === 'bot' ? { policy: 'defensive' } : {}),
    });
    if (reason !== null) {
      throw new Error(`systemSeq: follow-up rejected: ${reason}`);
    }
    while (twin.tick() < fromTick) {
      if (twin.status() === 'ended' || twin.status() === 'failed') break;
      twin.step(1);
    }
    const next = twin
      .commandLog()
      .find((entry) => entry.playerId === 'system' && entry.tick === fromTick);
    if (next === undefined) {
      throw new Error('systemSeq: follow-up command was not logged');
    }
    if (next.data.q !== expected) {
      throw new Error(
        `systemSeq: expected q ${String(expected)}, got ${String(next.data.q)}`
      );
    }
    assertUniqueQs([...priorQs, next.data.q]);
  } finally {
    twin.dispose();
  }
}

function assertUniqueQs(values: readonly number[]): void {
  const seen = new Set<number>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`systemSeq: duplicate q ${String(value)}`);
    }
    seen.add(value);
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function sameRejection(
  scenario: Scenario,
  peers: ReadonlyMap<string, Peer>
): string | null {
  const expected = scenario.expect.rejection;
  if (expected === undefined || peers.size < 2) return null;
  let first: string | null = null;
  for (const peer of peers.values()) {
    const reason = peer
      .rejections()
      .find((item) => item.reason.includes(expected));
    if (reason === undefined) {
      return `rejection differed across peers: ${peer.id} missed '${expected}'`;
    }
    if (first === null) first = reason.reason;
    else if (reason.reason !== first) {
      return `rejection differed across peers: ${first} vs ${reason.reason}`;
    }
  }
  return null;
}

function mix(seed: number, clock: number, id: string): number {
  let salt = clock + 1;
  for (let index = 0; index < id.length; index += 1) {
    salt = (Math.imul(salt, 33) + id.charCodeAt(index)) >>> 0;
  }
  return (seed ^ salt) >>> 0;
}
