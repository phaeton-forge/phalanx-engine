import { Vector3, Color3 } from '@babylonjs/core';
import type { EntityFactory } from './EntityFactory';
import type { UIManager } from './UIManager';
import type { SystemContext } from '@phalanx-engine/ecs';
import type { SceneManager } from './SceneManager';
import { ResourceSystem } from '../systems/ResourceSystem';
import { FormationGridSystem } from '../systems/FormationGridSystem';
import { VictorySystem } from '../systems/VictorySystem';
import { WaveSystem } from '../systems/WaveSystem';
import type { CameraController } from '../systems/CameraController';
import type { AssetManager } from './AssetManager';
import type { PhalanxClient, MatchFoundEvent } from '@phalanx-engine/client';
import { TeamTag } from '../enums/TeamTag';
import { arenaParams } from '../config/constants';

/**
 * GameInitializer - Handles game world initialization
 *
 * Responsible for:
 * - Resetting entity ID counter
 * - Preloading assets
 * - Creating player entities (bases, towers)
 * - Initializing gameplay systems for players
 * - Setting up UI
 *
 * Uses SystemContext to access game systems via getSystem<T>() pattern.
 * SceneManager is passed separately as it's not a GameSystem.
 */
export class GameInitializer {
  private entityFactory: EntityFactory;
  private uiManager: UIManager;
  private assetManager: AssetManager;
  private context: SystemContext;
  private sceneManager: SceneManager;
  private matchData: MatchFoundEvent;
  private localTeam: TeamTag;
  private client: PhalanxClient;

  // Late-initialized systems (set after async init)
  private cameraController: CameraController | null = null;

  constructor(
    entityFactory: EntityFactory,
    uiManager: UIManager,
    assetManager: AssetManager,
    context: SystemContext,
    sceneManager: SceneManager,
    matchData: MatchFoundEvent,
    localTeam: TeamTag,
    client: PhalanxClient
  ) {
    this.entityFactory = entityFactory;
    this.uiManager = uiManager;
    this.assetManager = assetManager;
    this.context = context;
    this.sceneManager = sceneManager;
    this.matchData = matchData;
    this.localTeam = localTeam;
    this.client = client;
  }

  /**
   * Set late-initialized systems
   */
  public setLateSystems(
    cameraController: CameraController
  ): void {
    this.cameraController = cameraController;
  }

  /**
   * Initialize the game world
   */
  public async initialize(): Promise<void> {
    // Preload all 3D models before setting up the scene
    await this.assetManager.preloadAll();
  }

  /**
   * Setup scene after late systems are created
   */
  public setupScene(): void {
    // Auto-fit camera to show formation grid at game start
    this.cameraController?.focusOnFormationGrid();

    this.sceneManager.setupLighting();
    this.sceneManager.createGround();

    // Update UI
    const color = this.localTeam === TeamTag.Team1 ? '#3366cc' : '#cc3333';
    this.uiManager.updatePlayerInfoUI(color, this.client.getUsername());
    this.uiManager.resetTerritoryIndicator();

    // Create entities
    this.createPlayerEntities();

    // Initialize gameplay systems
    this.initializeGameplaySystems();
  }

