import type { MatchLogEntry } from './log.js';

/** `MatchInfo.state` and `match-resume-state` `state`. */
export type MatchState =
  | 'waiting-for-players'
  | 'countdown'
  | 'waiting-for-ready'
  | 'playing'
  | 'paused'
  | 'finished';

/** Player info for `match-found` (minimal data). */
export interface MatchPlayerInfo {
  playerId: string;
  username: string;
}

/** `match-found`. Personalized for each player. */
export interface MatchFoundEvent {
  matchId: string;
  playerId: string;
  teamId: number;
  teammates: MatchPlayerInfo[];
  opponents: MatchPlayerInfo[];
}

/** `countdown`. Sent every second before the game starts. */
export interface CountdownEvent {
  seconds: number;
}

/** `game-start`. Sent when the countdown reaches 0. */
export interface GameStartEvent {
  matchId: string;
  /** Random seed for deterministic RNG. */
  randomSeed?: number;
  /**
   * Server-sim runner config (`side: 'server'`). Present only when this
   * match has a server simulation. A client copies it and sets `side`
   * to `'client'`.
   */
  matchConfig?: { readonly [key: string]: unknown };
}

/** `tick-sync`. Sent every tick. */
export interface TickSyncEvent {
  tick: number;
  timestamp: number;
}

/** `player-disconnected`. */
export interface PlayerDisconnectedEvent {
  playerId: string;
  matchId: string;
  gracePeriodMs: number;
}

/** `player-reconnected`. */
export interface PlayerReconnectedEvent {
  playerId: string;
}

/** `player-ready`. */
export interface PlayerReadyEvent {
  playerId: string;
}

/**
 * `reconnect-state`.
 *
 * Carries the countdown / game-start snapshot so a client that missed
 * those broadcasts can catch up. `players` is also sent (live room
 * player objects) and is intentionally not part of this type.
 *
 * `state` is never `waiting-for-players`: that phase does not emit
 * `reconnect-state`.
 */
export interface ReconnectStateEvent {
  matchId: string;
  currentTick: number;
  state: Exclude<MatchState, 'waiting-for-players'>;
  recentCommands: MatchLogEntry[];
  /**
   * Seconds left on the countdown when the snapshot was taken, or `null`
   * when the countdown is not running.
   */
  countdownSecondsRemaining?: number | null;
  /**
   * True when `game-start` has already been broadcast. The client
   * synthesizes a local `game-start` from `matchId` and `randomSeed`
   * only, without `matchConfig`.
   */
  gameStartEmitted?: boolean;
  /** Match RNG seed, for a client that missed `game-start`. */
  randomSeed?: number;
}

/** `reconnect-status`. */
export interface ReconnectStatusEvent {
  success: boolean;
  reason?: string;
}

/**
 * `match-end`.
 * `winnerTeamId` is set when the room resolved a winning team.
 * `details` and `winner: null` are set on `reason: 'desync'`.
 */
export interface MatchEndEvent {
  reason: string;
  details?: unknown;
  winner?: string | null;
  winnerTeamId?: number;
}

/** `game-paused`. */
export interface GamePausedEvent {
  requestedBy: string;
  lastTick: number;
}

/** `game-resumed`. */
export interface GameResumedEvent {
  requestedBy: string;
}

/** `queue-status`. */
export interface QueueStatusEvent {
  position: number;
  waitTime: number;
}

/** `match-error`. Sent when the match cannot start. */
export interface MatchErrorEvent {
  matchId: string;
  reason: 'build-mismatch';
}

/**
 * `server-shutdown`. Sent to every player of a match before the process
 * stops. `matchIds` is the same list for every room.
 */
export interface ServerShutdownEvent {
  reason: string;
  matchIds: string[];
}

/**
 * `player-absent`, and one row of `GameRoom.getAbsences()`.
 * Both durations are milliseconds remaining when the payload is produced.
 */
export interface PlayerAbsentEvent {
  playerId: string;
  deadlineMs: number;
  budgetLeftMs: number;
}
