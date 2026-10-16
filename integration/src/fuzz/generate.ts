import type { Scenario, TimelineEvent } from '../dsl/scenario.js';
import { scenario } from '../dsl/scenario.js';
import type { Prng } from '../util/prng.js';

/**
 * One random timeline. Events stay inside the tick range, a reconnect
 * follows a disconnect, and pause is paired with resume. The authority
 * peer is never crashed. Drops catch up from the log at the end of the
 * fault range (see FaultGate.retransmit).
 */
export function generateScenario(
  rng: Prng,
  seed: number,
  index: number
): Scenario {
  const ticks = 200 + rng.int(401);
  const peerCount = 2 + rng.int(2);
  const peers = ['A', 'B', 'C'].slice(0, peerCount);
  const timeline: TimelineEvent[] = [];
  let gone = false;
  let paused = false;
  let injected = false;
  const budget = 3 + rng.int(6);
  for (let count = 0; count < budget; count += 1) {
    const kind = rng.int(6);
    if (kind === 5 && !injected) {
      const at = 1 + rng.int(Math.max(1, ticks - 2));
      timeline.push({ at, op: 'inject', peer: 'A', when: 'tick' });
      injected = true;
      continue;
    }
    if (kind === 0 && !gone) {
      const at = rng.int(Math.max(1, ticks - 3));
      timeline.push({ at, op: 'disconnect', peer: 'B' });
      gone = true;
      continue;
    }
    if (kind === 1 && gone) {
      const via = rng.int(2) === 0 ? 'snapshot' : 'log';
      // Snapshot restore needs a completed tick, so it cannot be clock 0.
      const at =
        via === 'snapshot'
          ? 1 + rng.int(Math.max(1, ticks - 1))
          : rng.int(ticks);
      timeline.push({
        at,
        op: 'reconnect',
        peer: 'B',
        via,
      });
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
    const at = 1 + rng.int(Math.max(1, ticks - 1));
    timeline.push({ at, op: 'malformed', peer: 'A' });
  }
  timeline.sort((left, right) => eventAt(left) - eventAt(right));
  return scenario(`fuzz-${String(seed)}-${String(index)}`, {
    suite: 'fuzz',
    tags: ['fuzz'],
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
    tags: ['fuzz', 'inject'],
    seed,
    ticks: 16,
    slots: ['human', 'bot:aggressive'],
    peers: ['A', 'B'],
    timeline,
    inputs: 'scripted:basic',
    expect: { diverges: true },
  });
}

function eventAt(event: TimelineEvent): number {
  if ('at' in event) return event.at;
  if (event.op === 'faults') return event.from;
  return 0;
}
