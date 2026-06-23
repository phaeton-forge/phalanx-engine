import type { IComponent } from '@phalanx-engine/ecs';
import { ComponentType } from './Component.ts';
import type { TeamTag } from '../enums/TeamTag.ts';

/**
 * Possible game phases.
 */
export type GamePhase =
  | 'aiming'
  | 'simulating'
  | 'evaluating'
  | 'round_over'
  | 'round_transition'
  | 'game_over';

/**
 * GameStateComponent — singleton component that stores the global game state.
 *
 * Attached to a dedicated entity; only one instance should exist.
 * Managed by GameRulesSystem.
 */
export class GameStateComponent implements IComponent {
  public readonly type = ComponentType.GameState;

  /** Whose turn it is */
  public currentTeam: TeamTag;

  /** Current game phase */
  public phase: GamePhase;

  /** Current round number (1-based) */
  public roundNumber: number;

  /** Starting row for white checkers (7 = bottom of board) */
  public whiteRow: number;

  /** Starting row for black checkers (0 = top of board) */
  public blackRow: number;

  /** Entity ID of the checker that was last flicked */
  public lastFlickedEntityId: number;

  /** Count of white checkers still alive on the board */
  public whiteAliveCount: number;

  /** Count of black checkers still alive on the board */
  public blackAliveCount: number;

  /** How many opponent (black) checkers white eliminated this turn */
  public whiteElimThisTurn: number;

  /** How many opponent (white) checkers black eliminated this turn */
  public blackElimThisTurn: number;

  /** Ticks remaining in the round_transition delay (counts down to 0) */
  public roundTransitionTicksLeft: number;

  /** Winner of the round that just ended (null = draw); valid during round_transition */
  public pendingRoundWinner: TeamTag | null;

  constructor(initialTeam: TeamTag) {
    this.currentTeam = initialTeam;
    this.phase = 'aiming';
    this.roundNumber = 1;
    this.whiteRow = 7;
    this.blackRow = 0;
    this.lastFlickedEntityId = -1;
    this.whiteAliveCount = 8;
    this.blackAliveCount = 8;
    this.whiteElimThisTurn = 0;
    this.blackElimThisTurn = 0;
    this.roundTransitionTicksLeft = 0;
    this.pendingRoundWinner = null;
  }
}

