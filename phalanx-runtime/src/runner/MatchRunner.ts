import type {
  CommandsBatch,
  ComponentRegistration,
  FrameHandler,
  ITickFrameProvider,
  PauseHandler,
  TickHandler,
  Unsubscribe,
} from '@phalanx-engine/ecs';
import { DeterministicRandom } from '@phalanx-engine/math';
import { GameWorld } from '@phalanx-engine/ecs';
import {
  DEFAULT_CLIENT_SNAPSHOT_EVERY_TICKS,
  DEFAULT_HASH_EVERY_TICKS,
  DEFAULT_INPUT_DELAY_TICKS,
  ENGINE_SNAPSHOT_FORMAT,
  REPLAY_FORMAT,
} from '../constants.js';
import {
  SYSTEM_PLAYER_ID,
  botPlayerId,
  isBotPlayerId,
} from '@phalanx-engine/protocol';
import {
  isCommandRejection,
  type CommandEnvelope,
  type JsonValue,
  type StampedCommand,
} from '../game/commands.js';
import type {
  AnyGameDefinition,
  CommandOf,
  ConfigOf,
  GameContext,
  MatchOutcome,
  SimOf,
  StartContext,
} from '../game/GameDefinition.js';
import type {
  BotHostSide,
  BotSlotInfo,
  MatchConfigBase,
  SlotConfig,
  SlotInfo,
} from '../game/MatchConfig.js';
import {
  MatchJournal,
  type SealedSnapshot,
} from '../persistence/MatchJournal.js';
import type { LoadedMatch, MatchStore } from '../persistence/MatchStore.js';
import { scheduleOffTick } from '../persistence/scheduleOffTick.js';
import { initDigest } from '../state/digest.js';
import { BinaryStateReader, BinaryStateWriter } from '@phalanx-engine/ecs';
import type { SaveHandler, StateMigration } from '../state/GameState.js';
import {
  SnapshotRejectedError,
  SnapshotRoundTripError,
} from '../state/errors.js';
import {
  checkSnapshotCompatibility,
  componentSchemaKey,
  configHash,
  decodeSnapshot,
  digestBytes,
  encodeSnapshot,
  schemaMismatchMessage,
  type CommandSchemaHash,
  type ComponentSchemaHash,
  type Digest,
  type SnapshotBytes,
} from '../state/snapshot.js';
import { componentSchemaHashes } from '../world/schemaHash.js';
import { wallClock } from '../host/wallClock.js';
import {
  LocalTransport,
  type PersistenceFlushReason,
} from '../transport/LocalTransport.js';
import type {
  Transport,
  TransportCatchUp,
} from '../transport/Transport.js';
import { BotHost } from './BotHost.js';
import { CommandLog, type LogEntry } from './CommandLog.js';
import {
  canonicalJsonValue,
  decodeInputCheckpoint,
  encodeInputCheckpoint,
  type InputCheckpoint,
  type PendingCommandBatch,
  type SlotSequence,
} from './InputCheckpoint.js';
import { assertReplayRecord, type ReplayRecord } from './replay.js';

/** Which bot slots a runner hosts: `'client'` → `runsOn: 'local'`. */
export type RunnerSide = 'client' | 'server';

/**
 * `'ready'` before `start`, `'running'` while the clock is going,
 * `'ended'` after the first non-null outcome, `'failed'` after a tick
 * threw, `'disposed'` after `dispose`.
 */
export type RunnerStatus =
  'ready' | 'running' | 'ended' | 'failed' | 'disposed';

/** Host time per catch-up chunk before yielding to live batches. */
const CATCH_UP_BUDGET_MS = 8;

export interface RunnerOptions {
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

/**
 * Which snapshot {@link MatchRunner.resumeLocal} restored, and which newer
 * ones it rejected. `cleanupError` is set when deleting a rejected snapshot
 * fails. The match is still resumed.
 */
export interface ResumeReport {
  readonly snapshotTick: number | null;
  readonly skipped: readonly {
    readonly tick: number;
    readonly error: unknown;
  }[];
  readonly cleanupError?: unknown;
}

/**
 * Every retained snapshot failed to restore. The store is left as it was.
 * `attempts` runs from the newest snapshot. Each `error` is the restore
 * failure (`cause` is the underlying reader error when there is one).
 */
export class MatchResumeError extends Error {
  public readonly matchId: string;
  public readonly attempts: readonly {
    readonly tick: number;
    readonly error: unknown;
  }[];

  public constructor(
    matchId: string,
    attempts: readonly { readonly tick: number; readonly error: unknown }[]
  ) {
    const ticks = attempts.map((attempt) => String(attempt.tick)).join(', ');
    const newest = attempts[0]?.error;
    super(
      `MatchRunner.resumeLocal: every stored snapshot for '${matchId}' failed (ticks ${ticks})`,
      newest === undefined ? undefined : { cause: newest }
    );
    this.name = 'MatchResumeError';
    this.matchId = matchId;
    this.attempts = attempts;
  }
}

/**
 * Options for {@link MatchRunner.resumeLocal}. Persistence fields configure
 * the new local transport. The rest are {@link RunnerOptions}.
 */
export interface ResumeLocalOptions extends RunnerOptions {
  /**
   * Completed ticks between sealed snapshots. Default
   * `DEFAULT_CLIENT_SNAPSHOT_EVERY_TICKS`.
   */
  readonly snapshotEveryTicks?: number;
  /**
   * Pause the resumed transport while the document is hidden. Default true.
   * A host with no `document` ignores it.
   */
  readonly pauseWhenHidden?: boolean;
  /**
   * Called once, before the runner is returned, when a newer snapshot was
   * rejected and an older one was restored.
   */
  readonly onSnapshotFallback?: (report: ResumeReport) => void;
}

export interface FastForwardOptions {
  /** Wall-clock budget per chunk before yielding to the event loop. */
  readonly budgetMs: number;
  /**
   * Last tick to execute, inclusive. Empty ticks still run: a command
   * iterable cannot express them. Replay passes `ReplayRecord.lastTick`.
   * Server catch-up passes `TransportCatchUp.currentTick - 1`, because
   * `GameRoom.currentTick` between ticks is the next tick to run
   * (`GameRoom.ts` increments it at the end of `processTick`).
   * Throws when `throughTick` is below the runner's current tick or when
   * an entry falls outside `(current, throughTick]`.
   */
  readonly throughTick: number;
  /** Progress in `[0, 1]`; reaches exactly `1` at the end. */
  readonly onProgress?: (progress: number) => void;
}

interface ResumeAttempt {
  readonly snapshot?: LoadedMatch['snapshot'];
  readonly tail: readonly LogEntry[];
}

/** Newest snapshot first. No snapshot means replay the whole log from 0. */
function resumeAttempts(loaded: LoadedMatch): ResumeAttempt[] {
  if (loaded.snapshot === undefined) return [{ tail: loaded.tail }];
  const attempts: ResumeAttempt[] = [
    { snapshot: loaded.snapshot, tail: loaded.tail },
  ];
  if (loaded.previous !== undefined) {
    attempts.push({
      snapshot: loaded.previous.snapshot,
      tail: loaded.previous.tail,
    });
  }
  return attempts;
}

interface TickPlan {
  readonly decide: boolean;
  /** When set, decisions whose target tick is `<=` this value are not sent. */
  readonly submitAfter?: number;
}

/**
 * Drives one `GameDefinition` from any `Transport`.
 *
 * Per tick T:
 *  1. take the batch of T from the transport, append it to the log;
 *  2. map `playerId` → slot via the config, drop unknown ids;
 *  3. sort by (slot, seq); for each: `commands.decode` → `commands.validate`
 *     → `onCommand`; rejected entries stay in the log;
 *     system commands (`setController`) run before game commands;
 *  4. emit T on the runner-owned `tickFrameProvider` → the world's standard
 *     `start()` pipeline runs the tick systems;
 *  5. hosted bots `decide(sim, T)` while the match is still active, submitted
 *     for `T + inputDelayTicks` (the input checkpoint);
 *  6. advance the completed tick, then publish `outcome` and the digest.
 */
export class MatchRunner<G extends AnyGameDefinition> {
  private readonly definition: G;
  private readonly config: ConfigOf<G>;
  private readonly transport: Transport;
  private readonly side: RunnerSide;
  private readonly modes = new Map<number, 'human' | 'bot'>();
  private systemSeq = 0;
  private readonly hashEveryTicks: number;
  private readonly roundTripCheck: boolean;
  private readonly localSlots: readonly number[];
  private readonly localSlotSet: ReadonlySet<number>;
  private readonly botSlotSet: ReadonlySet<number>;
  private readonly configDigest: Digest;
  /** Writer/reader schema text. `null` when no component is registered. */
  private componentSchemaKey: string | null = null;
  private readonly commandLog = new CommandLog();
  private readonly random: DeterministicRandom;
  private readonly provider: RunnerProvider;
  private readonly botHost: BotHost<G>;
  private readonly slotByPlayerId = new Map<string, number>();
  private readonly playerIdBySlot = new Map<number, string>();
  private readonly slotInfo = new Map<number, SlotInfo>();
  private readonly commandTypes: ReadonlySet<string>;
  private readonly tickListeners = new Emitter<[number]>();
  private readonly frameListeners = new Emitter<[number, number]>();
  private readonly outcomeListeners = new Emitter<[MatchOutcome]>();
  private readonly catchUpListeners = new Emitter<[number]>();
  private readonly digestListeners = new Emitter<[number, Digest]>();
  private readonly rejectedListeners = new Emitter<[LogEntry, string]>();
  private readonly errorListeners = new Emitter<[unknown, number]>();
  private readonly pendingByTick = new Map<number, LogEntry[]>();
  private readonly nextSeq = new Map<number, number>();
  private simulation: SimOf<G> | null = null;
  private gameState: SaveHandler | null = null;
  private bootPurpose: 'fresh' | 'restore' = 'fresh';
  private completedTick = -1;
  private executingTick: number | null = null;
  private started = false;
  private stopped = false;
  private phase: 'active' | 'ended' | 'failed' = 'active';
  private fastForwarding = false;
  private replayMode = false;
  private replayDigest: Digest | undefined;
  private replayLastTick = -1;
  /** Restored commands not yet handed back to the transport. */
  private unsent: LogEntry[] | null = null;
  /** Last pause signal from the transport. The rebuilt world must match it. */
  private transportPaused = false;
  private readonly bufferedTicks: { tick: number; batch: CommandsBatch }[] = [];
  private readonly unsubTick: Unsubscribe;
  private readonly unsubFrame: Unsubscribe;
  private readonly unsubPause: Unsubscribe;
  private readonly unsubResume: Unsubscribe;
  private journal: MatchJournal | null = null;
  private unsubFlush: Unsubscribe = () => {};
  private persistDone: Promise<void> = Promise.resolve();
  private persistenceSyncMs = 0;
  private persistenceSnapshotted = false;
  /** Reused across captures. `finish()` copies the immutable body out. */
  private readonly captureWriter = new BinaryStateWriter(65_536);
  /** World body already saved for a tick that is both a hash and a snapshot. */
  private sharedSealBody: Uint8Array | null = null;
  /** Periodic hashes captured in the tick and hashed off it, in tick order. */
  private readonly pendingDigests: PendingDigest[] = [];
  private digestIdle: Promise<void> = Promise.resolve();
  /** Host time spent on {@link sharedSealBody}. Added into the seal sample. */
  private sharedSealMs = 0;
  private readonly persistenceErrorListeners = new Emitter<[unknown]>();
  /** Set by {@link MatchRunner.resumeLocal}. Null on a runner that was not resumed. */
  private resumeReportValue: ResumeReport | null = null;
  private unsubDesync: Unsubscribe = () => {};
  private resyncing = false;

