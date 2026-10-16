import type { CommandEnvelope } from '../game/commands.js';

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
  /**
   * The wire `data` was not an envelope. Replay rejects it again with
   * `'malformed envelope'` instead of decoding `data`.
   */
  readonly malformed?: true;
}

/** Append-only, tick-ordered command log of a match. */
export class CommandLog {
  private readonly entries: LogEntry[] = [];
  private lastRecorded = -1;
  /**
   * False when `rewindTo` claims ticks this log never appended, or when
   * `truncateThrough` drops stored entries. `MatchRunner.toReplay` refuses
   * an incomplete log. A suffix rewind of a log that was recorded from
   * tick 0 stays complete.
   */
  private incomplete = false;

  /** Number of entries. */
  public get length(): number {
    return this.entries.length;
  }

  /** Highest tick with a recorded batch, `-1` when empty. */
  public get lastTick(): number {
    return this.lastRecorded;
  }

  /**
   * True when the stored entries are the history from the start of the
   * match through {@link lastTick}. Restore onto a log that never recorded
   * those ticks, and {@link truncateThrough} after it drops entries, clear
   * this.
   */
  public get isComplete(): boolean {
    return !this.incomplete;
  }

  /**
   * Record the full (possibly empty) batch of `tick`. Ticks must be
   * appended strictly ascending; throws otherwise. Empty ticks advance
   * `lastTick` without storing entries.
   */
  public appendTick(tick: number, batch: readonly LogEntry[]): void {
    if (!Number.isInteger(tick) || tick < 0) {
      throw new Error(
        `CommandLog.appendTick: tick must be an integer >= 0, got ${String(tick)}`
      );
    }
    if (tick <= this.lastRecorded) {
      throw new Error(
        `CommandLog.appendTick: tick ${String(tick)} is not after ${String(this.lastRecorded)}`
      );
    }
    for (const entry of batch) {
      if (entry.tick !== tick) {
        throw new Error(
          `CommandLog.appendTick: entry tick ${String(entry.tick)} does not match batch ${String(tick)}`
        );
      }
      this.entries.push(entry);
    }
    this.lastRecorded = tick;
  }

  /** Entries with `tick > afterTick`, in log order. A fresh array. */
  public entriesAfter(afterTick: number): readonly LogEntry[] {
    const out: LogEntry[] = [];
    for (const entry of this.entries) {
      if (entry.tick > afterTick) out.push(entry);
    }
    return out;
  }

  /** Drop entries with `tick <= tick`. `lastTick` stays (the batch was recorded). */
  public truncateThrough(tick: number): void {
    if (!Number.isInteger(tick)) {
      throw new Error(
        `CommandLog.truncateThrough: tick must be an integer, got ${String(tick)}`
      );
    }
    let drop = 0;
    while (drop < this.entries.length) {
      const entry = this.entries[drop];
      if (entry === undefined || entry.tick > tick) break;
      drop += 1;
    }
    if (drop > 0) {
      this.entries.splice(0, drop);
      this.incomplete = true;
    }
  }

  /**
   * Drop entries with `tick > tick` and treat `tick` as the last recorded
   * batch. A restored runner uses this so the next append continues at
   * `tick + 1` even when the pre-snapshot commands were never stored here.
   */
  public rewindTo(tick: number): void {
    if (!Number.isInteger(tick) || tick < -1) {
      throw new Error(
        `CommandLog.rewindTo: tick must be an integer >= -1, got ${String(tick)}`
      );
    }
    if (tick === -1) {
      this.entries.length = 0;
      this.lastRecorded = -1;
      this.incomplete = false;
      return;
    }
    const previous = this.lastRecorded;
    let keep = 0;
    for (const entry of this.entries) {
      if (entry.tick > tick) break;
      keep += 1;
    }
    this.entries.length = keep;
    this.lastRecorded = tick;
    if (tick > previous) this.incomplete = true;
  }
}
