import type { Unsubscribe } from '@phalanx-engine/ecs';
import type {
  AnyGameDefinition,
  CommandOf,
  ConfigOf,
  MatchOutcome,
  SimOf,
} from '../game/GameDefinition.js';
import { notImplemented } from '../notImplemented.js';
import type { Digest, SnapshotBytes } from '../state/snapshot.js';
import type { Transport } from '../transport/Transport.js';
import type { CommandLog, LogEntry } from './CommandLog.js';
import type { ReplayRecord } from './replay.js';

/** Which bot slots a runner hosts: `'client'` → `runsOn: 'local'`. */
export type RunnerSide = 'client' | 'server';

export interface RunnerOptions {
  /** Default `'client'`. SimHost uses `'server'`. */
  readonly side?: RunnerSide;
  /**
   * Human slots whose input `submit` accepts. Default: every human slot for
   * a `'local'` transport; `TransportJoin.localSlots` for network ones.
   */
  readonly localSlots?: readonly number[];
  /** Publish a digest every N ticks (default `DEFAULT_HASH_EVERY_TICKS`). */
  readonly hashEveryTicks?: number;
  /** Re-save after every restore and compare bytes (default `true`). */
  readonly roundTripCheck?: boolean;
}

export interface FastForwardOptions {
  /** Wall-clock budget per chunk before yielding to the event loop. */
  readonly budgetMs: number;
  /** Progress in `[0, 1]`; reaches exactly `1` at the end. */
  readonly onProgress?: (progress: number) => void;
}

/**
 * Drives one `GameDefinition` from any `Transport`.
 *
 * Per tick T (all inside `WorldScope.run`):
 *  1. take the batch of T from the transport, append it to the log;
 *  2. map `playerId` → slot via the config, drop unknown ids;
 *  3. sort by (slot, seq); for each: `commands.decode` → `commands.validate`
 *     → `sim.applyCommand`; rejected entries stay in the log;
 *  4. emit T on the runner-owned `tickFrameProvider` → the world's standard
 *     `start()` pipeline runs the tick systems;
 *  5. `outcome(sim)`; digest every `hashEveryTicks`;
 *  6. hosted bots `decide(sim, T)` → submitted for `T + inputDelayTicks`.
 */
export class MatchRunner<G extends AnyGameDefinition> {
  public constructor(
    _definition: G,
    _config: ConfigOf<G>,
    _transport: Transport,
    _options?: RunnerOptions
  ) {
    notImplemented('MatchRunner', 6);
  }

  /** Join (or resume) through a network transport's `join()`. */
  public static join<G extends AnyGameDefinition>(
    _definition: G,
    _transport: Transport,
    _options?: RunnerOptions
  ): Promise<MatchRunner<G>> {
    return notImplemented('MatchRunner.join', 12);
  }

  /** Re-run a recording on a manual `LocalTransport`. */
  public static fromReplay<G extends AnyGameDefinition>(
    _definition: G,
    _replay: ReplayRecord<ConfigOf<G>>,
    _options?: RunnerOptions
  ): MatchRunner<G> {
    return notImplemented('MatchRunner.fromReplay', 6);
  }

  /** Current simulation; replaced by `restore`, never cache it. */
  public get sim(): SimOf<G> {
    return notImplemented('MatchRunner.sim', 6);
  }

  /** Last completed tick, `-1` before the first tick. */
  public get tick(): number {
    return notImplemented('MatchRunner.tick', 6);
  }

  public get log(): CommandLog {
    return notImplemented('MatchRunner.log', 6);
  }

  public start(): void {
    notImplemented('MatchRunner.start', 6);
  }

  public stop(): void {
    notImplemented('MatchRunner.stop', 6);
  }

  public dispose(): void {
    notImplemented('MatchRunner.dispose', 6);
  }

  /**
   * Local human input. Encoded, wrapped in an envelope with the slot's next
   * `seq` and submitted for `tick + inputDelayTicks`. Never applied locally
   * before the transport delivers it in a batch.
   */
  public submit(_command: CommandOf<G>, _slot?: number): void {
    notImplemented('MatchRunner.submit', 6);
  }

  /** Header + `GameState.save()` + hosted bot state, after a full tick. */
  public snapshot(): SnapshotBytes {
    return notImplemented('MatchRunner.snapshot', 6);
  }

  /**
   * Version policy → fresh `createWorld(config, { purpose: 'restore' })` →
   * `GameState.restore` → `done()` → round-trip check → bot state.
   */
  public restore(_bytes: SnapshotBytes): void {
    notImplemented('MatchRunner.restore', 6);
  }

  /** `digestBytes(GameState.save())` of the current tick. */
  public digest(): Digest {
    return notImplemented('MatchRunner.digest', 6);
  }

  /**
   * Execute logged ticks without frames, in chunks of `budgetMs`, while
   * buffering live batches; resolves once caught up with the transport.
   */
  public fastForward(
    _entries: Iterable<LogEntry>,
    _options: FastForwardOptions
  ): Promise<void> {
    return notImplemented('MatchRunner.fastForward', 6);
  }

  public toReplay(): ReplayRecord<ConfigOf<G>> {
    return notImplemented('MatchRunner.toReplay', 6);
  }

  public onTick(_handler: (tick: number) => void): Unsubscribe {
    return notImplemented('MatchRunner.onTick', 6);
  }

  /** Render frames; suppressed while fast-forwarding. */
  public onFrame(_handler: (alpha: number, dt: number) => void): Unsubscribe {
    return notImplemented('MatchRunner.onFrame', 6);
  }

  public onOutcome(_handler: (outcome: MatchOutcome) => void): Unsubscribe {
    return notImplemented('MatchRunner.onOutcome', 6);
  }

  public onCatchUp(_handler: (progress: number) => void): Unsubscribe {
    return notImplemented('MatchRunner.onCatchUp', 6);
  }

  public onDigest(
    _handler: (tick: number, digest: Digest) => void
  ): Unsubscribe {
    return notImplemented('MatchRunner.onDigest', 6);
  }

  public onRejected(
    _handler: (entry: LogEntry, reason: string) => void
  ): Unsubscribe {
    return notImplemented('MatchRunner.onRejected', 6);
  }
}