  public constructor(
    definition: G,
    config: ConfigInput<G>,
    transport: Transport,
    options?: RunnerOptions
  ) {
    this.definition = definition;
    this.config = normalizeConfig(definition, config);
    this.transport = transport;
    this.side = this.config.side;
    this.hashEveryTicks = resolveHashEvery(options?.hashEveryTicks);
    this.roundTripCheck = options?.roundTripCheck ?? true;
    this.configDigest = hashMatchConfig(this.config);
    validateConfig(definition, this.config);
    this.resetModes();
    this.localSlots = resolveLocalSlots(
      this.config,
      transport,
      options?.localSlots
    );
    this.localSlotSet = new Set(this.localSlots);
    this.commandTypes = new Set(definition.commands.types);
    indexSlots(
      this.config.slots,
      this.slotByPlayerId,
      this.playerIdBySlot,
      this.slotInfo
    );
    this.random = new DeterministicRandom(this.config.seed >>> 0);
    this.provider = new RunnerProvider(transport);
    this.botHost = new BotHost(definition, this.config, this.side, this.modes);
    this.botSlotSet = new Set(this.botHost.slots);
    if (transport instanceof LocalTransport) {
      if (!transport.isStepped && transport.tickRate !== definition.tickRate) {
        throw new Error(
          `MatchRunner: LocalTransport tickRate ${String(transport.tickRate)} does not match game tickRate ${String(definition.tickRate)}`
        );
      }
      transport.bindSlots(
        this.config.slots.map((slot) => ({
          slot: slot.slot,
          playerId:
            slot.kind === 'human' ? slot.playerId : botPlayerId(slot.slot),
        }))
      );
    }
    this.unsubTick = transport.onTick((tick, batch) => {
      this.onTransportTick(tick, batch);
    });
    this.unsubFrame = transport.onFrame((alpha, dt) => {
      this.onTransportFrame(alpha, dt);
    });
    this.unsubPause = transport.onPause
      ? transport.onPause(() => {
          this.transportPaused = true;
          this.provider.firePause();
        })
      : () => {};
    this.unsubResume = transport.onResume
      ? transport.onResume(() => {
          this.transportPaused = false;
          this.provider.fireResume();
        })
      : () => {};
    this.boot('fresh');
    const schemas =
      this.simulation === null
        ? []
        : componentSchemaHashes(this.simulation.world);
    this.componentSchemaKey = componentSchemaKey(schemas);
    this.configDigest = hashMatchConfig(
      this.config,
      schemas,
      this.definition.commands.schema,
      this.simulation === null ? undefined : this.simulation.world.systemNames()
    );
    this.attachPersistence();
  }

  /**
   * Rebuild a local match from `store`. Returns null when `matchId` was
   * never saved. Does not start the clock; call {@link start}. The restored
   * snapshot includes the input checkpoint (`systemSeq` and every slot's
   * controller mode). Catch-up fast-forwards empty ticks through the stored
   * cursor. A snapshot that is already a finished match stays ended and
   * does not catch up. A restore failure tries the previous snapshot on a
   * new runner. A fast-forward failure does not. When every snapshot fails,
   * this throws {@link MatchResumeError} and leaves the store unchanged.
   * With no snapshot, the whole log is replayed from tick 0.
   * `options` sets the resumed transport's snapshot interval and
   * pause-when-hidden flag, and the runner's hash interval.
   */
  public static async resumeLocal<GDef extends AnyGameDefinition>(
    definition: GDef,
    store: MatchStore,
    matchId: string,
    options?: ResumeLocalOptions
  ): Promise<MatchRunner<GDef> | null> {
    const loaded = await store.load(matchId);
    if (loaded === null) return null;
    if (loaded.config.gameId !== definition.id) {
      throw new Error(
        `MatchRunner.resumeLocal: stored gameId '${loaded.config.gameId}' does not match '${definition.id}'`
      );
    }
    if (loaded.config.simVersion !== definition.simVersion) {
      throw new Error(
        `MatchRunner.resumeLocal: stored simVersion '${loaded.config.simVersion}' does not match '${definition.simVersion}'`
      );
    }
    if (loaded.config.matchId !== matchId) {
      throw new Error(
        `MatchRunner.resumeLocal: stored matchId '${loaded.config.matchId}' does not match '${matchId}'`
      );
    }
    const attempts = resumeAttempts(loaded);
    const skipped: { tick: number; error: unknown }[] = [];
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      if (attempt === undefined) continue;
      const runner = MatchRunner.openResumeRunner(
        definition,
        store,
        loaded,
        options
      );
      if (attempt.snapshot !== undefined) {
        try {
          runner.restore(attempt.snapshot.bytes);
        } catch (error) {
          await MatchRunner.abandonResumeAttempt(runner, loaded.tick);
          skipped.push({ tick: attempt.snapshot.tick, error });
          if (index < attempts.length - 1) continue;
          throw new MatchResumeError(matchId, skipped);
        }
      }
      try {
        // After restore, so a snapshot at or above the fresh cursor (-1) is
        // not treated as a rewind. Resume must not clear the stored record.
        runner.journal?.skipThrough(loaded.tick);
        if (runner.status !== 'ended' && loaded.tick > runner.tick) {
          await runner.fastForward(attempt.tail, {
            budgetMs: 80,
            throughTick: loaded.tick,
          });
        }
      } catch (error) {
        runner.dispose();
        try {
          await runner.whenPersisted();
        } catch {
          // The fast-forward error is the one the caller must see.
        }
        throw error;
      }
      const report = await MatchRunner.publishResumeReport(
        runner,
        store,
        matchId,
        attempt.snapshot?.tick ?? null,
        skipped
      );
      try {
        if (skipped.length > 0) options?.onSnapshotFallback?.(report);
      } catch (error) {
        runner.dispose();
        throw error;
      }
      return runner;
    }
    throw new MatchResumeError(matchId, skipped);
  }

  private static openResumeRunner<GDef extends AnyGameDefinition>(
    definition: GDef,
    store: MatchStore,
    loaded: LoadedMatch,
    options: ResumeLocalOptions | undefined
  ): MatchRunner<GDef> {
    const transport = new LocalTransport({
      tickRate: definition.tickRate,
      store,
      snapshotEveryTicks:
        options?.snapshotEveryTicks ?? DEFAULT_CLIENT_SNAPSHOT_EVERY_TICKS,
      pauseWhenHidden: options?.pauseWhenHidden ?? true,
    });
    // The store cloned the JSON config, including game fields. The runner
    // checks it against this definition.
    return new MatchRunner(
      definition,
      loaded.config as unknown as ConfigInput<GDef>,
      transport,
      options
    );
  }

  /**
   * A failed restore must not flush as a fresh match: that would clear the
   * stored record. `skipThrough` marks the journal as already committed.
   */
  private static async abandonResumeAttempt<GDef extends AnyGameDefinition>(
    runner: MatchRunner<GDef>,
    tick: number
  ): Promise<void> {
    runner.journal?.skipThrough(tick);
    runner.dispose();
    await runner.whenPersisted();
  }

  private static async publishResumeReport<GDef extends AnyGameDefinition>(
    runner: MatchRunner<GDef>,
    store: MatchStore,
    matchId: string,
    snapshotTick: number | null,
    skipped: readonly { readonly tick: number; readonly error: unknown }[]
  ): Promise<ResumeReport> {
    let cleanupError: unknown;
    if (skipped.length > 0 && store.deleteSnapshot !== undefined) {
      for (const item of skipped) {
        try {
          await store.deleteSnapshot(matchId, item.tick);
        } catch (error) {
          if (cleanupError === undefined) cleanupError = error;
        }
      }
    }
    const report: ResumeReport =
      cleanupError === undefined
        ? { snapshotTick, skipped }
        : { snapshotTick, skipped, cleanupError };
    runner.resumeReportValue = report;
    return report;
  }

  /**
   * Join (or resume) through a network transport's `join()`. A fresh
   * join starts the runner. A resume restores the server snapshot (its
   * bot state and input checkpoint are ignored), starts the runner so
   * live batches are buffered, and fast-forwards the log through
   * `currentTick - 1`. With `onDesync` and `requestResync`, a server
   * desync report triggers one resync at a time with the same steps.
   */
  public static async join<GDef extends AnyGameDefinition>(
    definition: GDef,
    transport: Transport,
    options?: RunnerOptions
  ): Promise<MatchRunner<GDef>> {
    if (typeof transport.join !== 'function') {
      throw new Error('MatchRunner.join: transport does not support join()');
    }
    const joined = await transport.join();
    const runner = new MatchRunner(
      definition,
      joined.config as ConfigInput<GDef>,
      transport,
      { ...options, localSlots: joined.localSlots }
    );
    try {
      if (joined.catchUp === undefined) {
        runner.start();
      } else {
        await runner.applyCatchUp(joined.catchUp);
      }
    } catch (error) {
      runner.dispose();
      throw error;
    }
    runner.watchDesync();
    return runner;
  }

