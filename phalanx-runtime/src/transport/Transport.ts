import type {
  CommandsBatch,
  FrameHandler,
  ITickFrameProvider,
  PauseHandler,
  TickHandler,
  Unsubscribe,
} from '@phalanx-engine/ecs';

export type {
  CommandsBatch,
  FrameHandler,
  PauseHandler,
  TickHandler,
  Unsubscribe,
};
import type { TransportCommand } from '../game/commands.js';
import type { LogEntry } from '../runner/CommandLog.js';
import type { Digest, SnapshotBytes } from '../state/snapshot.js';

export type TransportKind = 'local' | 'relay-lockstep' | 'server-peer';

/** State a runner needs to (re)join a running match. */
export interface TransportCatchUp {
  /** Snapshot to restore first; absent → replay `log` from tick 0. */
  readonly snapshot?: SnapshotBytes;
  /** Every entry after the snapshot tick (or from tick 0), in order. */
  readonly log: readonly LogEntry[];
  /**
   * Server `GameRoom.currentTick` at the reply: the next tick to run.
   * The last completed tick, and `fastForward`'s `throughTick`, is
   * `currentTick - 1`.
   */
  readonly currentTick: number;
}

export interface TransportJoin {
  /** Server-built match config; validated by the runner against the game. */
  readonly config: unknown;
  /** Human slots whose input this client submits. */
  readonly localSlots: readonly number[];
  /** Present when the transport resumed an existing session. */
  readonly catchUp?: TransportCatchUp;
}

/**
 * Upstream of a `MatchRunner`: where tick batches come from and where local
 * input goes. Extends the existing `ITickFrameProvider`, so `PhalanxClient`
 * already satisfies the tick/frame/pause part structurally.
 *
 * Batch contract: `onTick(tick, batch)` delivers every command executed at
 * `tick`; `batch.commands[playerId]` holds `PlayerCommand`s whose `data` is a
 * {@link CommandEnvelope}. Ticks arrive strictly ascending without gaps.
 * The runner does not rely on key or array order: it maps `playerId` to a
 * slot through the match config and sorts by (slot, seq) itself.
 */
export interface Transport extends ITickFrameProvider {
  readonly kind: TransportKind;
  /**
   * Send commands of local slot `slot` for execution at `targetTick`
   * (`lastTick + inputDelayTicks`). Network transports may execute them
   * later (the relay reschedules late commands to its current tick); the
   * delivered batch is the only truth.
   */
  submit(
    targetTick: number,
    slot: number,
    commands: readonly TransportCommand[]
  ): void;
  /** Network transports: join or resume a match. */
  join?(): Promise<TransportJoin>;
  /** Network transports: publish the local digest of `tick`. */
  submitHash?(tick: number, digest: Digest): void;
  /** Server mode: the server says this client diverged at `tick`. */
  onDesync?(handler: (tick: number) => void): Unsubscribe;
  /** Server mode: fetch a fresh server snapshot plus the following log. */
  requestResync?(): Promise<TransportCatchUp>;
  dispose?(): void;
}
