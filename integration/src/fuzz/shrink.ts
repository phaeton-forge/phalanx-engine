import { slotOfPeer } from '../dsl/interpret.js';
import type { Scenario, TimelineEvent } from '../dsl/scenario.js';
import { errorMessage } from '../util/json.js';

export type Fails = (scenario: Scenario) => Promise<boolean>;

/** Failure class plus the first diverging tick, when the message has one. */
export interface FailureSignature {
  readonly type: string;
  readonly tick: number | null;
}

export function failureSignature(error: unknown): FailureSignature {
  const message = errorMessage(error);
  const tick = tickOf(message);
  if (message.includes('diverged')) return { type: 'diverged', tick };
  if (message.includes('round-trip') || message.includes('restore changed')) {
    return { type: 'round-trip', tick };
  }
  if (message.startsWith('setController rejected')) {
    return { type: message, tick };
  }
  const type = message.split(':')[0] ?? message;
  return { type, tick };
}

export function sameFailureSignature(
  error: unknown,
  original: unknown
): boolean {
  const left = failureSignature(error);
  const right = failureSignature(original);
  return left.type === right.type && left.tick === right.tick;
}

function tickOf(message: string): number | null {
  const match = /at tick (\d+)/.exec(message);
  if (match?.[1] === undefined) return null;
  const tick = Number(match[1]);
  return Number.isInteger(tick) ? tick : null;
}

/**
 * Delta-debug events, then narrow ticks, peers, slots and event ranges.
 * The predicate decides what still counts as the same failure.
 * Deterministic: candidates are tried in a fixed order.
 */
export async function shrinkScenario(
  scenario: Scenario,
  fails: Fails
): Promise<Scenario> {
  let current = scenario;
  current = await shrinkEvents(current, fails);
  current = await shrinkTicks(current, fails);
  current = await shrinkPeers(current, fails);
  current = await shrinkSlots(current, fails);
  current = await shrinkRanges(current, fails);
  return current;
}

async function shrinkEvents(
  scenario: Scenario,
  fails: Fails
): Promise<Scenario> {
  let events = [...scenario.timeline];
  let granularity = 2;
  while (events.length >= 2) {
    const chunks = split(events, granularity);
    let reduced = false;
    for (const chunk of chunks) {
      const trial = dropEvents(events, chunk);
      if (trial.length === events.length) continue;
      if (await fails(withTimeline(scenario, trial))) {
        events = trial;
        granularity = Math.max(2, granularity - 1);
        reduced = true;
        break;
      }
    }
    if (reduced) continue;
    for (const chunk of chunks) {
      if (chunk.length === 0 || chunk.length === events.length) continue;
      const kept = keepEvents(events, chunk);
      if (kept.length === events.length) continue;
      if (await fails(withTimeline(scenario, kept))) {
        events = kept;
        granularity = 2;
        reduced = true;
        break;
      }
    }
    if (reduced) continue;
    if (granularity >= events.length) break;
    granularity = Math.min(events.length, granularity * 2);
  }
  return withTimeline(scenario, events);
}

async function shrinkTicks(
  scenario: Scenario,
  fails: Fails
): Promise<Scenario> {
  let best = scenario;
  let low = 1;
  let high = scenario.ticks - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const trial = { ...best, ticks: mid };
    if (await fails(trial)) {
      best = trial;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return best;
}

async function shrinkPeers(
  scenario: Scenario,
  fails: Fails
): Promise<Scenario> {
  let best = scenario;
  while (best.peers.length > 1) {
    const trial = { ...best, peers: best.peers.slice(0, -1) };
    if (!(await fails(trial))) break;
    best = trial;
  }
  return best;
}

async function shrinkSlots(
  scenario: Scenario,
  fails: Fails
): Promise<Scenario> {
  let best = scenario;
  while (best.slots.length > 1) {
    const trial = { ...best, slots: best.slots.slice(0, -1) };
    if (!(await fails(trial))) break;
    best = trial;
  }
  return best;
}

async function shrinkRanges(
  scenario: Scenario,
  fails: Fails
): Promise<Scenario> {
  let events = [...scenario.timeline];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined) continue;
    // `at` moves one event at a time. A handoff is removed only as a pair
    // (see dropEvents). The caller must reject a different failure.
    if ('at' in event) {
      let at = event.at;
      while (at > 0) {
        const next = replace(events, index, { ...event, at: at - 1 });
        if (!(await fails(withTimeline(scenario, next)))) break;
        events = next;
        at -= 1;
      }
    }
    if (event.op === 'faults') {
      let from = event.from;
      let to = event.to;
      while (from + 1 <= to) {
        const next = replace(events, index, { ...event, from: from + 1 });
        if (!(await fails(withTimeline(scenario, next)))) break;
        events = next;
        from += 1;
      }
      while (to - 1 >= from) {
        const next = replace(events, index, { ...event, to: to - 1 });
        if (!(await fails(withTimeline(scenario, next)))) break;
        events = next;
        to -= 1;
      }
    }
  }
  return withTimeline(scenario, events);
}

function withTimeline(
  scenario: Scenario,
  timeline: readonly TimelineEvent[]
): Scenario {
  return { ...scenario, timeline };
}

function replace(
  events: readonly TimelineEvent[],
  index: number,
  event: TimelineEvent
): TimelineEvent[] {
  const next = [...events];
  next[index] = event;
  return next;
}

function dropEvents(
  events: readonly TimelineEvent[],
  chunk: readonly TimelineEvent[]
): TimelineEvent[] {
  const drop = paired(events, chunk);
  return events.filter((event) => !drop.has(event));
}

function keepEvents(
  events: readonly TimelineEvent[],
  chunk: readonly TimelineEvent[]
): TimelineEvent[] {
  const keep = paired(events, chunk);
  return events.filter((event) => keep.has(event));
}

/** A replace and its return leave or stay together. */
function paired(
  events: readonly TimelineEvent[],
  chosen: readonly TimelineEvent[]
): Set<TimelineEvent> {
  const set = new Set<TimelineEvent>(chosen);
  for (const event of chosen) {
    const partner = handoffPartner(events, event);
    if (partner !== undefined) set.add(partner);
  }
  return set;
}

function handoffPartner(
  events: readonly TimelineEvent[],
  event: TimelineEvent
): TimelineEvent | undefined {
  if (event.op === 'replaceWithBot') {
    return events.find(
      (other) =>
        other.op === 'returnFromBot' &&
        other.peer === event.peer &&
        handoffSlot(other) === handoffSlot(event) &&
        other.at >= event.at
    );
  }
  if (event.op === 'returnFromBot') {
    let found: TimelineEvent | undefined;
    for (const other of events) {
      if (other.op !== 'replaceWithBot') continue;
      if (
        other.peer !== event.peer ||
        handoffSlot(other) !== handoffSlot(event)
      ) {
        continue;
      }
      if (other.at <= event.at) found = other;
    }
    return found;
  }
  return undefined;
}

function handoffSlot(event: TimelineEvent): number {
  if (event.op !== 'replaceWithBot' && event.op !== 'returnFromBot') return -1;
  return event.slot ?? slotOfPeer(event.peer);
}

function split<T>(items: readonly T[], parts: number): T[][] {
  const size = Math.max(1, Math.ceil(items.length / parts));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
