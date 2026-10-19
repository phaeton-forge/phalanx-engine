import {
  botPlayerId,
  isBotPlayerId,
  type EndMatchResult,
  type MatchSnapshot,
  type PlayerCommand,
  type ServerDesyncEvent,
  type ServerSimMatch,
  type ServerSimRoom,
  type SlotConfig,
} from '@phalanx-engine/protocol';
import { isCommandRejection } from '../game/commands.js';
import type { SlotInfo } from '../game/MatchConfig.js';
import { DEFAULT_HASH_EVERY_TICKS } from '../constants.js';
import type { RegisteredGame } from './loadGames.js';
import type { SimHost } from './SimHost.js';
import type { SimCommand, SimIn, SimOut } from './messages.js';
import { SnapshotStore } from './SnapshotStore.js';

/** On-cadence hashes waiting for the sim digest. Older rows drop first. */
const PENDING_HASH_CAP = 32;
/** Minimum gap between snapshot replies to one player. */
const SNAPSHOT_INTERVAL_MS = 1000;

export interface RoomSimOptions {
  readonly matchId: string;
  readonly host: SimHost;
  readonly store: SnapshotStore;
  readonly game: RegisteredGame;
  readonly seed: number;
  readonly slots: readonly SlotConfig[];
  readonly inputDelayTicks: number;
  readonly maxTickAhead: number;
  readonly snapshotEveryTicks: number;
  readonly extras: Readonly<Record<string, number>>;
  readonly room: ServerSimRoom;
}

/**
 * One server match on the relay side. The relay stamps commands; this
 * object forwards batches and applies sim replies. It does not share
 * objects with the simulation thread.
 */
export class RoomSim implements ServerSimMatch {
  private readonly options: RoomSimOptions;
  private readonly slotByPlayer = new Map<string, SlotInfo>();
  private readonly digests = new Map<number, string>();
  private readonly pendingHashes: {
    playerId: string;
    tick: number;
    hash: string;
  }[] = [];
  private readonly reported = new Set<string>();
  private closed = false;
  private dead = false;
  private finished = false;
  private lastAck = -1;
  private lastGap = 0;
  private systemSeq = 0;
  private endWait: Promise<void> | null = null;
  private endResolve: (() => void) | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  readonly matchConfig: { readonly [key: string]: unknown };

  public constructor(options: RoomSimOptions) {
    this.options = options;
    for (const slot of options.slots) {
      const playerId =
        slot.kind === 'human' ? slot.playerId : botPlayerId(slot.slot);
      const info: SlotInfo = {
        slot: slot.slot,
        team: slot.team,
        kind: slot.kind,
        playerId,
      };
      this.slotByPlayer.set(playerId, info);
    }
    const slots = options.slots.map((slot) =>
      slot.kind === 'human'
        ? {
            slot: slot.slot,
            team: slot.team,
            kind: 'human' as const,
            playerId: slot.playerId,
          }
        : {
            slot: slot.slot,
            team: slot.team,
            kind: 'bot' as const,
            policy: slot.policy,
            level: slot.level,
            runsOn: 'server' as const,
          }
    );
    this.matchConfig = {
      ...options.extras,
      matchId: options.matchId,
      gameId: options.game.id,
      simVersion: options.game.simVersion,
      seed: options.seed,
      side: 'server',
      slots,
      inputDelayTicks: options.inputDelayTicks,
    };
    const open: SimIn = {
      t: 'open',
      matchId: options.matchId,
      module: options.game.moduleHref,
      ...(options.game.exportName !== undefined
        ? { exportName: options.game.exportName }
        : {}),
      config: this.matchConfig,
      snapshotEveryTicks: options.snapshotEveryTicks,
      hashEveryTicks: DEFAULT_HASH_EVERY_TICKS,
    };
    options.host.post(open);
  }

