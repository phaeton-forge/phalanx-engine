import type { LogEntry } from '../runner/CommandLog.js';
import type { LoadedMatch, MatchConfig } from './MatchStore.js';

const RETAINED_SNAPSHOTS = 2;

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

export function applyHeader(row: StoredMatch, config: MatchConfig): void {
  row.config = cloneMatchConfig(config);
}

export function applyCommands(
  row: StoredMatch,
  entries: readonly LogEntry[],
  cursorTick: number | undefined
): void {
  if (
    cursorTick !== undefined &&
    (!Number.isInteger(cursorTick) || cursorTick < -1)
  ) {
    throw new Error(
      `MatchStore: cursorTick must be an integer >= -1, got ${String(cursorTick)}`
    );
  }
  let cursor = row.cursor;
  if (cursorTick !== undefined) cursor = Math.max(cursor, cursorTick);
  const seen = new Set(row.commands.map(entryKey));
  const oldest = row.snapshots[0];
  for (const entry of entries) {
    if (oldest !== undefined && entry.tick <= oldest.tick) continue;
    cursor = Math.max(cursor, entry.tick);
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    row.commands.push(cloneEntry(entry));
  }
  row.cursor = cursor;
}

/** Keep the newest two snapshots. Commands covered by every remaining one drop. */
export function applySnapshot(
  row: StoredMatch,
  tick: number,
  bytes: Uint8Array
): void {
  if (!Number.isInteger(tick) || tick < 0) {
    throw new Error(
      `MatchStore: snapshot tick must be an integer >= 0, got ${String(tick)}`
    );
  }
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('MatchStore: snapshot bytes must be a Uint8Array');
  }
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
  const after = newest === undefined ? -1 : newest.tick;
  const tail: LogEntry[] = [];
  for (const entry of row.commands) {
    if (entry.tick > after) tail.push(entry);
  }
  const loaded: LoadedMatch = {
    config: row.config,
    tail,
    tick: row.cursor,
  };
  if (newest === undefined) return loaded;
  return {
    ...loaded,
    snapshot: { tick: newest.tick, bytes: newest.bytes },
  };
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
 * `malformed` and the payload. Two copies of the same command still collapse.
 */
function entryKey(entry: LogEntry): string {
  const malformed = entry.malformed === true ? '1' : '0';
  return `${String(entry.tick)}\0${entry.playerId}\0${String(entry.data.q)}\0${entry.type}\0${malformed}\0${payloadKey(entry.data.p)}`;
}

function payloadKey(value: unknown): string {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? '' : encoded;
  } catch {
    return '';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
