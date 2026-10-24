import type { GameSystem } from './GameSystem.js';

/**
 * Tick phases, in execution order.
 *
 * `physics` is before `abilities` so a tick's contacts and integrated
 * positions are visible to ability systems. Games that must run first use
 * `input`; games that must see ability results use `late`.
 */
export const TICK_PHASES = ['input', 'physics', 'abilities', 'late'] as const;

/**
 * Frame phases, in execution order. Interpolation samples, then render
 * systems, then later presentation.
 */
export const FRAME_PHASES = ['interpolation', 'render', 'present'] as const;

export type TickPhase = (typeof TICK_PHASES)[number];
export type FramePhase = (typeof FRAME_PHASES)[number];
export type SystemPhase = TickPhase | FramePhase;

/** Where a system runs. `before` / `after` name other systems in that phase. */
export interface AddSystemOptions {
  readonly phase: SystemPhase;
  /** Run this system before these systems. One name or several. */
  readonly before?: string | readonly string[];
  /** Run this system after these systems. One name or several. */
  readonly after?: string | readonly string[];
}

/** System names in execution order. Tick names are folded into `configHash`. */
export interface SystemOrder {
  readonly tick: readonly string[];
  readonly frame: readonly string[];
}

export interface SystemEntry {
  readonly system: GameSystem;
  readonly phase: SystemPhase;
  readonly before: readonly string[];
  readonly after: readonly string[];
  readonly index: number;
}

const TICK_SET: ReadonlySet<string> = new Set(TICK_PHASES);
const FRAME_SET: ReadonlySet<string> = new Set(FRAME_PHASES);

export function laneOf(phase: string): 'tick' | 'frame' {
  if (TICK_SET.has(phase)) return 'tick';
  if (FRAME_SET.has(phase)) return 'frame';
  throw new Error(
    `world.addSystem: unknown phase '${phase}' (tick: ${TICK_PHASES.join(', ')}; frame: ${FRAME_PHASES.join(', ')})`
  );
}

export function constraintNames(
  value: string | readonly string[] | undefined
): readonly string[] {
  if (value === undefined) return [];
  if (typeof value === 'string') return [value];
  return value;
}

export function orderedSystems(
  entries: readonly SystemEntry[],
  where: string
): {
  readonly tick: GameSystem[];
  readonly frame: GameSystem[];
} {
  const all = new Map<string, SystemEntry>();
  for (const entry of entries) all.set(entry.system.name, entry);
  return {
    tick: orderLane(
      entries.filter((entry) => laneOf(entry.phase) === 'tick'),
      TICK_PHASES,
      all,
      where
    ),
    frame: orderLane(
      entries.filter((entry) => laneOf(entry.phase) === 'frame'),
      FRAME_PHASES,
      all,
      where
    ),
  };
}

function orderLane(
  entries: readonly SystemEntry[],
  phases: readonly string[],
  all: ReadonlyMap<string, SystemEntry>,
  where: string
): GameSystem[] {
  const ordered: GameSystem[] = [];
  for (const phase of phases) {
    const group = entries.filter((entry) => entry.phase === phase);
    for (const system of sortPhase(phase, group, all, where)) {
      ordered.push(system);
    }
  }
  return ordered;
}

function sortPhase(
  phase: string,
  group: readonly SystemEntry[],
  all: ReadonlyMap<string, SystemEntry>,
  where: string
): GameSystem[] {
  const local = new Map<string, SystemEntry>();
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const entry of group) {
    local.set(entry.system.name, entry);
    outgoing.set(entry.system.name, []);
    indegree.set(entry.system.name, 0);
  }

  const addEdge = (from: string, to: string): void => {
    const list = outgoing.get(from);
    if (list === undefined || list.includes(to)) return;
    list.push(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  };

  for (const entry of group) {
    for (const name of entry.before) {
      addEdge(
        entry.system.name,
        requireTarget(entry, name, 'before', phase, all, where)
      );
    }
    for (const name of entry.after) {
      addEdge(
        requireTarget(entry, name, 'after', phase, all, where),
        entry.system.name
      );
    }
  }

  const ready = group.filter((entry) => indegree.get(entry.system.name) === 0);
  const result: GameSystem[] = [];
  const left = new Set(group.map((entry) => entry.system.name));
  while (ready.length > 0) {
    ready.sort((leftEntry, rightEntry) => leftEntry.index - rightEntry.index);
    const next = ready.shift();
    if (next === undefined) break;
    result.push(next.system);
    left.delete(next.system.name);
    for (const to of outgoing.get(next.system.name) ?? []) {
      const degree = (indegree.get(to) ?? 1) - 1;
      indegree.set(to, degree);
      if (degree === 0) {
        const entry = local.get(to);
        if (entry !== undefined) ready.push(entry);
      }
    }
  }
  if (left.size > 0) {
    throw new Error(cycleMessage(where, phase, left, outgoing));
  }
  return result;
}

function requireTarget(
  entry: SystemEntry,
  name: string,
  kind: 'before' | 'after',
  phase: string,
  all: ReadonlyMap<string, SystemEntry>,
  where: string
): string {
  const target = all.get(name);
  if (target === undefined) {
    throw new Error(
      `${where}: system '${entry.system.name}' is ${kind} unknown system '${name}'`
    );
  }
  if (laneOf(target.phase) !== laneOf(phase)) {
    throw new Error(
      `${where}: system '${entry.system.name}' is ${kind} '${name}', which is a ${laneOf(target.phase)} system`
    );
  }
  if (target.phase !== phase) {
    throw new Error(
      `${where}: system '${entry.system.name}' is ${kind} '${name}', which is in phase '${target.phase}' not '${phase}'`
    );
  }
  return target.system.name;
}

function cycleMessage(
  where: string,
  phase: string,
  left: ReadonlySet<string>,
  outgoing: ReadonlyMap<string, readonly string[]>
): string {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  let found: readonly string[] | undefined;
  const visit = (name: string): void => {
    if (found !== undefined || visited.has(name)) return;
    if (visiting.has(name)) {
      const start = stack.indexOf(name);
      found = [...stack.slice(start), name];
      return;
    }
    visiting.add(name);
    stack.push(name);
    for (const next of outgoing.get(name) ?? []) visit(next);
    stack.pop();
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of left) visit(name);
  const path = found !== undefined ? found.join(' → ') : [...left].join(', ');
  return `${where}: system order cycle in phase '${phase}': ${path}`;
}