  public onMessage(message: SimOut): void {
    if (message.matchId !== this.options.matchId) return;
    if (message.t === 'ended') {
      this.finishEnd();
      return;
    }
    if (this.closed || this.dead) return;
    switch (message.t) {
      case 'botCommands':
        this.options.room.enqueue(message.commands.map(toPlayerCommand));
        return;
      case 'digest':
        this.digests.set(message.tick, message.digest);
        this.options.room.emitServerEvent(
          'sim-digest',
          this.options.matchId,
          message.tick,
          message.digest
        );
        this.flushHashes(message.tick, message.digest);
        return;
      case 'tick':
        this.lastAck = message.tick;
        if (this.leadExceeded(this.options.room.currentTick())) return;
        this.lastGap = 0;
        this.options.room.releaseHold();
        return;
      case 'snapshot':
        this.keepSnapshot(message.tick, message.bytes, message.requestId);
        return;
      case 'event':
        this.dead = true;
        this.dropPending();
        this.options.room.haltRelay();
        this.options.room.endMatch(outcomeResult(message.outcome));
        return;
      case 'sim-error':
      case 'sim-crash':
      case 'sim-oom':
        this.fail(message.t, message.message);
        return;
      case 'opened':
        return;
      default:
        return;
    }
  }

  public publishBatch(tick: number, commands: readonly PlayerCommand[]): void {
    if (this.closed || this.dead) return;
    const message: SimIn = {
      t: 'batch',
      matchId: this.options.matchId,
      tick,
      commands: commands.map(toSimCommand),
    };
    this.options.host.post(message);
  }

  /**
   * True when the relay is far enough ahead that bot commands for
   * `nextTick` may not have been stamped yet. The bound is
   * `inputDelayTicks - 1`, so a sim that keeps up does not pause the room.
   * Crossing it emits `sim-lag` and the room stops its own tick loop.
   */
  public leadExceeded(nextTick: number): boolean {
    if (this.closed || this.dead) return false;
    const bound = this.options.inputDelayTicks - 1;
    const gap = nextTick - 1 - this.lastAck;
    if (gap <= bound) return false;
    if (gap > this.lastGap) {
      this.lastGap = gap;
      this.options.room.emitServerEvent(
        'sim-lag',
        this.options.matchId,
        nextTick - 1,
        this.lastAck,
        gap
      );
    }
    return true;
  }

  public clientHash(playerId: string, tick: number, hash: string): void {
    if (this.closed) return;
    if (!Number.isInteger(tick) || tick < 0) return;
    if (tick % DEFAULT_HASH_EVERY_TICKS !== 0) return;
    const limit = this.options.room.currentTick() + this.options.maxTickAhead;
    if (tick > limit) return;
    const digest = this.digests.get(tick);
    if (digest !== undefined) {
      this.compare(playerId, tick, hash, digest);
      return;
    }
    if (this.pendingHashes.length >= PENDING_HASH_CAP) {
      this.pendingHashes.shift();
    }
    this.pendingHashes.push({ playerId, tick, hash });
  }

  public requestSnapshot(playerId: string, requestId: number): void {
    if (this.closed || this.dead) return;
    if (!Number.isInteger(requestId) || requestId < 0) return;
    if (!this.answerDue(playerId)) {
      this.defer(playerId, requestId);
      return;
    }
    this.clearDeferred(playerId);
    this.orderSnapshot(playerId, requestId);
  }

  public latestSnapshotTick(): number | undefined {
    return this.options.store.get(this.options.matchId)?.tick;
  }

  public acceptCommand(playerId: string, data: unknown): boolean {
    const info = this.slotByPlayer.get(playerId);
    if (info === undefined) return false;
    if (!isEnvelope(data)) return false;
    try {
      const decoded = this.options.game.definition.commands.decode(
        data.p,
        info
      );
      return !isCommandRejection(decoded);
    } catch {
      return false;
    }
  }

