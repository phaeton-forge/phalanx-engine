import {
  DEFAULT_HASH_EVERY_TICKS,
  botPlayerId,
  isBotPlayerId,
  isCommandRejection,
  type SlotConfig,
  type SlotInfo,
} from '@phalanx-engine/runtime';
import type { EndMatchResult, PlayerCommand } from '../types/index.js';
import type { RegisteredGame } from './loadGames.js';
import type { SimHost } from './SimHost.js';
import type { SimCommand, SimIn, SimOut } from './messages.js';
import { SnapshotStore } from './SnapshotStore.js';

export interface RoomSimOptions {
  readonly matchId: string;
  readonly host: SimHost;
  readonly store: SnapshotStore;
  readonly game: RegisteredGame;
  readonly seed: number;
  readonly slots: readonly SlotConfig[];
  readonly inputDelayTicks: number;
  readonly snapshotEveryTicks: number;
  readonly extras: Readonly<Record<string, number>>;
  readonly enqueue: (commands: readonly PlayerCommand[]) => void;
  readonly currentTick: () => number;
  readonly endMatch: (result: EndMatchResult) => boolean;
  readonly emitPlayer: (
    playerId: string,
    event: string,
    payload: unknown
  ) => void;
  readonly emitServer: (event: string, ...args: unknown[]) => void;
  readonly onClosed: () => void;
}

/**
 * One server match on the relay side. The relay stamps commands; this
 * object forwards batches and applies sim replies. It does not share
 * objects with the simulation thread.
 */
export class RoomSim {
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
  private lastAck = -1;
  private lastGap = 0;
  private systemSeq = 0;
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
    if (this.closed) return;
    if (message.matchId !== this.options.matchId) return;
    switch (message.t) {
      case 'botCommands':
        this.options.enqueue(message.commands.map(toPlayerCommand));
        return;
      case 'digest':
        this.digests.set(message.tick, message.digest);
        this.options.emitServer(
          'sim-digest',
          this.options.matchId,
          message.tick,
          message.digest
        );
        this.flushHashes(message.tick, message.digest);
        return;
      case 'tick':
        this.lastAck = message.tick;
        this.lastGap = 0;
        return;
      case 'snapshot':
        this.keepSnapshot(message.tick, message.bytes, message.requestId);
        return;
      case 'event':
        this.options.endMatch(outcomeResult(message.outcome));
        return;
      case 'sim-error':
      case 'sim-crash':
      case 'sim-oom':
        this.fail(message.t, message.message);
        return;
      case 'opened':
      case 'ended':
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

  public noteRelayTick(currentTick: number): void {
    if (this.closed || this.dead) return;
    const completed = currentTick - 1;
    const gap = completed - this.lastAck;
    if (gap > 10 && gap > this.lastGap) {
      this.lastGap = gap;
      this.options.emitServer(
        'sim-lag',
        this.options.matchId,
        completed,
        this.lastAck,
        gap
      );
    }
  }

  public clientHash(playerId: string, tick: number, hash: string): void {
    if (this.closed) return;
    const digest = this.digests.get(tick);
    if (digest === undefined) {
      this.pendingHashes.push({ playerId, tick, hash });
      return;
    }
    this.compare(playerId, tick, hash, digest);
  }

  public requestSnapshot(playerId: string, requestId: number): void {
    if (this.closed || this.dead) return;
    this.pendingRequests.set(requestId, playerId);
    this.options.host.post({
      t: 'snapshot',
      matchId: this.options.matchId,
      requestId,
    });
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
    const fromTick = this.options.currentTick() + this.options.inputDelayTicks;
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
    this.options.enqueue([command]);
    this.options.host.post({
      t: 'setController',
      matchId: this.options.matchId,
      command: toSimCommand(command),
    });
  }

  public end(): void {
    if (this.closed) return;
    this.closed = true;
    this.options.store.delete(this.options.matchId);
    this.options.host.post({ t: 'end', matchId: this.options.matchId });
    this.options.onClosed();
  }

  private readonly pendingRequests = new Map<number, string>();

  private keepSnapshot(
    tick: number,
    bytes: ArrayBuffer,
    requestId: number | undefined
  ): void {
    const view = new Uint8Array(bytes);
    this.options.store.put(this.options.matchId, tick, view);
    if (requestId === undefined) return;
    const playerId = this.pendingRequests.get(requestId);
    this.pendingRequests.delete(requestId);
    if (playerId === undefined) return;
    this.options.emitPlayer(playerId, 'match-snapshot', {
      tick,
      bytes: view,
      requestId,
    });
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
    this.options.emitServer('desync-detected', this.options.matchId, tick, {
      [playerId]: hash,
      server: digest,
    });
    this.options.emitPlayer(playerId, 'desync', { playerId, tick });
  }

  private fail(reason: string, message: string): void {
    if (this.dead) return;
    this.dead = true;
    this.options.emitServer('sim-fault', this.options.matchId, reason, message);
    console.error(
      `[SimHost] ${reason} in match ${this.options.matchId}: ${message}`
    );
    this.options.endMatch({ reason });
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