  /**
   * Initialize gameplay systems
   */
  private initializeGameplaySystems(): void {
    const opponentId = this.getOpponentId();

    let team1PlayerId: string;
    let team2PlayerId: string;

    if (this.localTeam === TeamTag.Team1) {
      team1PlayerId = this.matchData.playerId;
      team2PlayerId = opponentId;
    } else {
      team1PlayerId = opponentId;
      team2PlayerId = this.matchData.playerId;
    }

    // Get systems from context
    const resourceSystem = this.context.getSystem(ResourceSystem)!;
    const formationGridSystem = this.context.getSystem(FormationGridSystem)!;
    const victorySystem = this.context.getSystem(VictorySystem)!;
    const waveSystem = this.context.getSystem(WaveSystem)!;

    // Initialize systems for both players
    resourceSystem.initializePlayer(team1PlayerId, TeamTag.Team1);
    resourceSystem.initializePlayer(team2PlayerId, TeamTag.Team2);

    formationGridSystem.initializeGrid(team1PlayerId, TeamTag.Team1);
    formationGridSystem.initializeGrid(team2PlayerId, TeamTag.Team2);

    // Set up callbacks for FormationGridSystem
    formationGridSystem.setCreateUnitCallback((unitType, team, position) => {
      return this.entityFactory.createUnitForFormation(
        unitType,
        team,
        position,
        this.matchData.playerId,
        this.localTeam,
        () => this.getOpponentId()
      );
    });

    // Set up affordability check callback
    formationGridSystem.setCanAffordCallback((playerId, unitType) => {
      return resourceSystem.canAfford(playerId, unitType);
    });

    // Register players in victory system
    victorySystem.registerPlayer(team1PlayerId, TeamTag.Team1);
    victorySystem.registerPlayer(team2PlayerId, TeamTag.Team2);

    // Initialize wave system
    waveSystem.registerPlayer(team1PlayerId);
    waveSystem.registerPlayer(team2PlayerId);

    // Set up wave deployment callback (legacy - used as fallback)
    waveSystem.setDeployUnitsCallback((playerId) => {
      return formationGridSystem.commitFormation(playerId);
    });

    // Set up staggered deployment callbacks for smoother spawning
    waveSystem.setStaggeredDeploymentCallbacks(
      // Get pending units
      (playerId) => formationGridSystem.getPendingUnitsForDeployment(playerId),
      // Deploy single unit
      (playerId, unitInfo) =>
        formationGridSystem.deploySingleUnit(playerId, unitInfo),
      // Finalize deployment
      (playerId, unitCount) =>
        formationGridSystem.finalizeDeployment(playerId, unitCount)
    );

    // Start the wave system (Wave 0 - preparation phase)
    waveSystem.start(0);

    // Set default placement mode for local player (mutant selected by default)
    formationGridSystem.enterPlacementMode(this.matchData.playerId, 'mutant');

    // Note: UI updates now happen automatically via events emitted by
    // ResourceSystem (UI_RESOURCES_UPDATED) and FormationGridSystem (UI_FORMATION_UPDATED)
  }

  /**
   * Create entities for both players
   */
  private createPlayerEntities(): void {
    const team1Color = new Color3(0.2, 0.4, 0.8);
    const team2Color = new Color3(0.8, 0.2, 0.2);

    const opponentId = this.getOpponentId();

    let team1OwnerId: string;
    let team2OwnerId: string;

    if (this.localTeam === TeamTag.Team1) {
      team1OwnerId = this.matchData.playerId;
      team2OwnerId = opponentId;
    } else {
      team1OwnerId = opponentId;
      team2OwnerId = this.matchData.playerId;
    }

    const victorySystem = this.context.getSystem(VictorySystem)!;

    // Create Team 1 entities
    const team1Base = this.entityFactory.createBase(
      {
        color: team1Color,
        team: TeamTag.Team1,
        debug: false,
      },
      new Vector3(arenaParams.teamA.base.x, 0, arenaParams.teamA.base.z)
    );
    this.entityFactory.setOwnership(team1Base.id, team1OwnerId);
    victorySystem.registerBase(team1Base.id, TeamTag.Team1);

    for (const towerPos of arenaParams.teamA.towers) {
      const tower = this.entityFactory.createTower(
        {
          color: team1Color,
          team: TeamTag.Team1,
          debug: false,
        },
        new Vector3(towerPos.x, 0, towerPos.z)
      );
      this.entityFactory.setOwnership(tower.id, team1OwnerId);
      victorySystem.registerTower(tower.id, TeamTag.Team1);
    }

    // Create Team 2 entities
    const team2Base = this.entityFactory.createBase(
      {
        color: team2Color,
        team: TeamTag.Team2,
        debug: false,
      },
      new Vector3(arenaParams.teamB.base.x, 0, arenaParams.teamB.base.z)
    );
    this.entityFactory.setOwnership(team2Base.id, team2OwnerId);
    victorySystem.registerBase(team2Base.id, TeamTag.Team2);

    for (const towerPos of arenaParams.teamB.towers) {
      const tower = this.entityFactory.createTower(
        {
          color: team2Color,
          team: TeamTag.Team2,
          debug: false,
        },
        new Vector3(towerPos.x, 0, towerPos.z)
      );
      this.entityFactory.setOwnership(tower.id, team2OwnerId);
      victorySystem.registerTower(tower.id, TeamTag.Team2);
    }
  }

  /**
   * Get opponent player ID
   */
  public getOpponentId(): string {
    return (
      this.matchData.opponents[0]?.playerId ??
      this.matchData.teammates[0]?.playerId ??
      'unknown-opponent'
    );
  }
}