  /**
   * File a `setController` for `currentTick + inputDelay` and tell the
   * sim to merge the same command into that tick.
   */
  public setController(
    playerId: string,
    mode: 'human' | 'bot',
    policy?: string
  ): void {
    if (this.closed || this.dead) return;
    const info = this.slotByPlayer.get(playerId);
    if (info === undefined || isBotPlayerId(playerId)) return;
    const fromTick =
      this.options.room.currentTick() + this.options.inputDelayTicks;
    const slotConfig = this.options.slots.find(
      (slot) => slot.slot === info.slot
    );
    const level = slotConfig?.kind === 'bot' ? slotConfig.level : 0;
    const runsOn = 'server';
    const payload: { [key: string]: string | number } = {
      level,
      mode,
      runsOn,
      slot: info.slot,
    };
    if (mode === 'bot') {
      const configured =
        slotConfig?.kind === 'bot' ? slotConfig.policy : undefined;
      const name = policy ?? configured;
      if (name === undefined || name.length === 0) return;
      payload['policy'] = name;
    }
    const command: PlayerCommand = {
      type: 'setController',
      tick: fromTick,
      playerId: 'system',
      data: { q: this.systemSeq, p: payload },
    };
    this.systemSeq += 1;
    this.options.room.enqueue([command]);
    this.options.host.post({
      t: 'setController',
      matchId: this.options.matchId,
      command: toSimCommand(command),
    });
  }

  /** Ask the sim to drop the match. Resolves on `ended`, or after 2s. */
  public end(): Promise<void> {
    if (this.endWait) return this.endWait;
    this.closed = true;
    this.dead = true;
    this.dropPending();
    this.options.store.delete(this.options.matchId);
    this.endWait = new Promise<void>((resolve) => {
      this.endResolve = resolve;
    });
    this.endTimer = setTimeout(() => {
      this.finishEnd();
    }, 2000);
    this.options.host.post({ t: 'end', matchId: this.options.matchId });
    return this.endWait;
  }

  /** Latest `requestId` still waiting on the sim, keyed by player. */
  private readonly pendingRequests = new Map<string, number>();
  /** Latest `requestId` held until this player's interval elapses. */
  private readonly deferred = new Map<string, number>();
  private readonly deferredTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  /** `Date.now()` of the last snapshot sent to this player. */
  private readonly lastDeliveredAt = new Map<string, number>();
  private snapshotInFlight = false;

  private answerDue(playerId: string): boolean {
    const last = this.lastDeliveredAt.get(playerId);
    if (last === undefined) return true;
    return Date.now() - last >= SNAPSHOT_INTERVAL_MS;
  }

  /** An early request replaces the previous one and is answered once due. */
  private defer(playerId: string, requestId: number): void {
    this.deferred.set(playerId, requestId);
    if (this.deferredTimers.has(playerId)) return;
    const last = this.lastDeliveredAt.get(playerId) ?? Date.now();
    const wait = Math.max(0, SNAPSHOT_INTERVAL_MS - (Date.now() - last));
    const timer = setTimeout(() => {
      this.deferredTimers.delete(playerId);
      this.flushDeferred(playerId);
    }, wait);
    this.deferredTimers.set(playerId, timer);
  }

  private flushDeferred(playerId: string): void {
    if (this.closed || this.dead) return;
    const requestId = this.deferred.get(playerId);
    if (requestId === undefined) return;
    this.deferred.delete(playerId);
    if (!this.answerDue(playerId)) {
      this.defer(playerId, requestId);
      return;
    }
    this.orderSnapshot(playerId, requestId);
  }

  private clearDeferred(playerId: string): void {
    const timer = this.deferredTimers.get(playerId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.deferredTimers.delete(playerId);
    }
    this.deferred.delete(playerId);
  }

  private orderSnapshot(playerId: string, requestId: number): void {
    const stored = this.options.store.get(this.options.matchId);
    if (
      stored !== undefined &&
      this.lastAck >= 0 &&
      stored.tick >= this.lastAck
    ) {
      this.deliverSnapshot(playerId, requestId, stored.tick, stored.bytes);
      return;
    }
    this.pendingRequests.set(playerId, requestId);
    if (this.snapshotInFlight) return;
    this.snapshotInFlight = true;
    this.options.host.post({
      t: 'snapshot',
      matchId: this.options.matchId,
      requestId: 0,
    });
  }

