import type { CommandEnvelope } from '../game/commands.js';
import { notImplemented } from '../notImplemented.js';

/**
 * One command exactly as the runner received it in a tick batch. The log
 * stores raw wire entries, not decoded commands: replay and catch-up re-run
 * `decode`/`validate` inside the tick, so rejected entries stay in the log
 * and are rejected again deterministically.
 */
export interface LogEntry {
  readonly tick: number;
  /** Batch key: human `playerId` or `bot:<slot>`. */
  readonly playerId: string;
  readonly type: string;
  readonly data: CommandEnvelope;
}

/** Append-only, tick-ordered command log of a match. */
export class CommandLog {
  public constructor() {
    notImplemented('CommandLog', 6);
  }

  /** Number of entries. */
  public get length(): number {
    return notImplemented('CommandLog.length', 6);
  }

  /** Highest tick with a recorded batch, `-1` when empty. */
  public get lastTick(): number {
    return notImplemented('CommandLog.lastTick', 6);
  }

  /**
   * Record the full (possibly empty) batch of `tick`. Ticks must be
   * appended strictly ascending; throws otherwise.
   */
  public appendTick(_tick: number, _entries: readonly LogEntry[]): void {
    notImplemented('CommandLog.appendTick', 6);
  }

  /** Entries with `tick > afterTick`, in log order. */
  public entriesAfter(_afterTick: number): readonly LogEntry[] {
    return notImplemented('CommandLog.entriesAfter', 6);
  }

  /** Drop entries with `tick <= tick` (after a persisted snapshot). */
  public truncateThrough(_tick: number): void {
    notImplemented('CommandLog.truncateThrough', 6);
  }
}
