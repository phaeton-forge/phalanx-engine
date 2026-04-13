import { GameSystem } from 'phalanx-ecs';
import type { SystemContext } from 'phalanx-ecs';
import { FPVector3 } from 'phalanx-math';
import { ComponentType } from '../components';
import type { GameStateComponent } from '../components';
import type { CheckerComponent } from '../components';
import type { TransformComponent } from '../components';
import { PhysicsBodySoASchema } from '../components';
import { TeamTag } from '../enums/TeamTag.ts';
import {
  BOARD_SIZE,
  CELL_SIZE,
  BOARD_HEIGHT,
  CHECKER_HEIGHT,
  CHECKERS_PER_TEAM,
} from '../config/constants.ts';
import {
  FLICK_EXECUTED,
  ALL_SETTLED,
  CHECKER_ELIMINATED,
  ROUND_OVER,
  GAME_OVER,
  TURN_CHANGED,
  ROUND_STARTED,
} from '../events/GameEvents.ts';
import type {
  FlickExecutedEvent,
  CheckerEliminatedEvent,
  RoundOverEvent,
  GameOverEvent,
  TurnChangedEvent,
  RoundStartedEvent,
} from '../events/GameEvents.ts';

/**
 * GameRulesSystem — manages Chapayev game rules, turn flow, and round progression.
 *
 * Registered as a **tick** system, runs after PhysicsSystem.
 *
 * State-machine phases:
 *   aiming → simulating → evaluating → (aiming | round_over | game_over)
 */
export class GameRulesSystem extends GameSystem {
  /** Reference to the singleton GameState component */
  private gameState!: GameStateComponent;

  /** Checkers eliminated during the current turn (accumulated via events) */
  private turnEliminations: CheckerEliminatedEvent[] = [];

  /** Flag set by ALL_SETTLED event handler */
  private allSettled = false;

  // ── Lifecycle ──────────────────────────────────────────────────

  public override init(context: SystemContext): void {
    super.init(context);

    // Resolve the singleton GameState component
    const gsEntities = this.entityManager.queryEntities(ComponentType.GameState);
    if (gsEntities.length === 0) {
      throw new Error('GameRulesSystem: no entity with GameStateComponent found');
    }
    this.gameState = gsEntities[0].getComponent<GameStateComponent>(ComponentType.GameState)!;

    // Subscribe to events
    this.subscribe<FlickExecutedEvent>(FLICK_EXECUTED, (e) => this.onFlickExecuted(e));
    this.subscribe<CheckerEliminatedEvent>(CHECKER_ELIMINATED, (e) => this.onCheckerEliminated(e));
    this.subscribe(ALL_SETTLED, () => this.onAllSettled());
  }

  // ── Event handlers ─────────────────────────────────────────────

  private onFlickExecuted(event: FlickExecutedEvent): void {
    if (this.gameState.phase !== 'aiming') return;

    this.gameState.lastFlickedEntityId = event.entityId;
    this.gameState.phase = 'simulating';

    // Reset turn elimination counters
    this.turnEliminations = [];
    this.gameState.whiteElimThisTurn = 0;
    this.gameState.blackElimThisTurn = 0;
  }

  private onCheckerEliminated(event: CheckerEliminatedEvent): void {
    this.turnEliminations.push(event);

    // Update alive counts
    if (event.team === TeamTag.White) {
      this.gameState.whiteAliveCount = Math.max(0, this.gameState.whiteAliveCount - 1);
    } else {
      this.gameState.blackAliveCount = Math.max(0, this.gameState.blackAliveCount - 1);
    }

    // Track per-turn eliminations
    if (this.gameState.currentTeam === TeamTag.White && event.team === TeamTag.Black) {
      this.gameState.whiteElimThisTurn++;
    } else if (this.gameState.currentTeam === TeamTag.Black && event.team === TeamTag.White) {
      this.gameState.blackElimThisTurn++;
    }
  }

  private onAllSettled(): void {
    this.allSettled = true;
  }

  // ── Tick processing ────────────────────────────────────────────

  public override processTick(_tick: number): void {
    if (!this.allSettled) return;
    if (this.gameState.phase !== 'simulating') {
      this.allSettled = false;
      return;
    }

    // Transition to evaluation
    this.gameState.phase = 'evaluating';
    this.allSettled = false;

    this.evaluateTurn();
  }

  // ── Turn evaluation ────────────────────────────────────────────