  /**
   * Runner positioned at tick `-1` in replay mode. Hosted policies are never
   * asked to `decide`. Drive it only with `fastForward(replay.log, {
   * throughTick: replay.lastTick })`. `start()` throws: a replay has no
   * live clock.
   */
  /**
   * Runner positioned at tick `-1` in replay mode. `ReplayPlayer.from` is
   * the public entry. Hosted policies are never asked to `decide`.
   */
  public static openReplay<GDef extends AnyGameDefinition>(
    definition: GDef,
    replay: ReplayRecord<ConfigOf<GDef>>,
    options?: RunnerOptions
  ): MatchRunner<GDef> {
    assertReplayRecord(definition, replay);
    const runner = new MatchRunner(
      definition,
      replay.config,
      LocalTransport.stepped(),
      options
    );
    runner.replayMode = true;
    runner.replayDigest = replay.finalDigest;
    runner.replayLastTick = replay.lastTick;
    return runner;
  }

  /**
   * Snapshot chosen by {@link MatchRunner.resumeLocal}. Null until that
   * path returns this runner.
   */
  public get resumeReport(): ResumeReport | null {
    return this.resumeReportValue;
  }

  /** Current simulation; replaced by `restore`, never cache it. */
  public get sim(): SimOf<G> {
    if (this.simulation === null) {
      throw new Error('MatchRunner.sim: runner is disposed');
    }
    return this.simulation;
  }

  /** Last completed tick, `-1` before the first tick. */
  public get tick(): number {
    return this.completedTick;
  }

  /** `'ended'` and `'failed'` do not accept further ticks. */
  public get status(): RunnerStatus {
    if (this.stopped) return 'disposed';
    if (this.phase === 'failed') return 'failed';
    if (this.phase === 'ended') return 'ended';
    if (this.started) return 'running';
    return 'ready';
  }

  public get log(): CommandLog {
    return this.commandLog;
  }

  /**
   * Host milliseconds spent sealing the last tick's persistence work
   * (world save plus enqueue). When that tick is also a hash tick, the
   * world save is shared with the digest and its time is included here.
   * The digest itself and the store write are not included.
   * `0` when this runner has no store.
   */
  public get lastPersistenceSyncMs(): number {
    return this.persistenceSyncMs;
  }

  /** True when the last completed tick sealed a snapshot body. */
  public get lastTickPersistedSnapshot(): boolean {
    return this.persistenceSnapshotted;
  }

  /**
   * Resolves when the latest flush has committed the header and the command
   * tail. A snapshot encode or snapshot write failure is reported through
   * {@link onPersistenceError} and does not reject this promise. A header or
   * command failure rejects it and is also reported there.
   */
  public whenPersisted(): Promise<void> {
    return this.persistDone;
  }

  public start(): void {
    if (this.replayMode) {
      throw new Error(
        'ReplayPlayer: drive the player with play() or fastForward(throughTick)'
      );
    }
    if (this.stopped) {
      throw new Error('MatchRunner.start: runner is disposed');
    }
    if (this.phase === 'failed') {
      throw new Error('MatchRunner.start: runner has failed');
    }
    if (this.phase === 'ended') {
      throw new Error('MatchRunner.start: match has ended');
    }
    if (this.started) return;
    this.assertServerBotsHavePeer();
    void initDigest();
    this.started = true;
    this.flushUnsent();
    if (this.transport instanceof LocalTransport) this.transport.start();
  }

  public stop(): void {
    this.started = false;
    if (this.transport instanceof LocalTransport) this.transport.stop();
  }

  public dispose(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.started = false;
    this.dropPendingDigests();
    const journal = this.journal;
    if (journal !== null) {
      // Encode sealed bodies now. Page teardown must not wait for idle.
      this.persistDone = this.track(journal.flush(true));
    }
    this.unsubFlush();
    this.unsubTick();
    this.unsubFrame();
    this.unsubPause();
    this.unsubResume();
    this.unsubDesync();
    this.transport.dispose?.();
    this.destroySim();
  }

  /**
   * Local human input. Encoded, wrapped in an envelope with the slot's next
   * `seq` and submitted for `tick + inputDelayTicks`. Never applied locally
   * before the transport delivers it in a batch. `validate` runs inside the
   * tick, on every peer.
   */
  public submit(command: CommandOf<G>, slot?: number): void {
    this.ensureLive();
    const resolved = this.resolveHumanSlot(slot);
    const issuedAt = this.executingTick ?? this.completedTick;
    this.enqueue(
      resolved,
      command,
      issuedAt + this.config.inputDelayTicks,
      this.humanPlayerId(resolved)
    );
  }

  /**
   * Header + `GameState.save()` + hosted bot state + the input checkpoint,
   * after a full tick (hosted `decide` already submitted). Bot state and
   * the checkpoint are outside the digest.
   */
  public snapshot(): SnapshotBytes {
    this.ensureLive();
    if (this.completedTick < 0) {
      throw new Error('MatchRunner.snapshot: no tick has completed');
    }
    return this.captureSnapshot();
  }

  /**
   * Version policy → fresh `createWorld(config, { purpose: 'restore' })` →
   * `GameState.restore` → `done()` → round-trip check. Controller mode for
   * every slot is restored from the bot section on every peer. Policy and
   * RNG bytes, and the input checkpoint, are applied only for slots this
   * runner hosts or submits. A client restoring a server snapshot keeps a
   * human-to-bot handover and ignores the other side's policy state. With no following
   * `fastForward`, `start` re-submits the checkpoint and does not re-run
   * `decide` for the snapshot tick. A runner that is already started flushes
   * that checkpoint after the transport seek, because `start` will not run
   * again. The match RNG is reset to `config.seed` before `createWorld`;
   * `GameState.restore` then installs the saved generator. A transport that
   * is already paused pauses the rebuilt world. The terminal phase is
   * recomputed from the restored state. While persistence is enabled, a
   * snapshot older than the journal cursor is rejected. Once the snapshot
   * is accepted, periodic digests still waiting are dropped, so the
   * abandoned timeline is not published.
   */
  public restore(bytes: SnapshotBytes): void {
    this.restoreBytes(bytes, true);
  }

  /**
   * `trustPeerState` false: a client restoring a server snapshot never
   * applies the server's bot state or input checkpoint.
   */
  private restoreBytes(bytes: SnapshotBytes, trustPeerState: boolean): void {
    this.ensureLive();
    const decoded = decodeSnapshot(bytes);
    if (decoded.componentSchemas !== null) {
      const mismatch = schemaMismatchMessage(
        decoded.componentSchemas,
        this.componentSchemaKey
      );
      if (mismatch !== null) throw new Error(mismatch);
    }
    const decision = checkSnapshotCompatibility(
      decoded.header,
      {
        engineFormat: ENGINE_SNAPSHOT_FORMAT,
        gameId: this.definition.id,
        simVersion: this.definition.simVersion,
        formatVersion: this.definition.save.formatVersion,
        configHash: this.configDigest,
      },
      this.definition.save.migrate
    );
    if (decision.decision === 'reject') {
      throw new SnapshotRejectedError(
        decision.reason ?? 'incompatible snapshot'
      );
    }
    this.rejectBackwardRestore(decoded.header.tick);
    const body =
      decision.decision === 'migrate'
        ? migrateBody(
            decoded.body,
            decoded.header.formatVersion,
            this.definition.save.formatVersion,
            this.definition.save.migrate ?? {}
          )
        : decoded.body;
    this.dropPendingDigests();
    this.resetModes();
    this.destroySim();
    this.random.setState(
      new DeterministicRandom(this.config.seed >>> 0).getState()
    );
    this.boot('restore');
    const reader = new BinaryStateReader(body);
    this.requireGameState().restore(reader);
    reader.done();
    if (this.roundTripCheck) {
      const again = new BinaryStateWriter();
      this.requireGameState().save(again);
      if (!sameBytes(again.finish(), body)) {
        throw new SnapshotRoundTripError();
      }
    }
    if (this.transportPaused) this.provider.firePause();
    this.completedTick = decoded.header.tick;
    this.commandLog.rewindTo(decoded.header.tick);
    this.pendingByTick.clear();
    this.nextSeq.clear();
    this.unsent = null;
    if (
      trustPeerState &&
      decoded.botState !== null &&
      decoded.botState.byteLength > 0
    ) {
      const reader = new BinaryStateReader(decoded.botState);
      this.botHost.restore(reader);
      reader.done();
    } else {
      this.syncHostedModes();
    }
    if (
      trustPeerState &&
      decoded.inputCheckpoint !== null &&
      decoded.inputCheckpoint.byteLength > 0
    ) {
      this.holdCheckpoint(decodeInputCheckpoint(decoded.inputCheckpoint));
    }
    if (this.transport instanceof LocalTransport) {
      this.transport.clearPending();
      this.transport.seek(decoded.header.tick + 1);
    }
    if (this.started) this.flushUnsent();
    this.syncTerminalPhase();
  }

  /**
   * Server snapshot, then the log through `currentTick - 1`. The runner
   * starts before the fast-forward, so live batches are buffered and
   * drained in order once it finishes.
   */
  private async applyCatchUp(catchUp: TransportCatchUp): Promise<void> {
    if (catchUp.snapshot !== undefined) {
      this.restoreBytes(catchUp.snapshot, false);
    }
    if (this.phase !== 'active') return;
    this.start();
    const throughTick = catchUp.currentTick - 1;
    if (throughTick > this.completedTick) {
      await this.fastForward(catchUp.log, {
        budgetMs: CATCH_UP_BUDGET_MS,
        throughTick,
      });
    }
  }

  private watchDesync(): void {
    const transport = this.transport;
    if (transport.onDesync === undefined) return;
    if (transport.requestResync === undefined) return;
    this.unsubDesync = transport.onDesync(() => {
      void this.resync();
    });
  }

  /** At most one resync in flight; reports land in the meantime are dropped. */
  private async resync(): Promise<void> {
    const request = this.transport.requestResync;
    if (this.resyncing || this.stopped || request === undefined) return;
    this.resyncing = true;
    try {
      const catchUp = await request.call(this.transport);
      if (this.stopped) return;
      await this.applyCatchUp(catchUp);
    } catch (error) {
      if (!this.stopped) this.errorListeners.emit(error, this.completedTick);
    } finally {
      this.resyncing = false;
    }
  }

