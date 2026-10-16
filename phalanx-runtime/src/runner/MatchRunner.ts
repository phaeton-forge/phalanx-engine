import type {
  CommandsBatch,
  FrameHandler,
  IRandom,
  ITickFrameProvider,
  PauseHandler,
  TickHandler,
  Unsubscribe,
} from '@phalanx-engine/ecs';
import { DeterministicRandom } from '@phalanx-engine/math';
import {
  DEFAULT_HASH_EVERY_TICKS,
  ENGINE_SNAPSHOT_FORMAT,
  REPLAY_FORMAT,
  botPlayerId,
} from '../constants.js';
import {
  isCommandRejection,
  type CommandEnvelope,
  type JsonValue,
} from '../game/commands.js';
import type {
  AnyGameDefinition,
  CommandOf,
  ConfigOf,
  MatchOutcome,
  SimOf,
} from '../game/GameDefinition.js';
import type { BotSlotInfo, SlotConfig, SlotInfo } from '../game/MatchConfig.js';
import { notImplemented } from '../notImplemented.js';
import { BinaryStateReader, BinaryStateWriter } from '../state/BinaryState.js';
import type { GameState, StateMigration } from '../state/GameState.js';
import {
  SnapshotRejectedError,
  SnapshotRoundTripError,
} from '../state/errors.js';
import {
  checkSnapshotCompatibility,
  configHash,
  decodeSnapshot,
  digestBytes,
  encodeSnapshot,
  type Digest,
  type SnapshotBytes,
} from '../state/snapshot.js';
import { wallClock } from '../host/wallClock.js';
import { LocalTransport } from '../transport/LocalTransport.js';
import type { Transport } from '../transport/Transport.js';
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
import { WorldScope } from './WorldScope.js';

/** Which bot slots a runner hosts: `'client'` → `runsOn: 'local'`. */
export type RunnerSide = 'client' | 'server';

/**
 * `'ready'` before `start`, `'running'` while the clock is going,
 * `'ended'` after the first non-null outcome, `'failed'` after a tick
 * threw, `'disposed'` after `dispose`.
 */
export type RunnerStatus =
  'ready' | 'running' | 'ended' | 'failed' | 'disposed';

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

interface TickPlan {
  readonly decide: boolean;
  /** When set, decisions whose target tick is `<=` this value are not sent. */
  readonly submitAfter?: number;
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
 *  5. hosted bots `decide(sim, T)` while the match is still active, submitted
 *     for `T + inputDelayTicks` (the input checkpoint);
 *  6. advance the completed tick, then publish `outcome` and the digest.
 */
export class MatchRunner<G extends AnyGameDefinition> {
  private readonly definition: G;
  private readonly config: ConfigOf<G>;
  private readonly transport: Transport;
  private readonly side: RunnerSide;
  private readonly hashEveryTicks: number;
  private readonly roundTripCheck: boolean;
  private readonly localSlots: readonly number[];
  private readonly localSlotSet: ReadonlySet<number>;
  private readonly botSlotSet: ReadonlySet<number>;
  private readonly configDigest: Digest;
  private readonly scope = new WorldScope();
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
  private gameState: GameState | null = null;
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

