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
 *
 * A failed encode or snapshot write is reported and does not roll back the
 * header or the command tail. Header and command failures still reject
 * {@link flush}.
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
    private readonly seal: () => SealedSnapshot,
    private readonly onSnapshotError: (error: unknown) => void
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
   *
   * The header and the command tail commit even when a snapshot fails.
   * Snapshot failures are reported through the constructor callback and do
   * not reject this promise.
   */
  public flush(urgent: boolean): Promise<void> {
    if (urgent) {
      try {
        this.encodeNow();
      } catch (error) {
        this.noteSnapshotError(error);
      }
      return this.enqueueCommit();
    }
    const gate = this.encodeGate;
    return gate.then(() => this.enqueueCommit());
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
    }).catch((error: unknown) => {
      this.encodeScheduled = false;
      this.noteSnapshotError(error);
    });
  }

  private enqueueCommit(): Promise<void> {
    const commit = this.tail.then(async () => {
      try {
        this.encodeNow();
      } catch (error) {
        this.noteSnapshotError(error);
      }
      await this.commit();
    });
    this.tail = commit.then(
      () => undefined,
      () => undefined
    );
    return commit;
  }

  /** `encodeSnapshot` / digest. Never call this from the tick path. */
  private encodeNow(): void {
    if (this.pendingBodies.length === 0) return;
    const waiting = this.pendingBodies;
    this.pendingBodies = [];
    let failure: unknown;
    for (const sealed of waiting) {
      try {
        this.encoded.push({
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
      } catch (error) {
        // Drop this body. Restoring it would make the next flush throw
        // again and skip the header.
        failure = error;
      }
    }
    if (failure !== undefined) {
      throw failure instanceof Error
        ? failure
        : new Error('MatchJournal: encodeSnapshot failed');
    }
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
    } catch (error) {
      if (header) this.headerPending = true;
      this.entries = entries.concat(this.entries);
      this.encoded = snapshots.concat(this.encoded);
      throw error;
    }
    const retry: EncodedSnapshot[] = [];
    let snapshotFailure: unknown;
    for (const snap of snapshots) {
      try {
        await this.store.saveSnapshot(this.matchId, snap.tick, snap.bytes);
      } catch (error) {
        snapshotFailure = error;
        retry.push(snap);
      }
    }
    if (retry.length > 0) this.encoded = retry.concat(this.encoded);
    if (snapshotFailure !== undefined) this.noteSnapshotError(snapshotFailure);
  }

  private noteSnapshotError(error: unknown): void {
    this.onSnapshotError(error);
  }
}

function hostNow(): number {
  try {
    return wallClock().performance.now();
  } catch {
    return 0;
  }
}