  /**
   * A persisted journal still holds the abandoned timeline. Replaying an
   * older snapshot would let a later flush keep that timeline, and
   * `skipThrough` would drop the replacement ticks.
   */
  private rejectBackwardRestore(tick: number): void {
    const recorded = this.journal?.recordedThrough();
    if (recorded === undefined || tick >= recorded) return;
    throw new Error(
      `MatchRunner.restore: cannot rewind a persisted match from tick ${String(recorded)} to ${String(tick)}`
    );
  }

  /** `start` must refuse a match whose restored state is already terminal. */
  private syncTerminalPhase(): void {
    const outcome = this.definition.checkOutcome(this.sim);
    if (outcome !== null) {
      const alreadyEnded = this.phase === 'ended';
      this.phase = 'ended';
      if (!alreadyEnded) this.outcomeListeners.emit(outcome);
      return;
    }
    if (this.phase === 'ended') this.phase = 'active';
  }

  /** `digestBytes(GameState.save())` of the current tick. */
  public digest(): Digest {
    this.ensureLive();
    return this.computeDigest();
  }

  /**
   * Hash every captured body that is still waiting, in tick order, on
   * this stack. `LocalTransport.stepped()` does not call this.
   * Snapshot encoding stays on the journal's own off-tick turn.
   */
  public flush(): void {
    const jobs = this.pendingDigests.slice();
    for (const job of jobs) this.settleDigest(job);
  }

  /** Resolves when every periodic digest queued so far has been delivered. */
  public whenIdle(): Promise<void> {
    return this.digestIdle.then(() => undefined);
  }

  /**
   * Execute every tick after the current one through `options.throughTick`,
   * including ticks with no entries, without frames, in chunks of
   * `budgetMs`. Live batches that arrive meanwhile are buffered.
   *
   * Discards the restored input checkpoint (the log supersedes it). After
   * each replayed tick, hosted policies `decide`; a result is submitted
   * only when its target tick is past `throughTick`. `fromReplay` does not
   * use this path and never calls `decide`.
   *
   * Batches that arrive while this is running are buffered. When the range
   * finishes, batches at or before `throughTick` are dropped and the rest
   * run in tick order.
   */
  public async fastForward(
    entries: Iterable<LogEntry>,
    options: FastForwardOptions
  ): Promise<void> {
    this.ensureLive();
    if (this.fastForwarding) {
      throw new Error('MatchRunner.fastForward: already running');
    }
    if (
      typeof options.budgetMs !== 'number' ||
      Number.isNaN(options.budgetMs) ||
      options.budgetMs < 0
    ) {
      throw new Error(
        'MatchRunner.fastForward: budgetMs must be a non-negative number'
      );
    }
    if (!Number.isInteger(options.throughTick)) {
      throw new Error(
        `MatchRunner.fastForward: throughTick must be an integer, got ${String(options.throughTick)}`
      );
    }
    if (options.throughTick < this.completedTick) {
      throw new Error(
        `MatchRunner.fastForward: throughTick ${String(options.throughTick)} is below the current tick ${String(this.completedTick)}`
      );
    }
    const grouped = groupEntries(
      entries,
      this.completedTick,
      options.throughTick
    );
    const total = options.throughTick - this.completedTick;
    if (total === 0) {
      options.onProgress?.(1);
      this.catchUpListeners.emit(1);
      return;
    }
    this.discardSuperseded(options.throughTick);
    const plan: TickPlan = this.replayMode
      ? { decide: false }
      : { decide: true, submitAfter: options.throughTick };
    this.fastForwarding = true;
    let finished = false;
    let halted = false;
    try {
      const startTick = this.completedTick + 1;
      let next = startTick;
      while (next <= options.throughTick && !halted) {
        const startedAt = hostNowMs();
        do {
          if (this.phase !== 'active') {
            halted = true;
            break;
          }
          const list = grouped.get(next) ?? [];
          this.runPreparedTick(next, list, plan);
          next += 1;
        } while (
          next <= options.throughTick &&
          hostNowMs() - startedAt < options.budgetMs
        );
        const completed = next - startTick;
        const progress = completed >= total ? 1 : completed / total;
        options.onProgress?.(progress);
        this.catchUpListeners.emit(progress);
        if (!halted && next <= options.throughTick) await yieldEventLoop();
      }
      finished = !halted;
    } finally {
      this.fastForwarding = false;
      if (finished) {
        if (this.transport instanceof LocalTransport) {
          this.transport.seek(options.throughTick + 1);
        }
        this.drainBuffered(options.throughTick);
      }
    }
  }

  public toReplay(): ReplayRecord<ConfigOf<G>> {
    this.ensureLive();
    if (!this.commandLog.isComplete) {
      throw new Error(
        'MatchRunner.toReplay: command log is incomplete (restore or truncation dropped history)'
      );
    }
    const record: ReplayRecord<ConfigOf<G>> = {
      format: REPLAY_FORMAT,
      gameId: this.definition.id,
      simVersion: this.definition.simVersion,
      config: cloneConfig(this.config),
      log: this.commandLog.entriesAfter(-1),
      lastTick: this.completedTick,
    };
    if (this.completedTick < 0) return record;
    return { ...record, finalDigest: this.digest() };
  }

  public onTick(handler: (tick: number) => void): Unsubscribe {
    return this.tickListeners.add(handler);
  }

  /** Render frames; suppressed while fast-forwarding. */
  public onFrame(handler: (alpha: number, dt: number) => void): Unsubscribe {
    return this.frameListeners.add(handler);
  }

  public onOutcome(handler: (outcome: MatchOutcome) => void): Unsubscribe {
    return this.outcomeListeners.add(handler);
  }

  public onCatchUp(handler: (progress: number) => void): Unsubscribe {
    return this.catchUpListeners.add(handler);
  }

  public onDigest(
    handler: (tick: number, digest: Digest) => void
  ): Unsubscribe {
    return this.digestListeners.add(handler);
  }

  public onRejected(
    handler: (entry: LogEntry, reason: string) => void
  ): Unsubscribe {
    return this.rejectedListeners.add(handler);
  }

  /**
   * A tick threw after the transport had already advanced. The runner is
   * `'failed'` and the transport is stopped. Bot `decide` errors do not
   * come here: those are logged and that slot submits nothing.
   */
  public onError(handler: (error: unknown, tick: number) => void): Unsubscribe {
    return this.errorListeners.add(handler);
  }

  /**
   * The store rejected a header or command write, or a snapshot failed to
   * encode or to save. Snapshot failures leave the header and the command
   * tail committed. This is not {@link onError}: the match keeps running.
   */
  public onPersistenceError(handler: (error: unknown) => void): Unsubscribe {
    return this.persistenceErrorListeners.add(handler);
  }

  private onTransportTick(tick: number, batch: CommandsBatch): void {
    if (this.stopped || this.phase !== 'active') return;
    if (!this.started) {
      if (
        this.transport instanceof LocalTransport &&
        this.transport.isStepped
      ) {
        throw new Error(
          'MatchRunner: call start() before stepping a stepped transport'
        );
      }
      return;
    }
    if (this.fastForwarding) {
      this.bufferedTicks.push({ tick, batch });
      return;
    }
    const plan: TickPlan = this.replayMode
      ? { decide: false }
      : { decide: true };
    this.runTick(tick, batch, plan);
  }

  private onTransportFrame(alpha: number, dt: number): void {
    if (this.fastForwarding || !this.started || this.stopped) return;
    this.provider.emitFrame(alpha, dt);
    this.frameListeners.emit(alpha, dt);
  }

  private runTick(tick: number, batch: CommandsBatch, plan: TickPlan): void {
    // RoomSim is the only producer of `system` commands. A relay or
    // local client has no server peer and must not apply a batch copy.
    const serverPeer = this.hasServerPeer();
    const parsed = entriesFromBatch(
      tick,
      batch,
      this.slotByPlayerId,
      serverPeer
    );
    for (const entry of parsed.rejectedSystem) {
      this.rejectedListeners.emit(
        entry,
        'system command without a server peer'
      );
    }
    const localSystem = this.systemEntriesFor(tick);
    const seen = new Set(localSystem.map((entry) => entry.data.q));
    const batchSystem: LogEntry[] = [];
    const game: LogEntry[] = [];
    for (const entry of parsed.entries) {
      if (entry.playerId !== SYSTEM_PLAYER_ID) {
        game.push(entry);
        continue;
      }
      if (!serverPeer) {
        this.rejectedListeners.emit(
          entry,
          'system command without a server peer'
        );
        continue;
      }
      if (seen.has(entry.data.q)) continue;
      seen.add(entry.data.q);
      batchSystem.push(entry);
    }
    this.runPreparedTick(tick, [...localSystem, ...batchSystem, ...game], plan);
  }

  /** Tick body when the log entries are already known (fast-forward). */
  private runPreparedTick(
    tick: number,
    entries: readonly LogEntry[],
    plan: TickPlan
  ): void {
    if (this.phase !== 'active') {
      throw new Error(`MatchRunner: runner is ${this.phase}`);
    }
    if (this.executingTick !== null) {
      throw new Error('MatchRunner: re-entered a tick');
    }
    const expected = this.completedTick + 1;
    if (tick !== expected) {
      throw new Error(
        `MatchRunner: expected tick ${String(expected)}, received ${String(tick)}`
      );
    }
    this.executingTick = tick;
    if (this.transport instanceof LocalTransport) {
      this.transport.seek(tick + 1);
    }
    try {
      this.playEntries(tick, entries, plan);
    } catch (error) {
      this.fail(tick, error);
      // A live stepped transport reports the failure through onError and
      // does not rethrow from step(). fastForward, replay, and catch-up still
      // propagate, including a final-digest mismatch.
      if (!this.isLiveManualStep()) {
        throw error;
      }
    } finally {
      this.executingTick = null;
    }
  }

