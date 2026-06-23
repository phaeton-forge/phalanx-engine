import type { SystemContext } from '@phalanx-engine/ecs';
import { GameSystem } from '@phalanx-engine/ecs';
import { GameEvents, createEvent } from '../events';
import { TeamTag } from '../enums/TeamTag';
import { resourceConfig } from '../config/constants';
import type {
  EntityDestroyedEvent,
  GameOverEvent,
  BaseDestroyedEvent,
  TowerDestroyedEvent,
} from '../events';

/**
 * VictorySystem - Monitors game state for victory conditions
 * Tracks base destruction and declares winners
 * Extends GameSystem for consistent lifecycle management
 */
export class VictorySystem extends GameSystem {
  private baseEntities: Map<TeamTag, number> = new Map(); // team -> entityId
  private towerEntities: Map<number, TeamTag> = new Map(); // entityId -> team
  private gameOver: boolean = false;
  private winnerTeam: TeamTag | null = null;

  // Player ID mapping
  private teamPlayers: Map<TeamTag, string> = new Map();

  constructor() {
    super();
  }

  /**
   * Initialize the system with context
   */
  public override init(context: SystemContext): void {
    super.init(context);
    this.setupEventListeners();
  }

  /**
   * Register a base entity for victory tracking
   */
  public registerBase(entityId: number, team: TeamTag): void {
    this.baseEntities.set(team, entityId);
  }

  /**
   * Register a tower entity for destruction bonus tracking
   */
  public registerTower(entityId: number, team: TeamTag): void {
    this.towerEntities.set(entityId, team);
  }

  /**
   * Register a player for a team
   */
  public registerPlayer(playerId: string, team: TeamTag): void {
    this.teamPlayers.set(team, playerId);
  }

  private setupEventListeners(): void {
    // Listen for entity destruction
    this.subscribe<EntityDestroyedEvent>(
      GameEvents.ENTITY_DESTROYED,
      (event) => {
        this.handleEntityDestroyed(event);
      }
    );
  }

  /**
   * Handle entity destruction - check for base/tower
   */
  private handleEntityDestroyed(event: EntityDestroyedEvent): void {
    if (this.gameOver) return;

    // Check if it's a base
    for (const [team, baseId] of this.baseEntities) {
      if (baseId === event.entityId) {
        this.handleBaseDestroyed(team, event.entityId);
        return;
      }
    }

    // Check if it's a tower
    const towerTeam = this.towerEntities.get(event.entityId);
    if (towerTeam !== undefined) {
      this.handleTowerDestroyed(towerTeam, event.entityId);
    }
  }

  /**
   * Handle base destruction - game over!
   */
  private handleBaseDestroyed(destroyedTeam: TeamTag, entityId: number): void {
    const winnerTeam =
      destroyedTeam === TeamTag.Team1 ? TeamTag.Team2 : TeamTag.Team1;
    const winnerPlayerId = this.teamPlayers.get(winnerTeam) ?? 'unknown';

    this.gameOver = true;
    this.winnerTeam = winnerTeam;

    // Emit base destroyed event
    this.eventBus.emit<BaseDestroyedEvent>(GameEvents.BASE_DESTROYED, {
      ...createEvent(),
      team: destroyedTeam,
      entityId,
    });

    // Emit game over event
    this.eventBus.emit<GameOverEvent>(GameEvents.GAME_OVER, {
      ...createEvent(),
      winnerTeam,
      winnerPlayerId,
      reason: 'base_destroyed',
    });
  }

  /**
   * Handle tower destruction - grant resource bonus
   */
  private handleTowerDestroyed(destroyedTeam: TeamTag, entityId: number): void {
    // Emit tower destroyed event with resource bonus
    this.eventBus.emit<TowerDestroyedEvent>(GameEvents.TOWER_DESTROYED, {
      ...createEvent(),
      team: destroyedTeam,
      entityId,
      resourceBonus: resourceConfig.towerDestructionBonus,
    });

    // Remove from tracking
    this.towerEntities.delete(entityId);
  }

  /**
   * Check if game is over
   */
  public isGameOver(): boolean {
    return this.gameOver;
  }

  /**
   * Get the winner team (null if game not over)
   */
  public getWinner(): TeamTag | null {
    return this.winnerTeam;
  }

  /**
   * Get the winner player ID
   */
  public getWinnerPlayerId(): string | null {
    if (!this.winnerTeam) return null;
    return this.teamPlayers.get(this.winnerTeam) ?? null;
  }

  /**
   * Force game over (e.g., player disconnect)
   */
  public forceGameOver(
    winnerTeam: TeamTag,
    reason: 'disconnect' | 'forfeit'
  ): void {
    if (this.gameOver) return;

    const winnerPlayerId = this.teamPlayers.get(winnerTeam) ?? 'unknown';

    this.gameOver = true;
    this.winnerTeam = winnerTeam;

    this.eventBus.emit<GameOverEvent>(GameEvents.GAME_OVER, {
      ...createEvent(),
      winnerTeam,
      winnerPlayerId,
      reason,
    });
  }

  /**
   * Reset for new game
   */
  public reset(): void {
    this.baseEntities.clear();
    this.towerEntities.clear();
    this.teamPlayers.clear();
    this.gameOver = false;
    this.winnerTeam = null;
  }

  /**
   * Cleanup
   */
  public override dispose(): void {
    super.dispose(); // Clean up subscriptions from base class
    this.reset();
  }
}
