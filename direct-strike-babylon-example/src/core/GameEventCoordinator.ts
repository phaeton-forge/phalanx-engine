import type { EventBus } from '@phalanx-engine/ecs';
import type { UIManager } from './UIManager';
import type { LockstepManager } from './LockstepManager';
import { TeamTag } from '../enums/TeamTag';
import { GameEvents } from '../events';
import type {
  GameOverEvent,
  AggressionBonusActivatedEvent,
  AggressionBonusDeactivatedEvent,
  WaveCountdownEvent,
  WaveStartedEvent,
  WaveDeploymentEvent,
  FormationModeEnteredEvent,
  FormationPlacementFailedEvent,
  FormationPlacementRequestedEvent,
  FormationUnitMoveRequestedEvent,
  MoveRequestedEvent,
} from '../events';
import type { EntityManager } from '@phalanx-engine/ecs';
import type { EntityFactory } from './EntityFactory';
import type {
  NetworkMoveCommand,
  NetworkPlaceUnitCommand,
  NetworkMoveGridUnitCommand,
} from './NetworkCommands';

/**
 * Context needed by GameEventCoordinator
 */
export interface GameEventContext {
  localPlayerId: string;
  localTeam: TeamTag;
}

/**
 * GameEventCoordinator callbacks
 */
export interface GameEventCoordinatorCallbacks {
  onGameOver: (isWinner: boolean) => void;
}

/**
 * GameEventCoordinator - Handles all game event subscriptions
 *
 * Responsible for:
 * - Game over events
 * - Territory change events
 * - Resource change events
 * - Formation events
 * - Wave events
 * - Move command interception
 */
export class GameEventCoordinator {
  private eventBus: EventBus;
  private uiManager: UIManager;
  private lockstepManager: LockstepManager;
  private entityManager: EntityManager;
  private entityFactory: EntityFactory;
  private context: GameEventContext;
  private callbacks: GameEventCoordinatorCallbacks;

  constructor(
    eventBus: EventBus,
    uiManager: UIManager,
    lockstepManager: LockstepManager,
    entityManager: EntityManager,
    entityFactory: EntityFactory,
    context: GameEventContext,
    callbacks: GameEventCoordinatorCallbacks
  ) {
    this.eventBus = eventBus;
    this.uiManager = uiManager;
    this.lockstepManager = lockstepManager;
    this.entityManager = entityManager;
    this.entityFactory = entityFactory;
    this.context = context;
    this.callbacks = callbacks;
  }

  /**
   * Setup all game event handlers
   */
  public setupAllEventHandlers(): void {
    this.setupGameOverHandler();
    this.setupTerritoryHandlers();
    this.setupFormationHandlers();
    this.setupWaveHandlers();
    this.setupMoveCommandInterceptor();
  }

  /**
   * Setup game over event handler
   */
  private setupGameOverHandler(): void {
    this.eventBus.on<GameOverEvent>(GameEvents.GAME_OVER, (event) => {
      const isWinner = event.winnerTeam === this.context.localTeam;
      const message = isWinner ? '🎉 Victory!' : '💀 Defeat!';
      this.uiManager.showNotification(message, isWinner ? 'info' : 'warning');
      this.callbacks.onGameOver(isWinner);
    });
  }

  /**
   * Setup territory change event handlers
   */
  private setupTerritoryHandlers(): void {
    this.eventBus.on<AggressionBonusActivatedEvent>(
      GameEvents.AGGRESSION_BONUS_ACTIVATED,
      (event) => {
        if (event.team === this.context.localTeam) {
          this.uiManager.showTerritoryIndicator();
        }
      }
    );

    this.eventBus.on<AggressionBonusDeactivatedEvent>(
      GameEvents.AGGRESSION_BONUS_DEACTIVATED,
      (event) => {
        if (event.team === this.context.localTeam) {
          this.uiManager.hideTerritoryIndicator();
        }
      }
    );
  }