  private playEntries(
    tick: number,
    entries: readonly LogEntry[],
    plan: TickPlan
  ): void {
    this.commandLog.appendTick(tick, entries);
    this.noteDelivered(entries);
    this.noteLocalSeq(entries);
    this.noteSystemSeq(entries);
    this.applyEntries(tick, entries);
    this.provider.emitTick(tick);
    const outcome = this.definition.checkOutcome(this.sim);
    const endedNow = outcome !== null && this.phase === 'active';
    if (endedNow) this.phase = 'ended';
    if (plan.decide && this.phase === 'active') {
      this.decideHosted(tick, plan.submitAfter);
    }
    const hashDue = tick % this.hashEveryTicks === 0;
    const replayCheck =
      this.replayDigest !== undefined && tick === this.replayLastTick;
    let syncDigest: Digest | undefined;
    let deferredBody: Uint8Array | undefined;
    if (hashDue || replayCheck) {
      const shared = this.captureSharedSnapshotBody(tick);
      const body = shared ?? this.captureBody();
      // Replay's final check stays on the tick. A periodic hash does not.
      if (replayCheck) {
        syncDigest = digestBytes(body);
        if (syncDigest !== this.replayDigest) {
          throw new Error(
            `ReplayPlayer: final digest mismatch at tick ${String(tick)}`
          );
        }
      } else {
        deferredBody = body;
      }
    }
    this.completedTick = tick;
    // Journal before listeners. `dispose()` from a callback flushes
    // immediately, and a flush that runs first would miss this tick.
    if (this.stopped) {
      this.sharedSealBody = null;
      this.sharedSealMs = 0;
    } else {
      this.recordPersistence(tick, entries);
    }
    if (endedNow && outcome !== null) this.outcomeListeners.emit(outcome);
    if (syncDigest !== undefined && hashDue) {
      this.digestListeners.emit(tick, syncDigest);
      this.transport.submitHash?.(tick, syncDigest);
    } else if (deferredBody !== undefined) {
      this.enqueueDigest(tick, deferredBody);
    }
    this.tickListeners.emit(tick);
    if (this.phase === 'ended') this.stop();
  }

  /** True only for a transport-driven step of `LocalTransport.stepped()`. */
  private isLiveManualStep(): boolean {
    return (
      this.transport instanceof LocalTransport &&
      this.transport.isStepped &&
      !this.fastForwarding &&
      !this.replayMode
    );
  }

  private fail(tick: number, error: unknown): void {
    this.phase = 'failed';
    this.errorListeners.emit(error, tick);
    this.stop();
  }

  private decideHosted(tick: number, submitAfter: number | undefined): void {
    const delay = this.config.inputDelayTicks;
    for (const decision of this.botHost.decideAll(this.sim, tick)) {
      for (const command of decision.commands) {
        const target = tick + delay;
        if (submitAfter !== undefined && target <= submitAfter) {
          this.allocateSeq(decision.slot);
          continue;
        }
        this.enqueue(
          decision.slot,
          command,
          target,
          botPlayerId(decision.slot)
        );
      }
    }
  }

  private applyEntries(tick: number, entries: readonly LogEntry[]): void {
    for (const entry of entries) {
      if (entry.playerId === SYSTEM_PLAYER_ID) {
        this.applySystem(entry);
        continue;
      }
      const slot = this.slotByPlayerId.get(entry.playerId);
      const info = slot === undefined ? undefined : this.slotInfo.get(slot);
      if (slot === undefined || info === undefined) continue;
      if (entry.malformed === true) {
        this.rejectedListeners.emit(entry, 'malformed envelope');
        continue;
      }
      const mode = this.modes.get(slot);
      if (mode === 'bot' && !isBotPlayerId(entry.playerId)) {
        this.rejectedListeners.emit(entry, 'slot controlled by bot');
        continue;
      }
      if (mode === 'human' && isBotPlayerId(entry.playerId)) {
        this.rejectedListeners.emit(entry, 'slot controlled by human');
        continue;
      }
      const decoded = (() => {
        try {
          return this.definition.commands.decode(entry.data.p, info);
        } catch (error) {
          this.rejectedListeners.emit(
            entry,
            thrownReason(error, 'decode failed')
          );
          return undefined;
        }
      })();
      if (decoded === undefined) continue;
      if (isCommandRejection(decoded)) {
        this.rejectedListeners.emit(entry, decoded.reason);
        continue;
      }
      if (!this.commandTypes.has(decoded.type)) {
        this.rejectedListeners.emit(entry, 'unknown command');
        continue;
      }
      const validate = this.definition.commands.validate?.bind(
        this.definition.commands
      );
      if (validate) {
        try {
          const rejection = validate(decoded, info, this.sim);
          if (rejection !== null) {
            this.rejectedListeners.emit(entry, rejection.reason);
            continue;
          }
        } catch (error) {
          this.rejectedListeners.emit(
            entry,
            thrownReason(error, 'validate failed')
          );
          continue;
        }
      }
      const stamped: StampedCommand<CommandOf<G>> = {
        tick,
        slot,
        seq: entry.data.q,
        command: decoded as CommandOf<G>,
      };
      if (!this.dispatchCommand(stamped)) {
        this.rejectedListeners.emit(entry, 'no handler');
      }
    }
  }

  /**
   * Schedule a controller change. Applied at the start of `fromTick`,
   * before game commands, on live play, restore, fast-forward and replay.
   * Invalid requests are reported through `onRejected` and are not logged.
   */
  public setController(
    slot: number,
    mode: 'human' | 'bot',
    options?: { readonly fromTick?: number; readonly policy?: string }
  ): void {
    this.ensureLive();
    const now = this.executingTick ?? this.completedTick;
    const fromTick = options?.fromTick ?? now + this.config.inputDelayTicks;
    const reject = (reason: string): void => {
      this.rejectedListeners.emit(
        {
          tick: Number.isInteger(fromTick) && fromTick >= 0 ? fromTick : now,
          playerId: SYSTEM_PLAYER_ID,
          type: 'setController',
          data: {
            q: 0,
            p: { slot, mode },
          },
        },
        reason
      );
    };
    if (this.replayMode) {
      reject('replay cannot change controller');
      return;
    }
    const info = this.config.slots[slot];
    if (info === undefined || info.slot !== slot) {
      reject('unknown slot');
      return;
    }
    if (
      !Number.isInteger(fromTick) ||
      fromTick <= now ||
      fromTick > now + this.config.inputDelayTicks
    ) {
      reject('fromTick out of range');
      return;
    }
    if (this.scheduledMode(slot, fromTick) === mode) {
      reject(mode === 'bot' ? 'slot is already bot' : 'slot is already human');
      return;
    }
    const policy =
      options?.policy ?? (info.kind === 'bot' ? info.policy : undefined);
    if (mode === 'bot' && (policy === undefined || policy.length === 0)) {
      reject('missing policy');
      return;
    }
    const runsOn = this.runsOnForController(slot);
    if (!this.botHost.hostsRunsOn(runsOn)) {
      reject('not authoritative');
      return;
    }
    const level = info.kind === 'bot' ? info.level : 0;
    const payload: { [key: string]: JsonValue } = {
      level,
      mode,
      runsOn,
      slot,
    };
    if (policy !== undefined) payload['policy'] = policy;
    const entry: LogEntry = {
      tick: fromTick,
      playerId: SYSTEM_PLAYER_ID,
      type: 'setController',
      data: { q: this.systemSeq, p: canonicalJsonValue(payload) },
    };
    this.systemSeq += 1;
    this.remember(entry);
  }

  /**
   * A server peer is this runner (`side: 'server'`) or a transport whose
   * kind is `server-peer`. Relay and local matches have none.
   */
  private hasServerPeer(): boolean {
    return this.side === 'server' || this.transport.kind === 'server-peer';
  }

  /** Bot slots keep their configured host. Human handovers use the server when one exists. */
  private runsOnForController(slot: number): BotHostSide {
    const slotConfig = this.config.slots[slot];
    if (slotConfig !== undefined && slotConfig.kind === 'bot') {
      return slotConfig.runsOn;
    }
    return this.hasServerPeer() ? 'server' : 'local';
  }

  private assertServerBotsHavePeer(): void {
    if (this.hasServerPeer()) return;
    for (const slot of this.config.slots) {
      if (slot.kind === 'bot' && slot.runsOn === 'server') {
        throw new Error(
          `MatchRunner: slot ${String(slot.slot)} runsOn 'server' but this match has no server peer`
        );
      }
    }
  }

  private resetModes(): void {
    this.modes.clear();
    for (const slot of this.config.slots) {
      this.modes.set(slot.slot, slot.kind);
    }
  }

  /**
   * Fallback when a snapshot has no bot section. Mode follows the hosted
   * set for slots this runner actually runs.
   */
  private syncHostedModes(): void {
    for (const slot of this.config.slots) {
      if (slot.kind === 'bot' && !this.botHost.hostsRunsOn(slot.runsOn)) {
        continue;
      }
      if (slot.kind === 'human') {
        const own: BotHostSide = this.side === 'server' ? 'server' : 'local';
        if (!this.botHost.hostsRunsOn(own)) continue;
      }
      this.modes.set(slot.slot, this.botHost.has(slot.slot) ? 'bot' : 'human');
    }
  }

  private systemEntriesFor(tick: number): LogEntry[] {
    const pending = this.pendingByTick.get(tick);
    if (pending === undefined) return [];
    return pending.filter((entry) => entry.playerId === SYSTEM_PLAYER_ID);
  }

  /** Mode at `atTick` after every pending controller change up to that tick. */
  private scheduledMode(slot: number, atTick: number): 'human' | 'bot' {
    let mode = this.modes.get(slot) ?? 'human';
    const pending: LogEntry[] = [];
    for (const [tick, entries] of this.pendingByTick) {
      if (tick > atTick) continue;
      for (const entry of entries) {
        if (entry.playerId === SYSTEM_PLAYER_ID) pending.push(entry);
      }
    }
    pending.sort(
      (left, right) => left.tick - right.tick || left.data.q - right.data.q
    );
    for (const entry of pending) {
      const parsed = parseSystemPayload(entry.data.p);
      if (parsed === null || parsed.slot !== slot) continue;
      mode = parsed.mode;
    }
    return mode;
  }

  private applySystem(entry: LogEntry): void {
    const parsed = parseSystemPayload(entry.data.p);
    if (parsed === null) {
      this.rejectedListeners.emit(entry, 'malformed system command');
      return;
    }
    this.modes.set(parsed.slot, parsed.mode);
    if (!this.botHost.hostsRunsOn(parsed.runsOn)) return;
    if (parsed.mode === 'bot') {
      const policy = parsed.policy;
      if (policy === undefined) {
        this.rejectedListeners.emit(entry, 'missing policy');
        return;
      }
      const config = this.config.slots[parsed.slot];
      this.botHost.adopt({
        slot: parsed.slot,
        team: config === undefined ? 0 : config.team,
        policy,
        level: parsed.level,
        runsOn: parsed.runsOn,
      });
      return;
    }
    this.botHost.release(parsed.slot);
  }