  public constructor(
    definition: G,
    config: ConfigOf<G>,
    transport: Transport,
    options?: RunnerOptions
  ) {
    this.definition = definition;
    this.config = config;
    this.transport = transport;
    this.side = options?.side ?? 'client';
    this.hashEveryTicks = resolveHashEvery(options?.hashEveryTicks);
    this.roundTripCheck = options?.roundTripCheck ?? true;
    this.configDigest = configHash(config);
    validateConfig(definition, config);
    this.localSlots = resolveLocalSlots(config, transport, options?.localSlots);
    this.localSlotSet = new Set(this.localSlots);
    this.commandTypes = new Set(definition.commands.types);
    indexSlots(
      config.slots,
      this.slotByPlayerId,
      this.playerIdBySlot,
      this.slotInfo
    );
    this.random = new DeterministicRandom(config.seed >>> 0);
    this.provider = new RunnerProvider(this.random, transport);
    this.botHost = new BotHost(definition, config, this.side);
    this.botSlotSet = new Set(this.botHost.slots);
    if (transport instanceof LocalTransport) {
      if (!transport.isManual && transport.tickRate !== definition.tickRate) {
        throw new Error(
          `MatchRunner: LocalTransport tickRate ${String(transport.tickRate)} does not match game tickRate ${String(definition.tickRate)}`
        );
      }
      transport.bindSlots(
        config.slots.map((slot) => ({
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
    this.scope.run(() => {
      this.boot('fresh');
    });
    const names =
      this.simulation === null ? [] : this.simulation.world.componentNames();
    this.configDigest = configHash(this.config, names);
  }

  /** Join (or resume) through a network transport's `join()`. */
  public static join<GDef extends AnyGameDefinition>(
    _definition: GDef,
    _transport: Transport,
    _options?: RunnerOptions
  ): Promise<MatchRunner<GDef>> {
    return notImplemented('MatchRunner.join', 12);
  }

  /**
   * Runner positioned at tick `-1` in replay mode. Hosted policies are never
   * asked to `decide`. Drive it only with `fastForward(replay.log, {
   * throughTick: replay.lastTick })`. `start()` throws: a replay has no
   * live clock.
   */
  public static fromReplay<GDef extends AnyGameDefinition>(
    definition: GDef,
    replay: ReplayRecord<ConfigOf<GDef>>,
    options?: RunnerOptions
  ): MatchRunner<GDef> {
    assertReplayRecord(definition, replay);
    const runner = new MatchRunner(
      definition,
      replay.config,
      LocalTransport.manual(),
      options
    );
    runner.replayMode = true;
    runner.replayDigest = replay.finalDigest;
    runner.replayLastTick = replay.lastTick;
    return runner;
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

  public start(): void {
    if (this.replayMode) {
      throw new Error(
        'MatchRunner.fromReplay: drive the runner with fastForward(replay.log, { throughTick: replay.lastTick })'
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
    this.unsubTick();
    this.unsubFrame();
    this.unsubPause();
    this.unsubResume();
    this.transport.dispose?.();
    this.scope.run(() => {
      this.destroySim();
    });
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
    this.enqueue(resolved, command, issuedAt + this.config.inputDelayTicks);
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
    return this.scope.run(() => this.captureSnapshot());
  }

  /**
   * Version policy → fresh `createWorld(config, { purpose: 'restore' })` →
   * `GameState.restore` → `done()` → round-trip check. Then bot state and
   * the input checkpoint, but only for slots this runner hosts or submits:
   * a client restoring a server snapshot ignores both. With no following
   * `fastForward`, `start` re-submits the checkpoint and does not re-run
   * `decide` for the snapshot tick. A runner that is already started flushes
   * that checkpoint after the transport seek, because `start` will not run
   * again. The match RNG is reset to `config.seed` before `createWorld`;
   * `GameState.restore` then installs the saved generator. A transport that
   * is already paused pauses the rebuilt world.
   */
  public restore(bytes: SnapshotBytes): void {
    this.ensureLive();
    const decoded = decodeSnapshot(bytes);
    const decision = checkSnapshotCompatibility(
      decoded.header,
      {
        engineFormat: ENGINE_SNAPSHOT_FORMAT,
        gameId: this.definition.id,
        simVersion: this.definition.simVersion,
        formatVersion: this.definition.state.formatVersion,
        configHash: this.configDigest,
      },
      this.definition.state.migrate
    );
    if (decision.decision === 'reject') {
      throw new SnapshotRejectedError(
        decision.reason ?? 'incompatible snapshot'
      );
    }
    const body =
      decision.decision === 'migrate'
        ? migrateBody(
            decoded.body,
            decoded.header.formatVersion,
            this.definition.state.formatVersion,
            this.definition.state.migrate ?? {}
          )
        : decoded.body;
    this.scope.run(() => {
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
    });
    if (this.transportPaused) this.provider.firePause();
    this.completedTick = decoded.header.tick;
    this.commandLog.rewindTo(decoded.header.tick);
    this.pendingByTick.clear();
    this.nextSeq.clear();
    this.unsent = null;
    if (decoded.botState !== null && decoded.botState.byteLength > 0) {
      const reader = new BinaryStateReader(decoded.botState);
      this.botHost.restore(reader);
      reader.done();
    }
    if (
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
  }

  /** `digestBytes(GameState.save())` of the current tick. */
  public digest(): Digest {
    this.ensureLive();
    return this.scope.run(() => this.computeDigest());
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
    if (!Number.isFinite(options.budgetMs)) {
      throw new Error(
        'MatchRunner.fastForward: budgetMs must be a finite number'
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

  private onTransportTick(tick: number, batch: CommandsBatch): void {
    if (this.stopped || this.phase !== 'active') return;
    if (!this.started) {
      if (this.transport instanceof LocalTransport && this.transport.isManual) {
        throw new Error(
          'MatchRunner: call start() before stepping a manual transport'
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
    const entries = entriesFromBatch(tick, batch, this.slotByPlayerId);
    this.runPreparedTick(tick, entries, plan);
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
      this.scope.run(() => {
        this.playEntries(tick, entries, plan);
      });
    } catch (error) {
      this.fail(tick, error);
      // A stepped LocalTransport must not surface the failure from
      // `step()`. `onError` already received it. Other transports still
      // see the exception.
      if (!(
        this.transport instanceof LocalTransport && this.transport.isManual
      )) {
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
    this.applyEntries(tick, entries);
    this.provider.emitTick(tick);
    const outcome = this.definition.outcome(this.sim);
    const endedNow = outcome !== null && this.phase === 'active';
    if (endedNow) this.phase = 'ended';
    if (plan.decide && this.phase === 'active') {
      this.decideHosted(tick, plan.submitAfter);
    }
    const hashDue = tick % this.hashEveryTicks === 0;
    const replayCheck =
      this.replayDigest !== undefined && tick === this.replayLastTick;
    let digest: Digest | undefined;
    if (hashDue || replayCheck) {
      digest = this.computeDigest();
      if (replayCheck && digest !== this.replayDigest) {
        throw new Error(
          `MatchRunner.fromReplay: final digest mismatch at tick ${String(tick)}`
        );
      }
    }
    this.completedTick = tick;
    if (endedNow && outcome !== null) this.outcomeListeners.emit(outcome);
    if (digest !== undefined && hashDue) {
      this.digestListeners.emit(tick, digest);
      this.transport.submitHash?.(tick, digest);
    }
    this.tickListeners.emit(tick);
    if (this.phase === 'ended') this.stop();
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
        this.enqueue(decision.slot, command, target);
      }
    }
  }

  private applyEntries(tick: number, entries: readonly LogEntry[]): void {
    for (const entry of entries) {
      const slot = this.slotByPlayerId.get(entry.playerId);
      const info = slot === undefined ? undefined : this.slotInfo.get(slot);
      if (slot === undefined || info === undefined) continue;
      if (entry.malformed === true) {
        this.rejectedListeners.emit(entry, 'malformed envelope');
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
      this.sim.applyCommand({
        tick,
        slot,
        seq: entry.data.q,
        command: decoded,
      });
    }
  }

  private enqueue(
    slot: number,
    command: CommandOf<G>,
    targetTick: number
  ): void {
    if (!Number.isInteger(targetTick) || targetTick < 0) {
      throw new Error(
        `MatchRunner.submit: target tick must be an integer >= 0, got ${String(targetTick)}`
      );
    }
    const seq = this.allocateSeq(slot);
    const entry = this.entryFor(slot, command, seq, targetTick);
    this.remember(entry);
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
    slot: number,
    command: CommandOf<G>,
    seq: number,
    tick: number
  ): LogEntry {
    const playerId = this.playerIdBySlot.get(slot);
    if (playerId === undefined) {
      throw new Error(`MatchRunner: no player id for slot ${String(slot)}`);
    }
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
      const entries = batch.entries.filter((entry) =>
        this.ownsPlayer(entry.playerId)
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
      const slot = this.slotByPlayerId.get(entry.playerId);
      if (slot === undefined) continue;
      this.transport.submit(entry.tick, slot, [
        { type: entry.type, data: entry.data },
      ]);
    }
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
    });
    return encodeSnapshot(
      {
        engineFormat: ENGINE_SNAPSHOT_FORMAT,
        gameId: this.definition.id,
        simVersion: this.definition.simVersion,
        formatVersion: this.definition.state.formatVersion,
        configHash: this.configDigest,
        tick: this.completedTick,
      },
      body,
      { botState, inputCheckpoint }
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
    // `G extends AnyGameDefinition` types these methods as the constraint,
    // which erases the concrete sim. The value is the game's own sim.
    const sim = this.definition.createWorld(this.config, {
      tickFrameProvider: this.provider,
      random: this.random,
      purpose,
    }) as SimOf<G>;
    this.simulation = sim;
    this.gameState = this.definition.state.bind(sim);
  }

  private destroySim(): void {
    const sim = this.simulation;
    if (sim === null) return;
    this.simulation = null;
    this.gameState = null;
    sim.dispose?.();
    sim.world.dispose();
  }

  private requireGameState(): GameState {
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

  public constructor(
    public readonly random: IRandom,
    private readonly transport: Transport
  ) {}

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

function resolveHashEvery(value: number | undefined): number {
  const every = value ?? DEFAULT_HASH_EVERY_TICKS;
  if (!Number.isInteger(every) || every < 1) {
    throw new Error(
      `MatchRunner: hashEveryTicks must be an integer >= 1, got ${String(value)}`
    );
  }
  return every;
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
    if (slot.kind === 'bot') {
      const expected = config.simMode === 'server' ? 'server' : 'local';
      if (slot.runsOn !== expected) {
        throw new Error(
          `MatchRunner: bot slot ${String(slot.slot)} runsOn '${slot.runsOn}' is invalid for simMode '${config.simMode}'`
        );
      }
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

function entriesFromBatch(
  tick: number,
  batch: CommandsBatch,
  slotByPlayerId: ReadonlyMap<string, number>
): LogEntry[] {
  const ranked: {
    slot: number;
    seq: number;
    index: number;
    entry: LogEntry;
  }[] = [];
  let index = 0;
  for (const playerId of Object.keys(batch.commands)) {
    const slot = slotByPlayerId.get(playerId);
    const commands = batch.commands[playerId];
    if (slot === undefined || commands === undefined) continue;
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
  return ranked.map((item) => item.entry);
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
