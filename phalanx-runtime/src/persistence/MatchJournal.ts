import { wallClock } from '../host/wallClock.js';
import type { LogEntry } from '../runner/CommandLog.js';
import { encodeSnapshot } from '../state/snapshot.js';
import type { Digest } from '../state/snapshot.js';
import type { MatchConfig, MatchStore } from './MatchStore.js';
import { scheduleOffTick } from './scheduleOffTick.js';

/**
 * World body plus the bot section and input checkpoint sealed at one tick.
 * `body` is the writer's exact buffer. The journal does not copy it.
 */
export interface SealedSnapshot {
  readonly tick: number;
  readonly body: Uint8Array;
  readonly botState: Uint8Array;
  readonly inputCheckpoint: Uint8Array;
}

export interface SnapshotIdentity {
  readonly engineFormat: number;
  readonly gameId: string;
  readonly simVersion: string;
  readonly formatVersion: number;
  readonly configHash: Digest;
  readonly componentSchemas: string | null;
}

export interface PersistenceSample {
  syncMs: number;
  snapshotted: boolean;
}

interface PendingBody {
  readonly tick: number;
  readonly body: Uint8Array;
  readonly botState: Uint8Array;
  readonly inputCheckpoint: Uint8Array;
}

interface EncodedSnapshot {
  readonly tick: number;
  readonly bytes: Uint8Array;
}

const ZERO_SAMPLE: PersistenceSample = { syncMs: 0, snapshotted: false };

/**
 * Batches a local match into a {@link MatchStore}.
 *
 * The tick path only seals the world body (and the small bot / checkpoint
 * bytes that have to match that tick) and enqueues them. `encodeSnapshot`
 * (and therefore the body digest) runs in {@link scheduleOffTick}. IndexedDB
 * writes run later still, when {@link flush} commits the batch.
 */
export class MatchJournal {
  private readonly sample: PersistenceSample = {
    syncMs: 0,
    snapshotted: false,
  };
  private headerPending = true;
  private entries: LogEntry[] = [];
  private cursor = -1;
  private lastCursor = -1;
  private floor = -1;
  private pendingBodies: PendingBody[] = [];
  private encoded: EncodedSnapshot[] = [];
  private encodeScheduled = false;
  private encodeGate: Promise<void> = Promise.resolve();
  private tail: Promise<void> = Promise.resolve();

  public constructor(
    private readonly store: MatchStore,
    private readonly matchId: string,
    private readonly config: MatchConfig,
    private readonly snapshotEveryTicks: number,
    private readonly identity: SnapshotIdentity,
    private readonly seal: () => SealedSnapshot
  ) {}

  /**
   * Ignore ticks at or below `tick` (a resume catch-up already stored them).
   * The header and cursor are treated as already committed, so a later flush
   * does not rewind the stored cursor.
   */
  public skipThrough(tick: number): void {
    if (!Number.isInteger(tick) || tick < -1) {
      throw new Error(
        `MatchJournal: tick must be an integer >= -1, got ${String(tick)}`
      );
    }
    this.floor = tick;
    if (tick > this.cursor) this.cursor = tick;
    this.lastCursor = this.cursor;
    this.headerPending = false;
  }

  /**
   * Seal this tick. Synchronous. Does not digest, wrap a snapshot, or touch
   * the store.
   */
  public noteTick(
    tick: number,
    entries: readonly LogEntry[]
  ): PersistenceSample {
    if (tick <= this.floor) return ZERO_SAMPLE;
    const started = hostNow();
    let snapshotted = false;
    if (this.shouldSnapshot(tick)) {
      const sealed = this.seal();
      // The body buffer is the one `finish()` returned. Do not copy it.
      this.pendingBodies.push({
        tick: sealed.tick,
        body: sealed.body,
        botState: sealed.botState,
        inputCheckpoint: sealed.inputCheckpoint,
      });
      this.armEncode();
      snapshotted = true;
    }
    for (const entry of entries) this.entries.push(entry);
    if (tick > this.cursor) this.cursor = tick;
    this.sample.syncMs = hostNow() - started;
    this.sample.snapshotted = snapshotted;
    return this.sample;
  }

  /**
   * Write the batch. `urgent` encodes on this stack (page hide / dispose)
   * and starts the store write without waiting for the idle encode.
   * A live stop passes `false`, so the digest stays on the off-tick turn.
   */
  public flush(urgent: boolean): Promise<void> {
    if (urgent) this.encodeNow();
    if (urgent) {
      const job = this.tail.then(async () => {
        this.encodeNow();
        await this.commit();
      });
      this.tail = job.then(
        () => undefined,
        () => undefined
      );
      return job;
    }
    const gate = this.encodeGate;
    const job = gate.then(() => {
      const commit = this.tail.then(async () => {
        this.encodeNow();
        await this.commit();
      });
      this.tail = commit.then(
        () => undefined,
        () => undefined
      );
      return commit;
    });
    return job;
  }

  private shouldSnapshot(tick: number): boolean {
    return tick > 0 && tick % this.snapshotEveryTicks === 0;
  }

  private armEncode(): void {
    if (this.encodeScheduled) return;
    this.encodeScheduled = true;
    this.encodeGate = scheduleOffTick(() => {
      this.encodeScheduled = false;
      this.encodeNow();
    });
  }

  /** `encodeSnapshot` / digest. Never call this from the tick path. */
  private encodeNow(): void {
    if (this.pendingBodies.length === 0) return;
    const waiting = this.pendingBodies;
    this.pendingBodies = [];
    const produced: EncodedSnapshot[] = [];
    try {
      for (const sealed of waiting) {
        produced.push({
          tick: sealed.tick,
          bytes: encodeSnapshot(
            {
              engineFormat: this.identity.engineFormat,
              gameId: this.identity.gameId,
              simVersion: this.identity.simVersion,
              formatVersion: this.identity.formatVersion,
              configHash: this.identity.configHash,
              tick: sealed.tick,
            },
            sealed.body,
            {
              botState: sealed.botState,
              inputCheckpoint: sealed.inputCheckpoint,
              componentSchemas: this.identity.componentSchemas,
            }
          ),
        });
      }
    } catch (error) {
      this.pendingBodies = waiting.concat(this.pendingBodies);
      throw error;
    }
    this.encoded = this.encoded.concat(produced);
  }

  private async commit(): Promise<void> {
    const header = this.headerPending;
    const entries = this.entries;
    const cursor = this.cursor;
    const snapshots = this.encoded;
    if (
      !header &&
      entries.length === 0 &&
      snapshots.length === 0 &&
      cursor === this.lastCursor
    ) {
      return;
    }
    this.headerPending = false;
    this.entries = [];
    this.encoded = [];
    try {
      if (header) await this.store.saveHeader(this.matchId, this.config);
      if (entries.length > 0 || cursor !== this.lastCursor) {
        await this.store.appendCommands(this.matchId, entries, cursor);
        this.lastCursor = cursor;
      }
      for (const snap of snapshots) {
        await this.store.saveSnapshot(this.matchId, snap.tick, snap.bytes);
      }
    } catch (error) {
      if (header) this.headerPending = true;
      this.entries = entries.concat(this.entries);
      this.encoded = snapshots.concat(this.encoded);
      throw error;
    }
  }
}

function hostNow(): number {
  try {
    return wallClock().performance.now();
  } catch {
    return 0;
  }
}