  private dispatchCommand(stamped: StampedCommand<CommandOf<G>>): boolean {
    // AnyGameDefinition stores onCommand as object (a function or a map).
    const onCommand: unknown = this.definition.onCommand;
    const ctx: GameContext<SimOf<G>, ConfigOf<G>> = {
      world: this.sim.world,
      rng: this.random,
      config: this.config,
      slots: [...this.slotInfo.values()].sort(
        (left, right) => left.slot - right.slot
      ),
      purpose: this.bootPurpose,
      sim: this.sim,
    };
    if (typeof onCommand === 'function') {
      (
        onCommand as (
          context: GameContext<SimOf<G>, ConfigOf<G>>,
          command: StampedCommand<CommandOf<G>>
        ) => void
      )(ctx, stamped);
      return true;
    }
    if (typeof onCommand !== 'object' || onCommand === null) return false;
    // The map is exhaustive at defineGame time. Indexing by the decoded
    // type is the runtime half of that check.
    const handlers: Readonly<Record<string, unknown>> = onCommand as Readonly<
      Record<string, unknown>
    >;
    const handler = handlers[stamped.command.type];
    if (typeof handler !== 'function') return false;
    (
      handler as (
        context: GameContext<SimOf<G>, ConfigOf<G>>,
        command: StampedCommand<CommandOf<G>>
      ) => void
    )(ctx, stamped);
    return true;
  }

  private humanPlayerId(slot: number): string {
    const info = this.config.slots[slot];
    if (info !== undefined && info.kind === 'human') return info.playerId;
    return this.playerIdBySlot.get(slot) ?? `local:${String(slot)}`;
  }

  private enqueue(
    slot: number,
    command: CommandOf<G>,
    targetTick: number,
    playerId: string
  ): void {
    if (!Number.isInteger(targetTick) || targetTick < 0) {
      throw new Error(
        `MatchRunner.submit: target tick must be an integer >= 0, got ${String(targetTick)}`
      );
    }
    const seq = this.allocateSeq(slot);
    const entry = this.entryFor(slot, command, seq, targetTick, playerId);
    this.remember(entry);
    if (this.transport instanceof LocalTransport) {
      this.transport.assignPlayerId(slot, playerId);
    }
    this.transport.submit(targetTick, slot, [
      { type: entry.type, data: entry.data },
    ]);
  }

  private allocateSeq(slot: number): number {
    const seq = this.nextSeq.get(slot) ?? 0;
    this.nextSeq.set(slot, seq + 1);
    return seq;
  }

  private entryFor(
    _slot: number,
    command: CommandOf<G>,
    seq: number,
    tick: number,
    playerId: string
  ): LogEntry {
    const encode = this.definition.commands.encode?.bind(
      this.definition.commands
    );
    // Commands are JSON-safe when the game omits `encode` (the documented default).
    // Canonical key order matches the input-checkpoint round trip.
    const raw: JsonValue = encode
      ? encode(command)
      : (command as unknown as JsonValue);
    const payload = canonicalJsonValue(raw);
    return {
      tick,
      playerId,
      type: command.type,
      data: { q: seq, p: payload },
    };
  }

  private remember(entry: LogEntry): void {
    const list = this.pendingByTick.get(entry.tick);
    if (list === undefined) this.pendingByTick.set(entry.tick, [entry]);
    else list.push(entry);
  }

  /**
   * A submit is stored under its target tick, but the transport may deliver
   * it in a later batch. Drop the `(playerId, q)` pair from every bucket.
   */
  private noteDelivered(entries: readonly LogEntry[]): void {
    if (entries.length === 0) return;
    const delivered = new Set(
      entries.map((entry) => `${entry.playerId}:${String(entry.data.q)}`)
    );
    for (const [tick, pending] of this.pendingByTick) {
      const rest = pending.filter(
        (entry) => !delivered.has(`${entry.playerId}:${String(entry.data.q)}`)
      );
      if (rest.length === pending.length) continue;
      if (rest.length === 0) this.pendingByTick.delete(tick);
      else this.pendingByTick.set(tick, rest);
    }
  }

  /**
   * A replayed system command may sit at or past the restored counter
   * (the log tail after the snapshot). The next assignment stays above it.
   */
  private noteSystemSeq(entries: readonly LogEntry[]): void {
    for (const entry of entries) {
      if (entry.playerId !== SYSTEM_PLAYER_ID) continue;
      const next = entry.data.q + 1;
      if (next > this.systemSeq) this.systemSeq = next;
    }
  }

  /** Catch-up applies logged human commands without going through `enqueue`. */
  private noteLocalSeq(entries: readonly LogEntry[]): void {
    for (const entry of entries) {
      const slot = this.slotByPlayerId.get(entry.playerId);
      if (slot === undefined || !this.localSlotSet.has(slot)) continue;
      const deliveredNext = entry.data.q + 1;
      const current = this.nextSeq.get(slot) ?? 0;
      if (deliveredNext > current) this.nextSeq.set(slot, deliveredNext);
    }
  }

  private holdCheckpoint(checkpoint: InputCheckpoint): void {
    const unsent: LogEntry[] = [];
    for (const batch of checkpoint.pending) {
      const entries = batch.entries.filter(
        (entry) =>
          entry.playerId === SYSTEM_PLAYER_ID || this.ownsPlayer(entry.playerId)
      );
      if (entries.length === 0) continue;
      for (const entry of entries) {
        this.remember(entry);
        unsent.push(entry);
      }
    }
    for (const seq of checkpoint.nextSeq) {
      if (this.ownsSlot(seq.slot)) this.nextSeq.set(seq.slot, seq.nextSeq);
    }
    this.systemSeq = checkpoint.systemSeq;
    this.unsent = unsent;
  }

  /**
   * Drop queued commands that the log will execute (`tick <= throughTick`).
   * Commands still in the future stay queued. If the clock is already
   * started they are sent again, because `start` will not run a second time.
   */
  private discardSuperseded(throughTick: number): void {
    const kept: LogEntry[] = [];
    for (const [tick, entries] of this.pendingByTick) {
      if (tick <= throughTick) continue;
      for (const entry of entries) kept.push(entry);
    }
    this.pendingByTick.clear();
    for (const entry of kept) this.remember(entry);
    this.unsent = kept.length > 0 ? kept.slice() : null;
    if (this.transport instanceof LocalTransport) this.transport.clearPending();
    if (this.started) this.flushUnsent();
  }

  private flushUnsent(): void {
    const entries = this.unsent;
    if (entries === null) return;
    this.unsent = null;
    for (const entry of entries) {
      if (entry.playerId === SYSTEM_PLAYER_ID) continue;
      const slot = this.slotByPlayerId.get(entry.playerId);
      if (slot === undefined) continue;
      if (this.transport instanceof LocalTransport) {
        this.transport.assignPlayerId(slot, entry.playerId);
      }
      this.transport.submit(entry.tick, slot, [
        { type: entry.type, data: entry.data },
      ]);
    }
  }

  private attachPersistence(): void {
    if (!(this.transport instanceof LocalTransport)) return;
    const store = this.transport.matchStore;
    if (store === undefined) return;
    const journal = new MatchJournal(
      store,
      this.config.matchId,
      this.config,
      this.transport.snapshotEveryTicks,
      {
        engineFormat: ENGINE_SNAPSHOT_FORMAT,
        gameId: this.definition.id,
        simVersion: this.definition.simVersion,
        formatVersion: this.definition.save.formatVersion,
        configHash: this.configDigest,
        componentSchemas: this.componentSchemaKey,
      },
      () => this.sealSnapshotInputs(),
      (error: unknown) => {
        this.persistenceErrorListeners.emit(error);
      }
    );
    this.journal = journal;
    this.unsubFlush = this.transport.onPersistenceFlush((reason) => {
      this.persistDone = this.track(journal.flush(this.flushIsUrgent(reason)));
    });
  }

  private flushIsUrgent(reason: PersistenceFlushReason): boolean {
    return reason === 'hide' || reason === 'pagehide';
  }

  /**
   * World body, bot section, and input checkpoint for this tick. The body
   * buffer is the one `finish()` returned; the journal must not copy it.
   * When this tick was also hashed, the body is the buffer already passed
   * to `digestBytes`. `encodeSnapshot` (and its digest) runs later, off
   * the tick.
   */
  private sealSnapshotInputs(): SealedSnapshot {
    const shared = this.sharedSealBody;
    this.sharedSealBody = null;
    let body: Uint8Array;
    if (shared !== null) {
      body = shared;
    } else {
      body = this.captureBody();
    }
    const botWriter = new BinaryStateWriter();
    this.botHost.save(botWriter);
    return {
      tick: this.completedTick,
      body,
      botState: botWriter.finish(),
      inputCheckpoint: encodeInputCheckpoint({
        pending: this.pendingBatches(),
        nextSeq: this.sequenceSnapshot(),
        systemSeq: this.systemSeq,
      }),
    };
  }

  /**
   * Save once when this tick publishes a digest and also seals a snapshot.
   * Returns that body, or null when the tick is not both.
   */
  private captureSharedSnapshotBody(tick: number): Uint8Array | null {
    if (!this.persistenceSnapshotDue(tick)) return null;
    const started = readHostNow();
    const body = this.captureBody();
    this.sharedSealBody = body;
    this.sharedSealMs = readHostNow() - started;
    return body;
  }

  /** Immutable world body. The writer buffer is kept for the next capture. */
  private captureBody(): Uint8Array {
    this.captureWriter.reset();
    this.requireGameState().save(this.captureWriter);
    return this.captureWriter.finish();
  }

  private enqueueDigest(tick: number, body: Uint8Array): void {
    const job: PendingDigest = { tick, body, settled: false };
    this.pendingDigests.push(job);
    const scheduled = scheduleOffTick(() => {
      this.settleDigest(job);
    });
    const idle = this.digestIdle;
    // settleDigest reports a listener throw through onError. If that
    // report itself throws, this catch keeps the idle chain handled.
    this.digestIdle = idle.then(() => scheduled.catch(() => undefined));
  }