  private keepSnapshot(
    tick: number,
    bytes: ArrayBuffer,
    _requestId: number | undefined
  ): void {
    const view = new Uint8Array(bytes);
    this.options.store.put(this.options.matchId, tick, view);
    const waiting = [...this.pendingRequests.entries()];
    this.pendingRequests.clear();
    this.snapshotInFlight = false;
    for (const [playerId, requestId] of waiting) {
      this.deliverSnapshot(playerId, requestId, tick, view);
    }
  }

  private deliverSnapshot(
    playerId: string,
    requestId: number,
    tick: number,
    bytes: Uint8Array
  ): void {
    this.lastDeliveredAt.set(playerId, Date.now());
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    this.options.room.emitToPlayer(playerId, 'match-snapshot', {
      tick,
      bytes: copy,
      requestId,
    } satisfies MatchSnapshot);
  }

  private flushHashes(tick: number, digest: string): void {
    const waiting = this.pendingHashes.filter((row) => row.tick === tick);
    this.pendingHashes.splice(
      0,
      this.pendingHashes.length,
      ...this.pendingHashes.filter((row) => row.tick !== tick)
    );
    for (const row of waiting) {
      this.compare(row.playerId, row.tick, row.hash, digest);
    }
  }

  private compare(
    playerId: string,
    tick: number,
    hash: string,
    digest: string
  ): void {
    if (hash === digest || this.reported.has(playerId)) return;
    this.reported.add(playerId);
    this.options.room.emitServerEvent(
      'desync-detected',
      this.options.matchId,
      tick,
      {
        [playerId]: hash,
        server: digest,
      }
    );
    this.options.room.emitToPlayer(playerId, 'desync', {
      playerId,
      tick,
    } satisfies ServerDesyncEvent);
  }

  private dropPending(): void {
    this.pendingHashes.length = 0;
    this.pendingRequests.clear();
    this.deferred.clear();
    for (const timer of this.deferredTimers.values()) clearTimeout(timer);
    this.deferredTimers.clear();
    this.lastDeliveredAt.clear();
    this.snapshotInFlight = false;
  }

  private finishEnd(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.endTimer !== null) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    this.dropPending();
    this.options.room.onClosed();
    const resolve = this.endResolve;
    this.endResolve = null;
    resolve?.();
  }

  private fail(reason: string, message: string): void {
    if (this.dead) return;
    this.dead = true;
    this.dropPending();
    this.options.room.haltRelay();
    this.options.room.emitServerEvent(
      'sim-fault',
      this.options.matchId,
      reason,
      message
    );
    console.error(
      `[SimHost] ${reason} in match ${this.options.matchId}: ${message}`
    );
    this.options.room.endMatch({ reason });
  }
}

function toPlayerCommand(command: SimCommand): PlayerCommand {
  return {
    type: command.type,
    tick: command.tick,
    playerId: command.playerId,
    data: command.data,
    ...(command.sequence !== undefined ? { sequence: command.sequence } : {}),
  };
}

function toSimCommand(command: PlayerCommand): SimCommand {
  return {
    type: command.type,
    tick: command.tick,
    playerId: command.playerId,
    data: command.data,
    ...(command.sequence !== undefined ? { sequence: command.sequence } : {}),
  };
}

function isEnvelope(data: unknown): data is { q: number; p: unknown } {
  if (typeof data !== 'object' || data === null) return false;
  const record = data as { q?: unknown; p?: unknown };
  return (
    typeof record.q === 'number' &&
    Number.isInteger(record.q) &&
    record.q >= 0 &&
    'p' in record
  );
}

function outcomeResult(outcome: {
  kind: 'win' | 'draw';
  reason: string;
  winnerTeam?: number;
}): EndMatchResult {
  if (outcome.kind === 'win' && outcome.winnerTeam !== undefined) {
    return { reason: outcome.reason, winnerTeamId: outcome.winnerTeam };
  }
  return { reason: outcome.reason };
}
