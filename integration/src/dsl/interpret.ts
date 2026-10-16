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

/**
 * Run one scenario on L1. Faults withhold delivery; the peer catches up
 * from the authoritative log when the withheld tick is released (drops
 * are retransmitted from that log at the end of the fault range).
 */
export async function simulate(
  driver: SimDriver,
  scenario: Scenario
): Promise<SimulationSuccess> {
  const spec = specFor(scenario);
  const match = driver.createMatch(spec);
  const gates = new Map<string, FaultGate>();
  const digests = new Map<string, Map<number, string>>();
  const peers = new Map<string, Peer>();
  const gone = new Set<string>();
  const notes: string[] = [];
  const authorityId = scenario.peers[0] ?? 'A';
  let paused = false;
  let authorityTick = -1;
  try {
    const authority = match.createPeer(authorityId, { role: 'authority' });
    peers.set(authority.id, authority);
    digests.set(authority.id, new Map());
    for (const id of scenario.peers.slice(1)) {
      const peer = match.createPeer(id, { role: 'replica' });
      peers.set(id, peer);
      gates.set(id, new FaultGate());
      digests.set(id, new Map());
    }
    const rng = prng(scenario.seed);
    const offered = new Map<string, number>();
    for (let clock = 0; clock < scenario.ticks; clock += 1) {
      const note = await applyPointEvents(
        driver,
        scenario,
        clock,
        authorityId,
        () => authorityTick,
        match,
        peers,
        gates,
        digests,
        gone,
        () => {
          paused = true;
        },
        () => {
          paused = false;
        }
      );
      if (note !== '') notes.push(note);
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
      if (live.status() === 'ended' || live.status() === 'failed') break;
      scriptInputs(scenario, spec, rng, clock, live);
      live.step(1);
      authorityTick = live.tick();
      if (live.status() === 'failed') throw new Error('authority failed');
      digests.get(authorityId)?.set(live.tick(), live.digest());
      await syncReplicas(
        scenario,
        clock,
        live,
        match.log(),
        peers,
        gates,
        digests,
        gone,
        offered
      );
      if (live.status() === 'ended') break;
    }
    if (scenario.expect.failsWith !== undefined) {
      throw new Error(
        `expected failure ${scenario.expect.failsWith} but the scenario completed`
      );
    }
    if (scenario.expect.converge === false) {
      return {
        ticks: authorityTick + 1,
        note: notes.filter(Boolean).join('; '),
      };
    }
    await flushGates(match.log(), authorityTick, peers, gates, digests, gone);
    await checkConvergence(
      driver,
      scenario,
      spec,
      match.log(),
      authorityTick,
      peers,
      digests,
      gone
    );
    return {
      ticks: authorityTick + 1,
      note: notes.filter(Boolean).join('; '),
    };
  } catch (error) {
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
  if (scenario.inputs !== 'scripted:basic') return;
  spec.slots.forEach((slot, index) => {
    if (slot.kind !== 'human') return;
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
  gates: Map<string, FaultGate>,
  digests: Map<string, Map<number, string>>,
  gone: Set<string>,
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
      event,
      authorityId,
      authorityTick,
      match,
      peers,
      gates,
      digests,
      gone,
      pause,
      resume
    );
  }
  for (const event of scenario.timeline) {
    if (event.op !== 'faults') continue;
    const gate = gates.get(event.peer);
    if (gate === undefined) continue;
    if (clock === event.from) gate.setFault(faultOf(event));
    if (clock === event.to) {
      gate.setFault(null);
      gate.retransmit();
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
  event: TimelineEvent,
  authorityId: string,
  authorityTick: () => number,
  match: ReturnType<SimDriver['createMatch']>,
  peers: Map<string, Peer>,
  gates: Map<string, FaultGate>,
  digests: Map<string, Map<number, string>>,
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
      gates,
      digests,
      gone
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
    const peer = peers.get(event.peer);
    if (peer === undefined || peer.tick() < 0) return;
    const bytes = peer.snapshot();
    const twin = match.createPeer(`rt-${String(event.at)}`, {
      role: 'replica',
    });
    try {
      twin.restore(bytes);
      if (twin.digest() !== peer.digest()) {
        throw new Error(
          `round-trip digest mismatch at tick ${String(event.at)}`
        );
      }
    } finally {
      twin.dispose();
    }
    return;
  }
  if (event.op === 'schemaChange') {
    const peer = peers.get(event.peer);
    if (peer === undefined || peer.tick() < 0) return;
    peer.restore(driver.incompatibleSnapshot(peer.snapshot()));
    return;
  }
  if (event.op === 'restoreSelf') {
    const peer = peers.get(event.peer);
    if (peer === undefined || peer.tick() < 0) return;
    const before = peer.digest();
    peer.restore(peer.snapshot());
    if (peer.digest() !== before) {
      throw new Error('restore changed the digest');
    }
    digests.get(peer.id)?.set(peer.tick(), peer.digest());
  }
}

async function reconnect(
  id: string,
  via: 'snapshot' | 'log',
  authorityId: string,
  authorityTick: number,
  match: ReturnType<SimDriver['createMatch']>,
  peers: Map<string, Peer>,
  gates: Map<string, FaultGate>,
  digests: Map<string, Map<number, string>>,
  gone: Set<string>
): Promise<void> {
  match.log();
  peers.get(id)?.dispose();
  const peer = match.createPeer(id, { role: 'replica' });
  peers.set(id, peer);
  gates.set(id, new FaultGate());
  const series = new Map<number, string>();
  digests.set(id, series);
  gone.delete(id);
  const log = match.log();
  if (via === 'snapshot') {
    const source = snapshotSource(peers, authorityId, id);
    // A snapshot needs a completed tick. Before that, the new peer is
    // already at tick -1, which matches the source.
    if (source.tick() < 0) return;
    peer.restore(source.snapshot());
    series.set(peer.tick(), peer.digest());
    return;
  }
  await catchUp(peer, log, authorityTick, series, -1);
}

async function flushGates(
  log: readonly LogEntry[],
  authorityTick: number,
  peers: Map<string, Peer>,
  gates: Map<string, FaultGate>,
  digests: Map<string, Map<number, string>>,
  gone: Set<string>
): Promise<void> {
  for (const gate of gates.values()) {
    gate.setFault(null);
    gate.retransmit();
  }
  for (const [id, peer] of peers) {
    if (gone.has(id)) continue;
    if (peer.tick() >= authorityTick) continue;
    const series = digests.get(id) ?? new Map<number, string>();
    digests.set(id, series);
    await catchUp(peer, log, authorityTick, series, peer.tick());
  }
}

async function syncReplicas(
  scenario: Scenario,
  clock: number,
  authority: Peer,
  log: readonly LogEntry[],
  peers: Map<string, Peer>,
  gates: Map<string, FaultGate>,
  digests: Map<string, Map<number, string>>,
  gone: Set<string>,
  offered: Map<string, number>
): Promise<void> {
  const fresh = log.filter((entry) => entry.tick === authority.tick());
  for (const [id, peer] of peers) {
    if (id === authority.id || gone.has(id)) continue;
    const gate = gates.get(id) ?? new FaultGate();
    gates.set(id, gate);
    const cursor = offered.get(id) ?? -1;
    if (authority.tick() > cursor) {
      const rng = prng(mix(scenario.seed, clock, id));
      for (const entry of fresh) gate.offer(authority.tick(), entry, rng);
      offered.set(id, authority.tick());
    }
    const through = Math.min(
      authority.tick(),
      gate.horizon(authority.tick()) - 1
    );
    if (through > peer.tick()) {
      const series = digests.get(id) ?? new Map<number, string>();
      digests.set(id, series);
      await catchUp(peer, log, through, series, peer.tick());
    }
    gate.releaseDue(authority.tick());
  }
}

async function catchUp(
  peer: Peer,
  log: readonly LogEntry[],
  through: number,
  series: Map<number, string>,
  after: number
): Promise<void> {
  let cursor = peer.tick();
  while (cursor < through) {
    if (peer.status() === 'ended' || peer.status() === 'failed') return;
    cursor += 1;
    const slice: LogEntry[] = [];
    for (const entry of log) if (entry.tick === cursor) slice.push(entry);
    await peer.fastForward(slice, cursor);
    if (cursor > after) series.set(cursor, peer.digest());
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
  gone: Set<string>
): Promise<void> {
  const reference = await referenceDigests(driver, spec, log, endTick);
  for (const [id, series] of digests) {
    if (id.startsWith('rt-')) continue;
    const tick = firstDivergingTick(series, reference);
    if (tick !== null) {
      const dumps = await dumpsAt(driver, scenario, spec, log, id, tick);
      throw simulationError(`peer ${id} diverged at tick ${String(tick)}`, {
        message: `peer ${id} diverged at tick ${String(tick)}`,
        tick,
        peerId: id,
        diffs: dumps === null ? [] : diffDumps(dumps.peer, dumps.reference),
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

async function referenceDigests(
  driver: SimDriver,
  spec: MatchSpec,
  log: readonly LogEntry[],
  through: number
): Promise<Map<number, string>> {
  const clean: MatchSpec = {
    ...spec,
    options: {
      ...spec.options,
      injectDesync: undefined,
      throwOnTick: undefined,
      throwBot: false,
    },
  };
  const match = driver.createMatch(clean);
  const series = new Map<number, string>();
  try {
    const peer = match.createPeer('reference', { role: 'replica' });
    await catchUp(peer, log, through, series, -1);
    return series;
  } finally {
    match.dispose();
  }
}

async function dumpsAt(
  driver: SimDriver,
  scenario: Scenario,
  spec: MatchSpec,
  log: readonly LogEntry[],
  peerId: string,
  tick: number
): Promise<{ peer: StateDump; reference: StateDump } | null> {
  const match = driver.createMatch(spec);
  const clean = driver.createMatch({
    ...spec,
    options: { ...spec.options, injectDesync: undefined, throwBot: false },
  });
  try {
    const peer = match.createPeer(peerId, {
      role: peerId === (scenario.peers[0] ?? 'A') ? 'authority' : 'replica',
    });
    const reference = clean.createPeer('reference', { role: 'replica' });
    await catchUp(peer, log, tick, new Map(), -1);
    await catchUp(reference, log, tick, new Map(), -1);
    if (peer.tick() < tick || reference.tick() < tick) return null;
    return { peer: peer.stateDump(), reference: reference.stateDump() };
  } catch {
    return null;
  } finally {
    match.dispose();
    clean.dispose();
  }
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