  /**
   * Setup formation event handlers
   */
  private setupFormationHandlers(): void {
    // Formation placement requests
    this.eventBus.on<FormationPlacementRequestedEvent>(
      GameEvents.FORMATION_PLACEMENT_REQUESTED,
      (event) => {
        if (event.playerId === this.context.localPlayerId) {
          const command: NetworkPlaceUnitCommand = {
            type: 'placeUnit',
            data: {
              unitType: event.unitType,
              gridX: event.gridX,
              gridZ: event.gridZ,
            },
          };
          this.lockstepManager.queueCommand(command);
        }
      }
    );

    // Formation unit move requests (repositioning units on the grid)
    this.eventBus.on<FormationUnitMoveRequestedEvent>(
      GameEvents.FORMATION_UNIT_MOVE_REQUESTED,
      (event) => {
        if (event.playerId === this.context.localPlayerId) {
          const command: NetworkMoveGridUnitCommand = {
            type: 'moveGridUnit',
            data: {
              fromGridX: event.fromGridX,
              fromGridZ: event.fromGridZ,
              toGridX: event.toGridX,
              toGridZ: event.toGridZ,
            },
          };
          this.lockstepManager.queueCommand(command);
        }
      }
    );

    // Formation UI updates now happen via UI_FORMATION_UPDATED events
    // No direct UIManager calls needed here

    // Formation mode changes (UI button highlighting)
    this.eventBus.on<FormationModeEnteredEvent>(
      GameEvents.FORMATION_MODE_ENTERED,
      (event) => {
        // Only update UI for local player
        if (event.playerId === this.context.localPlayerId) {
          this.uiManager.setActiveUnitButton(event.unitType);
        }
      }
    );

    // Formation placement failed (show notification)
    this.eventBus.on<FormationPlacementFailedEvent>(
      GameEvents.FORMATION_PLACEMENT_FAILED,
      (event) => {
        if (event.playerId === this.context.localPlayerId) {
          if (event.reason === 'insufficient_resources') {
            this.uiManager.showNotification('Not enough resources!', 'warning');
          }
        }
      }
    );
  }

  /**
   * Setup wave event handlers
   */
  private setupWaveHandlers(): void {
    this.eventBus.on<WaveCountdownEvent>(GameEvents.WAVE_COUNTDOWN, (event) => {
      this.uiManager.updateWaveTimer(
        event.waveNumber,
        event.secondsRemaining,
        event.waveNumber === 0
      );
    });

    this.eventBus.on<WaveStartedEvent>(GameEvents.WAVE_STARTED, (event) => {
      if (event.isPreparationWave) {
        this.uiManager.showNotification(
          'Preparation phase - place your units!',
          'info'
        );
      } else {
        this.uiManager.showNotification(
          `Wave ${event.waveNumber} - Units deploying!`,
          'info'
        );
      }
    });

    this.eventBus.on<WaveDeploymentEvent>(
      GameEvents.WAVE_DEPLOYMENT,
      (event) => {
        if (event.totalUnitsDeployed > 0) {
          // Deployment notification handled elsewhere
        }
      }
    );
  }

  /**
   * Setup interceptor for local move commands to send over network
   */
  private setupMoveCommandInterceptor(): void {
    this.eventBus.on<MoveRequestedEvent>(GameEvents.MOVE_REQUESTED, (event) => {
      if (event._fromNetwork) return;

      const entity = this.entityManager.getEntity(event.entityId);
      if (!entity) return;

      if (
        this.entityFactory.isOwnedBy(event.entityId, this.context.localPlayerId)
      ) {
        const command: NetworkMoveCommand = {
          type: 'move',
          data: {
            entityId: event.entityId,
            targetX: event.target.x,
            targetY: event.target.y,
            targetZ: event.target.z,
          },
        };
        this.lockstepManager.queueCommand(command);
      }
    });
  }
}




