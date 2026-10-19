/**
 * Issued at `match-found`. A later issue at `game-start` and on each
 * rebind replaces it. `matchId` and `slot` sit beside `token` because
 * the client does not parse the token.
 */
export interface SessionTokenEvent {
  token: string;
  matchId: string;
  slot: number;
}

/**
 * The socket this player was bound to has been replaced.
 * `matchId` is the match it no longer belongs to.
 */
export interface SessionSupersededEvent {
  matchId: string;
}