  private settleDigest(job: PendingDigest): void {
    if (job.settled) return;
    job.settled = true;
    const index = this.pendingDigests.indexOf(job);
    if (index !== -1) this.pendingDigests.splice(index, 1);
    if (this.stopped || this.phase === 'failed') return;
    try {
      const digest = digestBytes(job.body);
      this.digestListeners.emit(job.tick, digest);
      this.transport.submitHash?.(job.tick, digest);
    } catch (error) {
      this.fail(job.tick, error);
    }
  }

  private dropPendingDigests(): void {
    for (const job of this.pendingDigests) job.settled = true;
    this.pendingDigests.length = 0;
  }

  private persistenceSnapshotDue(tick: number): boolean {
    // False for ticks `skipThrough` already stored, so catch-up does not
    // save a snapshot body the journal will drop.
    return this.journal?.willSnapshot(tick) ?? false;
  }

  private recordPersistence(tick: number, entries: readonly LogEntry[]): void {
    const journal = this.journal;
    if (journal === null) {
      this.sharedSealBody = null;
      this.sharedSealMs = 0;
      return;
    }
    try {
      const sample = journal.noteTick(tick, entries);
      this.persistenceSyncMs = sample.syncMs + this.sharedSealMs;
      this.persistenceSnapshotted = sample.snapshotted;
    } finally {
      this.sharedSealBody = null;
      this.sharedSealMs = 0;
    }
  }

  private track(work: Promise<void>): Promise<void> {
    void work.then(
      () => undefined,
      (error: unknown) => {
        this.persistenceErrorListeners.emit(error);
      }
    );
    return work;
  }

  private captureSnapshot(): SnapshotBytes {
    const bodyWriter = new BinaryStateWriter();
    this.requireGameState().save(bodyWriter);
    const body = bodyWriter.finish();
    const botWriter = new BinaryStateWriter();
    this.botHost.save(botWriter);
    const botState = botWriter.finish();
    const inputCheckpoint = encodeInputCheckpoint({
      pending: this.pendingBatches(),
      nextSeq: this.sequenceSnapshot(),
      systemSeq: this.systemSeq,
    });
    return encodeSnapshot(
      {
        engineFormat: ENGINE_SNAPSHOT_FORMAT,
        gameId: this.definition.id,
        simVersion: this.definition.simVersion,
        formatVersion: this.definition.save.formatVersion,
        configHash: this.configDigest,
        tick: this.completedTick,
      },
      body,
      {
        botState,
        inputCheckpoint,
        componentSchemas: this.componentSchemaKey,
      }
    );
  }

  private pendingBatches(): PendingCommandBatch[] {
    const batches: PendingCommandBatch[] = [];
    for (const [tick, entries] of this.pendingByTick) {
      if (entries.length > 0) batches.push({ tick, entries: entries.slice() });
    }
    return batches;
  }

  private sequenceSnapshot(): SlotSequence[] {
    const slots = new Set<number>(this.localSlots);
    for (const slot of this.botHost.slots) slots.add(slot);
    for (const slot of this.nextSeq.keys()) slots.add(slot);
    return [...slots]
      .sort((a, b) => a - b)
      .map((slot) => ({ slot, nextSeq: this.nextSeq.get(slot) ?? 0 }));
  }

  private computeDigest(): Digest {
    const writer = new BinaryStateWriter();
    this.requireGameState().save(writer);
    return digestBytes(writer.finish());
  }

  private boot(purpose: 'fresh' | 'restore'): void {
    this.bootPurpose = purpose;
    const world = new GameWorld({
      tickFrameProvider: this.provider,
      random: this.random,
      pooling: this.definition.pooling,
    });
    for (const component of this.definition.components ?? []) {
      // GameComponent is the structural shape of a defineComponent result.
      // SoASchema is invariant, so the registry's parameter is a wider
      // ComponentRegistration than the value's schema.
      world.registerComponent(component as unknown as ComponentRegistration);
    }
    let opened = false;
    const startCtx: StartContext<ConfigOf<G>> = {
      world,
      rng: this.random,
      config: this.config,
      slots: [...this.slotInfo.values()].sort(
        (left, right) => left.slot - right.slot
      ),
      purpose,
      open: () => {
        if (opened) return;
        opened = true;
        for (const create of this.definition.systems ?? []) {
          world.addSystem(create(), { phase: 'late' });
        }
        for (const create of this.definition.frameSystems ?? []) {
          world.addSystem(create(), { phase: 'render' });
        }
        world.start();
      },
    };
    const returned = this.definition.onStart?.(startCtx);
    if (!opened) startCtx.open();
    const sim = (returned === undefined ? { world } : returned) as SimOf<G>;
    this.simulation = sim;
    this.gameState = this.definition.save.handler(sim);
  }

  private destroySim(): void {
    const sim = this.simulation;
    if (sim === null) return;
    this.simulation = null;
    this.gameState = null;
    sim.dispose?.();
    sim.world.dispose();
  }

  private requireGameState(): SaveHandler {
    if (this.gameState === null) {
      throw new Error('MatchRunner: simulation is disposed');
    }
    return this.gameState;
  }

  private resolveHumanSlot(slot: number | undefined): number {
    if (slot === undefined) {
      if (this.localSlots.length !== 1) {
        throw new Error(
          'MatchRunner.submit: slot is required when several human slots are local'
        );
      }
      const only = this.localSlots[0];
      if (only === undefined) {
        throw new Error('MatchRunner.submit: no local human slot');
      }
      return only;
    }
    if (!this.localSlotSet.has(slot)) {
      throw new Error(
        `MatchRunner.submit: slot ${String(slot)} is not a local human slot`
      );
    }
    return slot;
  }

  private ownsSlot(slot: number): boolean {
    return this.localSlotSet.has(slot) || this.botSlotSet.has(slot);
  }

  private ownsPlayer(playerId: string): boolean {
    const slot = this.slotByPlayerId.get(playerId);
    return slot !== undefined && this.ownsSlot(slot);
  }

  /** Drop buffered batches the replay already covered; run the rest in order. */
  private drainBuffered(throughTick: number): void {
    const queued = this.bufferedTicks.splice(0);
    queued.sort((a, b) => a.tick - b.tick);
    for (const item of queued) {
      if (item.tick <= throughTick) continue;
      this.onTransportTick(item.tick, item.batch);
    }
  }

  private ensureLive(): void {
    if (this.stopped || this.simulation === null) {
      throw new Error('MatchRunner: runner is disposed');
    }
    if (this.phase === 'failed') {
      throw new Error('MatchRunner: runner has failed');
    }
  }
}

class RunnerProvider implements ITickFrameProvider {
  private readonly tickHandlers: TickHandler[] = [];
  private readonly frameHandlers: FrameHandler[] = [];
  private readonly pauseHandlers: PauseHandler[] = [];
  private readonly resumeHandlers: PauseHandler[] = [];

  public constructor(private readonly transport: Transport) {}

  public onTick(handler: TickHandler): Unsubscribe {
    this.tickHandlers.push(handler);
    return () => {
      remove(this.tickHandlers, handler);
    };
  }

  public onFrame(handler: FrameHandler): Unsubscribe {
    this.frameHandlers.push(handler);
    return () => {
      remove(this.frameHandlers, handler);
    };
  }

  public onPause(handler: PauseHandler): Unsubscribe {
    this.pauseHandlers.push(handler);
    return () => {
      remove(this.pauseHandlers, handler);
    };
  }

  public onResume(handler: PauseHandler): Unsubscribe {
    this.resumeHandlers.push(handler);
    return () => {
      remove(this.resumeHandlers, handler);
    };
  }

  public requestPause(): void {
    if (!this.transport.requestPause) {
      throw new Error('MatchRunner: transport does not support pause');
    }
    this.transport.requestPause();
  }

  public requestResume(): void {
    if (!this.transport.requestResume) {
      throw new Error('MatchRunner: transport does not support resume');
    }
    this.transport.requestResume();
  }

  public emitTick(tick: number): void {
    const batch: CommandsBatch = { tick, commands: emptyCommands() };
    for (const handler of this.tickHandlers.slice()) handler(tick, batch);
  }

  public emitFrame(alpha: number, dt: number): void {
    for (const handler of this.frameHandlers.slice()) handler(alpha, dt);
  }

  public firePause(): void {
    for (const handler of this.pauseHandlers.slice()) handler();
  }

  public fireResume(): void {
    for (const handler of this.resumeHandlers.slice()) handler();
  }
}

interface PendingDigest {
  readonly tick: number;
  readonly body: Uint8Array;
  settled: boolean;
}

class Emitter<A extends unknown[]> {
  private readonly handlers: ((...args: A) => void)[] = [];

  public add(handler: (...args: A) => void): Unsubscribe {
    this.handlers.push(handler);
    return () => {
      remove(this.handlers, handler);
    };
  }

  public emit(...args: A): void {
    for (const handler of this.handlers.slice()) handler(...args);
  }
}

function remove<T>(handlers: T[], handler: T): void {
  const index = handlers.indexOf(handler);
  if (index !== -1) handlers.splice(index, 1);
}

/**
 * `side` names the local peer. It is not part of the shared match, so a
 * client and a server of one match accept each other's snapshots.
 */
function hashMatchConfig(
  config: MatchConfigBase,
  components?: readonly ComponentSchemaHash[],
  commands?: readonly CommandSchemaHash[],
  systems?: {
    readonly tick: readonly string[];
    readonly frame: readonly string[];
  }
): Digest {
  const { side: _side, ...shared } = config;
  return configHash(shared, components, commands, systems);
}

function readHostNow(): number {
  try {
    return wallClock().performance.now();
  } catch {
    return 0;
  }
}

function resolveHashEvery(value: number | undefined): number {
  const every = value ?? DEFAULT_HASH_EVERY_TICKS;
  if (!Number.isInteger(every) || every < 1) {
    throw new Error(
      `MatchRunner: hashEveryTicks must be an integer >= 1, got ${String(value)}`
    );
  }
  return every;
}

/** Runner input. Identity fields and the input delay are filled when omitted. */
export type ConfigInput<G extends AnyGameDefinition> = Omit<
  ConfigOf<G>,
  'gameId' | 'simVersion' | 'inputDelayTicks' | 'matchId'
> & {
  readonly matchId?: string;
  readonly gameId?: string;
  readonly simVersion?: string;
  readonly inputDelayTicks?: number;
};

