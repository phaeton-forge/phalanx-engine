import type { PlayerCommand } from './commands.js';

/**
 * Why a `match-log` request was refused.
 * `'truncated'` means numeric history no longer contains `fromTick`.
 */
export type MatchLogErrorReason =
  'not-member' | 'not-found' | 'invalid' | 'truncated';

/**
 * Client → server request for the command log of a match.
 * `maxTicks` defaults to the whole remaining log on the server.
 */
export interface MatchLogRequest {
  matchId: string;
  fromTick: number;
  maxTicks?: number;
  /**
   * Client-chosen id for this read. Echoed on chunks and errors so a
   * socket can ignore a stream that a later request replaced.
   */
  requestId?: string;
}

/** Client → server. Stops the `match-log` stream with this `requestId`. */
export interface MatchLogCancelRequest {
  requestId?: string;
}

/** One stored tick inside a `match-log-chunk`. Empty ticks are omitted. */
export interface MatchLogEntry {
  tick: number;
  commands: PlayerCommand[];
}

/**
 * Server → requesting socket. `toTick` is inclusive. A chunk spans at
 * most 2000 ticks of the requested range (not 2000 entries). `matchId`
 * is present so a client can ignore a chunk from another match.
 */
export interface MatchLogChunkEvent {
  matchId: string;
  fromTick: number;
  toTick: number;
  entries: MatchLogEntry[];
  done: boolean;
  /** Present when the request carried a `requestId`. */
  requestId?: string;
}

/** Server → requesting socket when `match-log` is refused. */
export interface MatchLogErrorEvent {
  matchId?: string;
  requestId?: string;
  reason: MatchLogErrorReason;
}
