import type { Scenario, TimelineEvent } from '../dsl/scenario.js';

export type Fails = (scenario: Scenario) => Promise<boolean>;

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
      const trial = without(events, chunk);
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
      if (await fails(withTimeline(scenario, chunk))) {
        events = chunk;
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

function without<T>(items: readonly T[], chunk: readonly T[]): T[] {
  const drop = new Set<T>(chunk);
  return items.filter((item) => !drop.has(item));
}

function split<T>(items: readonly T[], parts: number): T[][] {
  const size = Math.max(1, Math.ceil(items.length / parts));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