  private evaluateTurn(): void {
    const gs = this.gameState;
    const currentTeam = gs.currentTeam;
    const opponentTeam = currentTeam === TeamTag.White ? TeamTag.Black : TeamTag.White;

    // Count opponent checkers eliminated this turn
    const opponentElim = this.turnEliminations.filter((e) => e.team === opponentTeam).length;

    // Check if the flicked checker was eliminated
    const flickedEliminated = this.turnEliminations.some(
      (e) => e.entityId === gs.lastFlickedEntityId,
    );

    // Check round-over conditions
    const opponentAlive = opponentTeam === TeamTag.White ? gs.whiteAliveCount : gs.blackAliveCount;
    const ownAlive = currentTeam === TeamTag.White ? gs.whiteAliveCount : gs.blackAliveCount;

    // Both teams wiped out → draw
    if (opponentAlive === 0 && ownAlive === 0) {
      gs.phase = 'round_over';
      this.eventBus.emit<RoundOverEvent>(ROUND_OVER, { winner: null });
      this.scheduleNewRound(null);
      return;
    }

    // All opponent checkers eliminated → current team wins the round
    if (opponentAlive === 0) {
      gs.phase = 'round_over';
      this.eventBus.emit<RoundOverEvent>(ROUND_OVER, { winner: currentTeam });
      this.scheduleNewRound(currentTeam);
      return;
    }

    // Successful hit: at least one opponent eliminated AND flicked checker survived
    if (opponentElim > 0 && !flickedEliminated) {
      // Same player gets another turn
      gs.phase = 'aiming';
      this.turnEliminations = [];
      return;
    }

    // Failed hit: no opponent eliminated OR flicked checker was eliminated
    // Turn passes to opponent
    gs.currentTeam = opponentTeam;
    gs.phase = 'aiming';
    this.turnEliminations = [];

    this.eventBus.emit<TurnChangedEvent>(TURN_CHANGED, { team: opponentTeam });
  }

  // ── Round management ───────────────────────────────────────────

  private scheduleNewRound(winner: TeamTag | null): void {
    const gs = this.gameState;

    if (winner !== null) {
      // Winner advances 1 row toward the opponent's side
      if (winner === TeamTag.White) {
        gs.whiteRow = Math.min(gs.whiteRow + 1, 7);
      } else {
        gs.blackRow = Math.max(gs.blackRow - 1, 0);
      }

      // Check game-over: winner reached the last row
      const winnerRow = winner === TeamTag.White ? gs.whiteRow : gs.blackRow;
      const lastRow = winner === TeamTag.White ? 7 : 0;

      if (winnerRow === lastRow) {
        gs.phase = 'game_over';
        console.log(`🏆 Game Over! ${winner} wins!`);
        this.eventBus.emit<GameOverEvent>(GAME_OVER, { winner });
        return;
      }
    }

    // Start new round after a short delay (use next tick)
    gs.roundNumber++;
    this.resetCheckers();

    // Loser starts the next round (or white if draw)
    const nextTeam = winner === null
      ? TeamTag.White
      : winner === TeamTag.White ? TeamTag.Black : TeamTag.White;

    gs.currentTeam = nextTeam;
    gs.phase = 'aiming';

    this.eventBus.emit<RoundStartedEvent>(ROUND_STARTED, {
      roundNumber: gs.roundNumber,
      whiteRow: gs.whiteRow,
      blackRow: gs.blackRow,
    });
    this.eventBus.emit<TurnChangedEvent>(TURN_CHANGED, { team: nextTeam });
  }

  // ── Checker reset ──────────────────────────────────────────────

  /**
   * Reset all checkers to their starting positions for the current round,
   * accounting for row advancement.
   */
  private resetCheckers(): void {
    const gs = this.gameState;
    const pStore = this.entityManager.getOrCreateSoAStore(PhysicsBodySoASchema);

    const checkerEntities = this.entityManager.queryEntities(
      ComponentType.Checker,
      ComponentType.Transform,
    );

    let whiteIdx = 0;
    let blackIdx = 0;

    for (const entity of checkerEntities) {
      const checker = entity.getComponent<CheckerComponent>(ComponentType.Checker)!;
      const transform = entity.getComponent<TransformComponent>(ComponentType.Transform)!;

      // Revive checker
      checker.isAlive = true;

      const pi = pStore.indexOf(entity.id);
      if (pi !== -1) {
        pStore.arrays.isAlive[pi] = 1;
        pStore.arrays.isMoving[pi] = 0;
        pStore.arrays.velocityX[pi] = 0n;
        pStore.arrays.velocityZ[pi] = 0n;
      }

      // Compute new position
      const row = checker.team === TeamTag.White ? gs.whiteRow : gs.blackRow;
      const col = checker.team === TeamTag.White ? whiteIdx++ : blackIdx++;

      const half = (BOARD_SIZE - 1) / 2;
      const x = (col - half) * CELL_SIZE;
      const z = (row - half) * CELL_SIZE;
      const y = BOARD_HEIGHT / 2 + CHECKER_HEIGHT / 2;

      transform.fpPosition = FPVector3.FromFloat(x, y, z);
    }

    gs.whiteAliveCount = CHECKERS_PER_TEAM;
    gs.blackAliveCount = CHECKERS_PER_TEAM;
    gs.whiteElimThisTurn = 0;
    gs.blackElimThisTurn = 0;
    this.turnEliminations = [];
  }

  // ── Cleanup ────────────────────────────────────────────────────

  public override dispose(): void {
    super.dispose();
  }
}