function normalizeConfig<G extends AnyGameDefinition>(
  definition: G,
  config: ConfigInput<G>
): ConfigOf<G> {
  const matchId = config.matchId ?? 'local';
  const gameId = config.gameId ?? definition.id;
  if (gameId !== definition.id) {
    throw new Error(
      `MatchRunner: config.gameId '${gameId}' does not match game '${definition.id}'`
    );
  }
  const simVersion = config.simVersion ?? definition.simVersion;
  if (simVersion !== definition.simVersion) {
    throw new Error(
      `MatchRunner: config.simVersion '${simVersion}' does not match '${definition.simVersion}'`
    );
  }
  const inputDelayTicks = config.inputDelayTicks ?? DEFAULT_INPUT_DELAY_TICKS;
  // Game configs add fields. The filled identity is the normalized config.
  return {
    ...config,
    matchId,
    gameId,
    simVersion,
    inputDelayTicks,
  } as ConfigOf<G>;
}

interface SystemPayload {
  readonly slot: number;
  readonly mode: 'human' | 'bot';
  readonly level: number;
  readonly runsOn: BotHostSide;
  readonly policy?: string;
}

function parseSystemPayload(raw: JsonValue): SystemPayload | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const record = raw as { readonly [key: string]: JsonValue | undefined };
  const slot = record['slot'];
  const mode = record['mode'];
  const level = record['level'];
  const runsOn = record['runsOn'];
  const policy = record['policy'];
  if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0) {
    return null;
  }
  if (mode !== 'human' && mode !== 'bot') return null;
  if (typeof level !== 'number' || !Number.isInteger(level) || level < 0) {
    return null;
  }
  if (runsOn !== 'local' && runsOn !== 'server') return null;
  if (policy !== undefined && typeof policy !== 'string') return null;
  if (mode === 'bot' && (typeof policy !== 'string' || policy.length === 0)) {
    return null;
  }
  if (policy === undefined) {
    return { slot, mode, level, runsOn };
  }
  return { slot, mode, level, runsOn, policy };
}

function validateConfig<G extends AnyGameDefinition>(
  definition: G,
  config: ConfigOf<G>
): void {
  if (config.gameId !== definition.id) {
    throw new Error(
      `MatchRunner: config.gameId '${config.gameId}' does not match game '${definition.id}'`
    );
  }
  if (config.simVersion !== definition.simVersion) {
    throw new Error(
      `MatchRunner: config.simVersion '${config.simVersion}' does not match '${definition.simVersion}'`
    );
  }
  if (
    !Number.isInteger(config.seed) ||
    config.seed < 0 ||
    config.seed > 0xffffffff
  ) {
    throw new Error(
      `MatchRunner: seed must be an integer in 0..2^32-1, got ${String(config.seed)}`
    );
  }
  if (!Number.isInteger(config.inputDelayTicks) || config.inputDelayTicks < 1) {
    throw new Error(
      `MatchRunner: inputDelayTicks must be an integer >= 1, got ${String(config.inputDelayTicks)}`
    );
  }
  if (config.slots.length === 0) {
    throw new Error('MatchRunner: at least one slot is required');
  }
  for (let index = 0; index < config.slots.length; index += 1) {
    const slot = config.slots[index];
    if (slot === undefined || slot.slot !== index) {
      throw new Error(
        'MatchRunner: slots must be contiguous and sorted from 0'
      );
    }
    if (slot.kind === 'human' && slot.playerId === SYSTEM_PLAYER_ID) {
      throw new Error(
        `MatchRunner: player id '${SYSTEM_PLAYER_ID}' is reserved (slot ${String(slot.slot)})`
      );
    }
  }
}

function resolveLocalSlots<G extends AnyGameDefinition>(
  config: ConfigOf<G>,
  transport: Transport,
  requested: readonly number[] | undefined
): number[] {
  const humans: number[] = [];
  for (const slot of config.slots) {
    if (slot.kind === 'human') humans.push(slot.slot);
  }
  const slots =
    requested !== undefined
      ? [...requested]
      : transport.kind === 'local'
        ? humans
        : [];
  for (const slot of slots) {
    const info = config.slots[slot];
    if (info === undefined || info.kind !== 'human' || info.slot !== slot) {
      throw new Error(
        `MatchRunner: local slot ${String(slot)} is not a human slot`
      );
    }
  }
  return slots;
}

function indexSlots(
  slots: readonly SlotConfig[],
  slotByPlayerId: Map<string, number>,
  playerIdBySlot: Map<number, string>,
  slotInfo: Map<number, SlotInfo>
): void {
  for (const slot of slots) {
    const playerId =
      slot.kind === 'human' ? slot.playerId : botPlayerId(slot.slot);
    if (slotByPlayerId.has(playerId)) {
      throw new Error(`MatchRunner: duplicate player id '${playerId}'`);
    }
    slotByPlayerId.set(playerId, slot.slot);
    playerIdBySlot.set(slot.slot, playerId);
    slotInfo.set(slot.slot, toSlotInfo(slot, playerId));
    if (slot.kind === 'human') {
      const botId = botPlayerId(slot.slot);
      if (!slotByPlayerId.has(botId)) slotByPlayerId.set(botId, slot.slot);
    }
  }
}

function toSlotInfo(slot: SlotConfig, playerId: string): SlotInfo {
  if (slot.kind === 'bot') {
    const info: BotSlotInfo = {
      slot: slot.slot,
      team: slot.team,
      kind: 'bot',
      playerId,
      policy: slot.policy,
      level: slot.level,
    };
    return info;
  }
  return {
    slot: slot.slot,
    team: slot.team,
    kind: 'human',
    playerId,
  };
}

/**
 * Player ids are untrusted strings (`__proto__`, `constructor`). A null
 * prototype keeps those keys as own data properties.
 */
function emptyCommands(): CommandsBatch['commands'] {
  return Object.create(null) as CommandsBatch['commands'];
}

export function entriesFromBatch(
  tick: number,
  batch: CommandsBatch,
  slotByPlayerId: ReadonlyMap<string, number>,
  acceptSystem: boolean
): { entries: LogEntry[]; rejectedSystem: LogEntry[] } {
  const ranked: {
    slot: number;
    seq: number;
    index: number;
    entry: LogEntry;
  }[] = [];
  const rejectedSystem: LogEntry[] = [];
  let index = 0;
  for (const playerId of Object.keys(batch.commands)) {
    const commands = batch.commands[playerId];
    if (commands === undefined) continue;
    if (playerId === SYSTEM_PLAYER_ID) {
      for (const command of commands) {
        const envelope = readEnvelope(command.data);
        const entry: LogEntry =
          envelope === null
            ? {
                tick,
                playerId,
                type: typeof command.type === 'string' ? command.type : '',
                data: { q: 0, p: null },
                malformed: true,
              }
            : {
                tick,
                playerId,
                type: command.type,
                data: { q: envelope.q, p: canonicalJsonValue(envelope.p) },
              };
        if (!acceptSystem) {
          rejectedSystem.push(entry);
          continue;
        }
        ranked.push({
          slot: -1,
          seq: envelope === null ? 0 : envelope.q,
          index,
          entry,
        });
        index += 1;
      }
      continue;
    }
    const slot = slotByPlayerId.get(playerId);
    if (slot === undefined) continue;
    for (const command of commands) {
      const envelope = readEnvelope(command.data);
      if (envelope === null) {
        ranked.push({
          slot,
          seq: 0,
          index,
          entry: {
            tick,
            playerId,
            type: typeof command.type === 'string' ? command.type : '',
            data: { q: 0, p: null },
            malformed: true,
          },
        });
        index += 1;
        continue;
      }
      ranked.push({
        slot,
        seq: envelope.q,
        index,
        entry: {
          tick,
          playerId,
          type: command.type,
          data: { q: envelope.q, p: canonicalJsonValue(envelope.p) },
        },
      });
      index += 1;
    }
  }
  ranked.sort((a, b) => a.slot - b.slot || a.seq - b.seq || a.index - b.index);
  return {
    entries: ranked.map((item) => item.entry),
    rejectedSystem,
  };
}

function readEnvelope(data: unknown): CommandEnvelope | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as { q?: unknown; p?: unknown };
  if (
    typeof record.q !== 'number' ||
    !Number.isInteger(record.q) ||
    record.q < 0
  ) {
    return null;
  }
  if (!isJsonValue(record.p)) return null;
  return { q: record.q, p: record.p };
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object':
      break;
    default:
      return false;
  }
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item));
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.values(value as { [key: string]: unknown }).every((item) =>
    isJsonValue(item)
  );
}

function groupEntries(
  entries: Iterable<LogEntry>,
  currentTick: number,
  throughTick: number
): Map<number, LogEntry[]> {
  const grouped = new Map<number, LogEntry[]>();
  for (const entry of entries) {
    if (
      !Number.isInteger(entry.tick) ||
      entry.tick <= currentTick ||
      entry.tick > throughTick
    ) {
      throw new Error(
        `MatchRunner.fastForward: entry tick ${String(entry.tick)} is outside (${String(currentTick)}, ${String(throughTick)}]`
      );
    }
    const list = grouped.get(entry.tick);
    if (list === undefined) grouped.set(entry.tick, [entry]);
    else list.push(entry);
  }
  return grouped;
}

function migrateBody(
  body: Uint8Array,
  fromVersion: number,
  toVersion: number,
  migrations: Readonly<Record<number, StateMigration>>
): Uint8Array {
  let current = body;
  for (let version = fromVersion; version < toVersion; version += 1) {
    const step = migrations[version];
    if (step === undefined) {
      throw new SnapshotRejectedError(
        `missing migration from format ${String(version)}`
      );
    }
    const reader = new BinaryStateReader(current);
    const writer = new BinaryStateWriter();
    step(reader, writer);
    reader.done();
    current = writer.finish();
  }
  return current;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function thrownReason(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

function cloneConfig<T>(config: T): T {
  // Match configs are JSON-safe with integer numbers only.
  return JSON.parse(JSON.stringify(config)) as T;
}

function hostNowMs(): number {
  return wallClock().performance.now();
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    // Prefer MessageChannel; setTimeout(0) covers hosts that lack it.
    const host = wallClock();
    const Channel = host.MessageChannel;
    if (Channel !== undefined) {
      const channel = new Channel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(null);
      return;
    }
    host.setTimeout(resolve, 0);
  });
}
