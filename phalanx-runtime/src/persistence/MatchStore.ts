import type { MatchConfigBase } from '../game/MatchConfig.js';
import type { LogEntry } from '../runner/CommandLog.js';

/**
 * JSON-safe match config persisted for a local match. Game fields beyond
 * {@link MatchConfigBase} round-trip with the header.
 */
export type MatchConfig = MatchConfigBase;

export interface MatchSnapshotRecord {
  readonly tick: number;
  readonly bytes: Uint8Array;
}

/**
 * A match loaded for resume. `tick` is the highest completed tick, including
 * ticks that logged no commands. `tail` is the commands strictly after the
 * newest snapshot, or the whole log when no snapshot has been stored.
 */
export interface LoadedMatch {
  readonly config: MatchConfig;
  readonly snapshot?: MatchSnapshotRecord;
  readonly tail: readonly LogEntry[];
  readonly tick: number;
}

/**
 * Offline log of one local match. Callers batch writes. `saveSnapshot`
 * keeps the last two snapshots and drops older ones.
 */
export interface MatchStore {
  /**
   * Replace the stored config. Does not clear commands, snapshots, or the
   * cursor. The runner clears a reused match id once before the first write.
   */
  saveHeader(matchId: string, config: MatchConfig): Promise<void>;
  /**
   * Append command entries. `cursorTick` is the highest completed tick,
   * including empty ticks, so resume can fast-forward past the last command.
   * When omitted, the cursor advances to the highest entry tick.
   */
  appendCommands(
    matchId: string,
    entries: readonly LogEntry[],
    cursorTick?: number
  ): Promise<void>;
  /** Keep the last two snapshots. A repeated tick replaces that snapshot. */
  saveSnapshot(matchId: string, tick: number, bytes: Uint8Array): Promise<void>;
  load(matchId: string): Promise<LoadedMatch | null>;
  clear(matchId: string): Promise<void>;
}
