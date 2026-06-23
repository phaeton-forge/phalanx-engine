import type { FixedPoint } from '@phalanx-engine/math';
import type { TeamTag } from '../enums/TeamTag.ts';

// ── Event name constants ──────────────────────────────────────────

/** Fired when a player flicks a checker */
export const FLICK_EXECUTED = 'FLICK_EXECUTED';

/** Fired when all checkers have stopped moving */
export const ALL_SETTLED = 'ALL_SETTLED';

/** Fired when a checker is eliminated (left the board) */
export const CHECKER_ELIMINATED = 'CHECKER_ELIMINATED';

/** Fired when a round ends */
export const ROUND_OVER = 'ROUND_OVER';

/** Fired when the entire game is over */
export const GAME_OVER = 'GAME_OVER';

/** Fired when the active turn changes */
export const TURN_CHANGED = 'TURN_CHANGED';

/** Fired when a new round begins with reset positions */
export const ROUND_STARTED = 'ROUND_STARTED';

/** Fired when two checkers collide (visual-only, for effects) */
export const CHECKER_COLLISION = 'CHECKER_COLLISION';

/** Fired when an eliminated checker hits the table border rail (Rapier VFX) */
export const BORDER_HIT = 'BORDER_HIT';

/** Fired when any Rapier-simulated contact begins (eliminated checkers) */
export const RAPIER_CONTACT = 'RAPIER_CONTACT';

/** Fired when all Rapier-simulated bodies have come to rest */
export const RAPIER_SETTLED = 'RAPIER_SETTLED';

// ── Event payload interfaces ──────────────────────────────────────

export interface FlickExecutedEvent {
  readonly entityId: number;
  readonly team: TeamTag;
  readonly directionX: FixedPoint;
  readonly directionZ: FixedPoint;
  readonly force: FixedPoint;
}

export interface AllSettledEvent {
  /* empty */
}

export interface CheckerEliminatedEvent {
  readonly entityId: number;
  readonly team: TeamTag;
  /** World-space position at elimination (float, for VFX) */
  readonly posX: number;
  readonly posY: number;
  readonly posZ: number;
  /** Velocity at elimination (float, for VFX) */
  readonly velX: number;
  readonly velZ: number;
}

export interface RoundOverEvent {
  /** Winning team, or null for a draw */
  readonly winner: TeamTag | null;
}

export interface GameOverEvent {
  readonly winner: TeamTag;
}

export interface TurnChangedEvent {
  readonly team: TeamTag;
}

export interface RoundStartedEvent {
  readonly roundNumber: number;
  readonly whiteRow: number;
  readonly blackRow: number;
}

export interface CheckerCollisionEvent {
  /** World-space collision point (float, for VFX) */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly entityA: number;
  readonly entityB: number;
}

export interface BorderHitEvent {
  /** Entity ID of the checker that hit the border */
  readonly entityId: number;
}

/** Kind of Rapier contact */
export type RapierContactKind = 'border' | 'checker' | 'surface';

export interface RapierContactEvent {
  /** Entity ID of the checker involved */
  readonly entityId: number;
  /** What it collided with */
  readonly kind: RapierContactKind;
}

