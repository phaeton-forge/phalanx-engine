import type { LogEntry } from '../runner/CommandLog.js';
import type { LoadedMatch, MatchConfig } from './MatchStore.js';

/** How many snapshots a store keeps. Older ones are dropped. */
export const RETAINED_SNAPSHOTS = 2;

export interface StoredSnapshot {
  tick: number;
  bytes: Uint8Array;
}

export interface StoredMatch {
  config: MatchConfig | null;
  cursor: number;
  commands: LogEntry[];
  snapshots: StoredSnapshot[];
}

export function emptyMatch(): StoredMatch {
  return { config: null, cursor: -1, commands: [], snapshots: [] };
}

/** Replace the config only. A fresh match clears the row before this runs. */
export function applyHeader(row: StoredMatch, config: MatchConfig): void {
  row.config = cloneMatchConfig(config);
}

export function applyCommands(
  row: StoredMatch,
  entries: readonly LogEntry[],
  cursorTick: number | undefined
): void {
  const seen = new Set(row.commands.map(entryKey));
  const oldest = row.snapshots[0];
  const applied = collectNewEntries(
    entries,
    row.cursor,
    cursorTick,
    oldest?.tick,
    seen
  );
  for (const entry of applied.kept) row.commands.push(entry);
  row.cursor = applied.cursor;
}

/** Record keys already stored so a later batch can skip them. */
export function rememberEntries(
  entries: readonly LogEntry[],
  seen: Set<string>
): void {
  for (const entry of entries) seen.add(entryKey(entry));
}

/**
 * Commands from one batch that are not already in `seen` and are newer than
 * the oldest snapshot. `seen` gains the kept keys. Shared by the in-memory
 * row and the IndexedDB chunk writer so both stores dedup the same way.
 */
export function collectNewEntries(
  entries: readonly LogEntry[],
  cursor: number,
  cursorTick: number | undefined,
  oldestTick: number | undefined,
  seen: Set<string>
): { kept: LogEntry[]; cursor: number } {
  assertCursorTick(cursorTick);
  let next = cursor;
  if (cursorTick !== undefined) next = Math.max(next, cursorTick);
  const kept: LogEntry[] = [];
  for (const entry of entries) {
    if (oldestTick !== undefined && entry.tick <= oldestTick) continue;
    next = Math.max(next, entry.tick);
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(cloneEntry(entry));
  }
  return { kept, cursor: next };
}

/**
 * True when any entry might already be stored. A batch whose ticks are all
 * past `maxEntryTick` cannot contain a duplicate.
 */
export function commandBatchOverlaps(
  entries: readonly LogEntry[],
  maxEntryTick: number
): boolean {
  for (const entry of entries) {
    if (entry.tick <= maxEntryTick) return true;
  }
  return false;
}

/** Lowest tick in the batch, or null when the batch is empty. */
export function lowestEntryTick(entries: readonly LogEntry[]): number | null {
  let min: number | null = null;
  for (const entry of entries) {
    if (min === null || entry.tick < min) min = entry.tick;
  }
  return min;
}

/** Bounds of the entries actually stored in one chunk. */
export function chunkBounds(entries: readonly LogEntry[]): {
  firstTick: number;
  lastTick: number;
} {
  const first = entries[0];
  if (first === undefined) {
    throw new Error('MatchStore: a command chunk needs at least one entry');
  }
  let firstTick = first.tick;
  let lastTick = first.tick;
  for (const entry of entries) {
    if (entry.tick < firstTick) firstTick = entry.tick;
    if (entry.tick > lastTick) lastTick = entry.tick;
  }
  return { firstTick, lastTick };
}

/**
 * Snapshot ticks after storing `tick`, oldest first, capped at
 * {@link RETAINED_SNAPSHOTS}. A repeated tick replaces and drops nothing.
 */
export function planSnapshotTicks(
  ticks: readonly number[],
  tick: number
): { ticks: number[]; dropped: number[] } {
  if (ticks.includes(tick)) return { ticks: [...ticks], dropped: [] };
  const next = [...ticks, tick].sort((left, right) => left - right);
  const dropped: number[] = [];
  while (next.length > RETAINED_SNAPSHOTS) {
    const removed = next.shift();
    if (removed !== undefined) dropped.push(removed);
  }
  return { ticks: next, dropped };
}

export function assertCursorTick(cursorTick: number | undefined): void {
  if (
    cursorTick !== undefined &&
    (!Number.isInteger(cursorTick) || cursorTick < -1)
  ) {
    throw new Error(
      `MatchStore: cursorTick must be an integer >= -1, got ${String(cursorTick)}`
    );
  }
}

export function assertSnapshotInput(tick: number, bytes: Uint8Array): void {
  if (!Number.isInteger(tick) || tick < 0) {
    throw new Error(
      `MatchStore: snapshot tick must be an integer >= 0, got ${String(tick)}`
    );
  }
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('MatchStore: snapshot bytes must be a Uint8Array');
  }
}

