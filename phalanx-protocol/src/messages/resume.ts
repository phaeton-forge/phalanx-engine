import type { MatchState } from './match.js';

/** Why `match-resume` was refused. No extra detail is sent. */
export type MatchResumeErrorReason =
  'invalid' | 'expired' | 'match-ended' | 'build-mismatch';

/**
 * Successful `match-resume` (`match-resume-state`).
 * `absentDeadline` is omitted when no other player is absent. It is
 * milliseconds until the soonest other absence expires, not an epoch time.
 * `snapshot` is present in server-sim mode when a snapshot has been stored.
 */
export interface MatchResumeState {
  matchId: string;
  slot: number;
  currentTick: number;
  state: MatchState;
  absentDeadline?: number;
  /** Present in server-sim mode when a snapshot has been stored. Tick only. */
  snapshot?: { tick: number };
}
