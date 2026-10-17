import type { Scenario, TimelineEvent } from '../dsl/scenario.js';
import { scenario } from '../dsl/scenario.js';
import type { Prng } from '../util/prng.js';

/**
 * One random timeline. Events stay inside the tick range, a reconnect
 * follows a disconnect, and pause is paired with resume. The authority
 * peer is never crashed. Drops catch up from the log at the end of the
 * fault range (see FaultGate.retransmit).
 *
 * Three in ten timelines keep the first snapshot reconnect at or after
 * mid-match, or omit it. One further profile is only faults plus a
 * paired controller handoff, so a divergence cannot hide behind an
 * early restore.
 */
export function generateScenario(
  rng: Prng,
  seed: number,
  index: number
): Scenario {
  const ticks = 200 + rng.int(401);
  const peerCount = 2 + rng.int(2);
  const peers = ['A', 'B', 'C'].slice(0, peerCount);
  const profile = rng.int(10);
  const lateRestore = profile < 3;
  const faultsAndController = profile === 3;
  const tags = ['fuzz'];
  if (lateRestore || faultsAndController) tags.push('late-restore');
  if (faultsAndController) tags.push('faults-controller');
  const timeline: TimelineEvent[] = [];
  if (faultsAndController) {
    const from = rng.int(Math.max(1, ticks - 4));
    const to = Math.min(ticks - 1, from + 2 + rng.int(4));
    timeline.push({
      op: 'faults',
      from,
      to,
      peer: 'B',
      delay: [0, rng.int(3)],
      dup: 0,
      reorder: 0.1,
      drop: 0,
    });
    pushHandoff(timeline, rng, ticks);
    timeline.sort((left, right) => eventAt(left) - eventAt(right));
    return scenario(`fuzz-${String(seed)}-${String(index)}`, {
      suite: 'fuzz',
      tags,
      seed: (seed + index) >>> 0,
      ticks,
      slots: ['human', 'bot:aggressive'],
      peers,
      timeline,
      inputs: 'scripted:basic',
      expect: { converge: true },
    });
  }
  let gone = false;
  let paused = false;
  let injected = false;
  let handed = false;
  /** Clock of the latest disconnect or reconnect. The next one is later. */
  let linkAt = -1;
  const budget = 3 + rng.int(6);
  const mid = Math.floor(ticks / 2);
  for (let count = 0; count < budget; count += 1) {
    const kind = rng.int(6);
    if (kind === 5 && !injected) {
      const at = 1 + rng.int(Math.max(1, ticks - 2));
      timeline.push({ at, op: 'inject', peer: 'A', when: 'tick' });
      injected = true;
      continue;
    }
    if (kind === 0 && !gone) {
      const at = clockAfter(rng, linkAt, ticks - 1);
      if (at === null) continue;
      timeline.push({ at, op: 'disconnect', peer: 'B' });
      linkAt = at;
      gone = true;
      continue;
    }
    if (kind === 1 && gone) {
      const via = rng.int(2) === 0 ? 'snapshot' : 'log';
      const earliest = Math.max(linkAt, via === 'snapshot' ? 0 : -1);
      let at = clockAfter(rng, earliest, ticks - 1);
      if (at === null) continue;
      if (lateRestore && via === 'snapshot' && at < mid) {
        if (mid <= linkAt || mid > ticks - 1) continue;
        at = mid;
      }
      timeline.push({
        at,
        op: 'reconnect',
        peer: 'B',
        via,
      });
      linkAt = at;
      gone = false;
      continue;
    }
    if (kind === 2 && !paused) {
      const at = 1 + rng.int(Math.max(1, ticks - 2));
      const resumeAt = Math.min(ticks - 1, at + 1 + rng.int(2));
      timeline.push({ at, op: 'pause' });
      timeline.push({ at: resumeAt, op: 'resume' });
      paused = true;
      continue;
    }
    if (kind === 3) {
      const from = rng.int(Math.max(1, ticks - 2));
      const to = Math.min(ticks - 1, from + 1 + rng.int(3));
      timeline.push({
        op: 'faults',
        from,
        to,
        peer: 'B',
        delay: [0, rng.int(3)],
        dup: rng.int(2) === 0 ? 0 : 0.05,
        reorder: 0.1,
        drop: rng.int(2) === 0 ? 0 : 0.05,
      });
      continue;
    }
    if (kind === 4 && !handed) {
      pushHandoff(timeline, rng, ticks);
      handed = true;
      continue;
    }
    const at = 1 + rng.int(Math.max(1, ticks - 1));
    timeline.push({ at, op: 'malformed', peer: 'A' });
  }
  timeline.sort((left, right) => eventAt(left) - eventAt(right));
  return scenario(`fuzz-${String(seed)}-${String(index)}`, {
    suite: 'fuzz',
    tags,
    seed: (seed + index) >>> 0,
    ticks,
    slots: ['human', 'bot:aggressive'],
    peers,
    timeline,
    inputs: 'scripted:basic',
    expect: injected ? { diverges: true } : { converge: true },
  });
}

/**
 * A timeline that must diverge. Eighteen events, so a shrink down to
 * five is not a no-op. Only the inject changes the oracle result.
 * No snapshot reconnect, so the desync is not masked by an early restore.
 */
export function injectScenario(seed: number): Scenario {
  const timeline: TimelineEvent[] = [
    { at: 4, op: 'inject', peer: 'A', when: 'tick' },
  ];
  for (let index = 0; index < 17; index += 1) {
    timeline.push({
      at: index % 12,
      op: 'malformed',
      peer: index % 2 === 0 ? 'A' : 'B',
    });
  }
  return scenario('inject-desync', {
    suite: 'fuzz',
    tags: ['fuzz', 'inject', 'late-restore'],
    seed,
    ticks: 16,
    slots: ['human', 'bot:aggressive'],
    peers: ['A', 'B'],
    timeline,
    inputs: 'scripted:basic',
    expect: { diverges: true },
  });
}

/** First snapshot reconnect clock, or null when the timeline has none. */
export function firstSnapshotReconnect(
  timeline: readonly TimelineEvent[]
): number | null {
  let found: number | null = null;
  for (const event of timeline) {
    if (event.op !== 'reconnect' || event.via !== 'snapshot') continue;
    if (found === null || event.at < found) found = event.at;
  }
  return found;
}

/** Inclusive clock in `(after, latest]`, or null when that range is empty. */
function clockAfter(rng: Prng, after: number, latest: number): number | null {
  const earliest = after + 1;
  if (earliest > latest) return null;
  return earliest + rng.int(latest - earliest + 1);
}

function pushHandoff(
  timeline: TimelineEvent[],
  rng: Prng,
  ticks: number
): void {
  const at = 1 + rng.int(Math.max(1, ticks - 3));
  const back = Math.min(ticks - 1, at + 2);
  timeline.push({
    at,
    op: 'replaceWithBot',
    peer: 'A',
    policy: rng.int(2) === 0 ? 'defensive' : 'aggressive',
    slot: 0,
  });
  if (back > at) {
    timeline.push({ at: back, op: 'returnFromBot', peer: 'A', slot: 0 });
  }
}

function eventAt(event: TimelineEvent): number {
  if ('at' in event) return event.at;
  if (event.op === 'faults') return event.from;
  return 0;
}