/** Keep the newest two snapshots. Commands covered by every remaining one drop. */
export function applySnapshot(
  row: StoredMatch,
  tick: number,
  bytes: Uint8Array
): void {
  assertSnapshotInput(tick, bytes);
  const existing = row.snapshots.findIndex((snap) => snap.tick === tick);
  if (existing >= 0) {
    const prior = row.snapshots[existing];
    if (prior !== undefined) prior.bytes = bytes;
  } else {
    row.snapshots.push({ tick, bytes });
  }
  row.snapshots.sort((left, right) => left.tick - right.tick);
  while (row.snapshots.length > RETAINED_SNAPSHOTS) row.snapshots.shift();
  const oldest = row.snapshots[0];
  if (oldest !== undefined) {
    row.commands = row.commands.filter((entry) => entry.tick > oldest.tick);
  }
  if (tick > row.cursor) row.cursor = tick;
}

export function toLoaded(row: StoredMatch): LoadedMatch | null {
  if (row.config === null) return null;
  const newest = row.snapshots[row.snapshots.length - 1];
  const older =
    row.snapshots.length >= 2
      ? row.snapshots[row.snapshots.length - 2]
      : undefined;
  const loaded: LoadedMatch = {
    config: row.config,
    tail: entriesAfter(row.commands, newest?.tick),
    tick: row.cursor,
  };
  if (newest === undefined) return loaded;
  const withNewest: LoadedMatch = {
    ...loaded,
    snapshot: { tick: newest.tick, bytes: newest.bytes },
  };
  if (older === undefined) return withNewest;
  return {
    ...withNewest,
    previous: {
      snapshot: { tick: older.tick, bytes: older.bytes },
      tail: entriesAfter(row.commands, older.tick),
    },
  };
}

export function entriesAfter(
  commands: readonly LogEntry[],
  tick: number | undefined
): LogEntry[] {
  const after = tick === undefined ? -1 : tick;
  const tail: LogEntry[] = [];
  for (const entry of commands) {
    if (entry.tick > after) tail.push(entry);
  }
  return tail;
}

/** Drop one snapshot. Commands and the cursor stay. A missing tick is a no-op. */
export function deleteStoredSnapshot(row: StoredMatch, tick: number): void {
  const index = row.snapshots.findIndex((snap) => snap.tick === tick);
  if (index < 0) return;
  row.snapshots.splice(index, 1);
}

export function snapshotTicksOf(row: StoredMatch): number[] {
  return row.snapshots.map((snap) => snap.tick);
}

export function assertMatchId(matchId: string): void {
  if (typeof matchId !== 'string' || matchId.length === 0) {
    throw new Error('MatchStore: matchId must be a non-empty string');
  }
}

function cloneMatchConfig(config: MatchConfig): MatchConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(JSON.stringify(config));
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'stringify failed';
    throw new Error(`MatchStore: config must be JSON-safe (${detail})`);
  }
  if (!isMatchConfig(parsed)) {
    throw new Error('MatchStore: config must be a match config');
  }
  return parsed;
}

function isMatchConfig(value: unknown): value is MatchConfig {
  if (!isRecord(value)) return false;
  return (
    typeof value['matchId'] === 'string' &&
    typeof value['gameId'] === 'string' &&
    typeof value['simVersion'] === 'string' &&
    typeof value['seed'] === 'number' &&
    (value['side'] === 'client' || value['side'] === 'server') &&
    Array.isArray(value['slots']) &&
    typeof value['inputDelayTicks'] === 'number'
  );
}

function cloneEntry(entry: LogEntry): LogEntry {
  const copy: LogEntry = {
    tick: entry.tick,
    playerId: entry.playerId,
    type: entry.type,
    data: { q: entry.data.q, p: entry.data.p },
  };
  if (entry.malformed === true) return { ...copy, malformed: true };
  return copy;
}

/**
 * Identity of one logged command. A malformed envelope is stored as `q: 0`,
 * which is also the player's first real command, so the key includes
 * `malformed` and the payload. Object key order is not part of the identity.
 * Two copies of the same command still collapse.
 */
function entryKey(entry: LogEntry): string {
  const malformed = entry.malformed === true ? '1' : '0';
  return `${String(entry.tick)}\0${entry.playerId}\0${String(entry.data.q)}\0${entry.type}\0${malformed}\0${payloadKey(entry.data.p)}`;
}

function payloadKey(value: unknown): string {
  try {
    const encoded = JSON.stringify(canonicalJson(value));
    return encoded === undefined ? '' : encoded;
  } catch {
    return '';
  }
}

/** Sort object keys so `{a,b}` and `{b,a}` dedupe. Arrays keep their order. */
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = canonicalJson(value[key]);
  }
  return sorted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
