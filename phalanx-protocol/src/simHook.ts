import type { PlayerCommand } from './messages/commands.js';
import type { SlotConfig } from './matchConfig.js';

/**
 * Why a server-simulated match ended. The sim and the relay share this
 * shape. `loserIds` is an input only: the room derives `winnerTeamId`
 * from it when the caller did not pass one.
 */
export interface EndMatchResult {
  reason: string;
  winnerTeamId?: number;
  loserIds?: string[];
}

/** Socket `desync` payload. One player, the tick that diverged. */
export interface ServerDesyncEvent {
  playerId: string;
  tick: number;
}

/** Socket `match-snapshot` payload. `bytes` is the snapshot for `tick`. */
export interface MatchSnapshot {
  tick: number;
  bytes: Uint8Array;
  requestId: number;
}

/** Socket `match-snapshot-request` body. */
export interface MatchSnapshotRequest {
  requestId: number;
}

/** One game the sim host can run. `configKeys` are integer match extras. */
export interface ServerSimGame {
  id: string;
  tickRate: number;
  configKeys: readonly string[];
}

/** What `ServerSimHook.start` reports to the relay. */
export interface ServerSimInfo {
  games: readonly ServerSimGame[];
  maxMatches?: number;
}

/**
 * One server match, without room callbacks. The relay fills `seed` and
 * `maxTickAhead`. `extras` are the integer `configKeys` already checked.
 */
export interface ServerSimMatchSpec {
  matchId: string;
  gameId: string;
  seed: number;
  slots: readonly SlotConfig[];
  inputDelayTicks: number;
  maxTickAhead: number;
  extras: Readonly<Record<string, number>>;
}

/** Server events the sim emits. `bot-commands-late` is the room, not the sim. */
export interface ServerSimEvents {
  'sim-digest': (matchId: string, tick: number, digest: string) => void;
  'sim-lag': (
    matchId: string,
    relayTick: number,
    simTick: number,
    gap: number
  ) => void;
  'sim-fault': (matchId: string, reason: string, message: string) => void;
  'desync-detected': (
    matchId: string,
    tick: number,
    hashes: { [playerId: string]: string }
  ) => void;
}

interface ServerSimPlayerEvents {
  desync: ServerDesyncEvent;
  'match-snapshot': MatchSnapshot;
}

/**
 * What the sim asks of the room. Payloads are the socket and server
 * events the sim actually emits.
 */
export interface ServerSimRoom {
  enqueue(commands: readonly PlayerCommand[]): void;
  currentTick(): number;
  endMatch(result: EndMatchResult): boolean;
  haltRelay(): void;
  releaseHold(): void;
  emitToPlayer<E extends keyof ServerSimPlayerEvents>(
    playerId: string,
    event: E,
    payload: ServerSimPlayerEvents[E]
  ): void;
  emitServerEvent<E extends keyof ServerSimEvents>(
    event: E,
    ...args: Parameters<ServerSimEvents[E]>
  ): void;
  onClosed(): void;
}

/** What the room calls on one server match. `onMessage` stays inside the sim. */
export interface ServerSimMatch {
  readonly matchConfig: { readonly [key: string]: unknown };
  publishBatch(tick: number, commands: readonly PlayerCommand[]): void;
  leadExceeded(nextTick: number): boolean;
  acceptCommand(playerId: string, data: unknown): boolean;
  clientHash(playerId: string, tick: number, hash: string): void;
  requestSnapshot(playerId: string, requestId: number): void;
  latestSnapshotTick(): number | undefined;
  setController(playerId: string, mode: 'bot' | 'human', policy?: string): void;
  end(): Promise<void>;
}

/**
 * The only way the relay talks to a server simulation. No engine types.
 * `close` ends every open match, then the host.
 */
export interface ServerSimHook {
  start(): Promise<ServerSimInfo>;
  isAvailable(): boolean;
  openMatch(match: ServerSimMatchSpec, room: ServerSimRoom): ServerSimMatch;
  close(): Promise<void>;
}
