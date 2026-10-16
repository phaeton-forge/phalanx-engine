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
  const ticks = 8 + rng.int(5);
  const peers = ['A', 'B'];
  const timeline: TimelineEvent[] = [];
  let gone = false;
  let paused = false;
  const budget = 1 + rng.int(4);
  for (let count = 0; count < budget; count += 1) {
    const kind = rng.int(5);
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
    expect: { converge: true },
  });
}

/** A timeline that must diverge: +1 hp on peer A after a few ticks. */
export function injectScenario(seed: number): Scenario {
  return scenario('inject-desync', {
    suite: 'fuzz',
    tags: ['fuzz', 'inject'],
    seed,
    ticks: 12,
    slots: ['human', 'bot:aggressive'],
    peers: ['A', 'B'],
    timeline: [
      { at: 2, op: 'disconnect', peer: 'B' },
      { at: 4, op: 'inject', peer: 'A', when: 'tick' },
      {
        op: 'faults',
        from: 3,
        to: 7,
        peer: 'B',
        delay: [0, 2],
        dup: 0,
        reorder: 0,
        drop: 0,
      },
      { at: 6, op: 'reconnect', peer: 'B', via: 'snapshot' },
      { at: 8, op: 'malformed', peer: 'A' },
    ],
    inputs: 'scripted:basic',
    expect: { converge: true },
  });
}

function eventAt(event: TimelineEvent): number {
  if ('at' in event) return event.at;
  if (event.op === 'faults') return event.from;
  return 0;
}
