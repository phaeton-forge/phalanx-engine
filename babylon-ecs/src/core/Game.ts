import { Engine, Scene } from '@babylonjs/core';
import { SystemRegistry, type GameSystems } from './SystemRegistry';
import { LockstepManager } from './LockstepManager';
import { EntityFactory } from './EntityFactory';
import { UIManager } from './UIManager';
import { AssetManager } from './AssetManager';
import { NetworkCoordinator } from './NetworkCoordinator';
import { GameEventCoordinator } from './GameEventCoordinator';
import { GameInitializer } from './GameInitializer';
import { EntityCleanupService } from './EntityCleanupService';
import type { ISelectableEntity } from '../systems/SelectionSystem';
import { TeamTag } from '../enums/TeamTag';
import type { PhalanxClient, MatchFoundEvent } from 'phalanx-client';

/**
 * Game - Main game orchestrator using component-based architecture
 * Supports networked 1v1 multiplayer via Phalanx Engine
 *
 * This class acts as a thin orchestrator, delegating responsibilities to:
 * - SystemRegistry: System creation and wiring
 * - NetworkCoordinator: Network events and tick/frame handling
 * - GameEventCoordinator: Game event subscriptions
 * - GameInitializer: World setup and entity creation
 * - EntityCleanupService: Entity destruction cleanup
 * - LockstepManager: Deterministic simulation and network sync
 * - EntityFactory: Entity creation and registration
 * - UIManager: All UI interactions and updates
 */
export class Game {
  private engine: Engine;
  private scene: Scene;

  // Network
  private client: PhalanxClient;
  private matchData: MatchFoundEvent;
  private localTeam: TeamTag;

  // Registries and coordinators
  private systemRegistry: SystemRegistry;
  private networkCoordinator!: NetworkCoordinator;
  private gameEventCoordinator!: GameEventCoordinator;
  private gameInitializer: GameInitializer;
  private entityCleanupService!: EntityCleanupService;

  // Managers
  private lockstepManager!: LockstepManager;
  private entityFactory: EntityFactory;
  private uiManager: UIManager;
  private assetManager: AssetManager;

  // Callbacks
  private onExit: (() => void) | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    client: PhalanxClient,
    matchData: MatchFoundEvent
  ) {
    // Prevent context menu on right-click
    canvas.oncontextmenu = (e) => {
      e.preventDefault();
      return false;
    };

    this.client = client;
    this.matchData = matchData;

    // Determine local team based on teamId from match data
    this.localTeam = matchData.teamId === 1 ? TeamTag.Team1 : TeamTag.Team2;

    this.engine = new Engine(canvas, true);
    this.scene = new Scene(this.engine);

    // Create system registry and initialize core systems
    this.systemRegistry = new SystemRegistry(this.engine, this.scene);
    this.systemRegistry.createCoreSystems();
    this.systemRegistry.wireSystemCallbacks();

    const systems = this.systemRegistry.getSystems();

    // Initialize entity factory
    this.entityFactory = new EntityFactory(
      systems.sceneManager,
      systems.entityManager,
      systems.selectionSystem,
      systems.physicsSystem
    );
    this.entityFactory.setInterpolationSystem(systems.interpolationSystem);

    // Initialize UI manager
    this.uiManager = new UIManager(
      systems.resourceSystem,
      systems.formationGridSystem,
      this.matchData.playerId
    );

    // Initialize AssetManager for preloading 3D models
    this.assetManager = new AssetManager(this.scene);

    // Initialize game initializer
    this.gameInitializer = new GameInitializer(
      this.entityFactory,
      this.uiManager,
      this.assetManager,
      {
        sceneManager: systems.sceneManager,
        resourceSystem: systems.resourceSystem,
        formationGridSystem: systems.formationGridSystem,
        victorySystem: systems.victorySystem,
        waveSystem: systems.waveSystem,
        movementSystem: systems.movementSystem,
        interpolationSystem: systems.interpolationSystem,
      },
      this.matchData,
      this.localTeam,
      this.client
    );

    this.setupResizeHandler();
    this.uiManager.setupBeforeUnloadWarning();
    this.uiManager.setupExitButton(() => this.handleExit());
  }

  /**
   * Set callback for exit
   */
  public setOnExit(callback: () => void): void {
    this.onExit = callback;
  }

  /**
   * Handle exit
   */
  private handleExit(): void {
    this.uiManager.removeBeforeUnloadWarning();
    this.client.disconnect();
    this.onExit?.();
  }

  /**
   * Initialize the game world
   */
  public async initialize(): Promise<void> {
    // Phase 1: Preload assets (async)
    await this.gameInitializer.initialize();

    // Phase 2: Create late-initialized systems
    this.systemRegistry.createLateSystems(this.localTeam);
    const systems = this.systemRegistry.getSystems();

    // Set late systems in initializer
    this.gameInitializer.setLateSystems(
      systems.healthBarSystem,
      systems.cameraController
    );

    // Phase 3: Create lockstep manager (needs all systems)
    this.lockstepManager = this.createLockstepManager(systems);

    // Phase 4: Create entity cleanup service
    this.entityCleanupService = new EntityCleanupService(
      systems.entityManager,
      this.entityFactory,
      systems.physicsSystem,
      systems.interpolationSystem,
      systems.healthBarSystem,
      systems.selectionSystem
    );

    // Phase 5: Create coordinators
    this.createCoordinators(systems);

    // Phase 6: Setup scene and create entities
    this.gameInitializer.setupScene();

    // Phase 7: Setup unit placement UI
    this.setupUnitPlacementUI(systems);

    // Phase 8: Setup selection filter
    this.setupSelectionFilter(systems);
  }

  /**
   * Create LockstepManager with all dependencies
   */
  private createLockstepManager(systems: GameSystems): LockstepManager {
    return new LockstepManager(
      this.client,
      {
        movementSystem: systems.movementSystem,
        physicsSystem: systems.physicsSystem,
        combatSystem: systems.combatSystem,
        projectileSystem: systems.projectileSystem,
        territorySystem: systems.territorySystem,
        resourceSystem: systems.resourceSystem,
        formationGridSystem: systems.formationGridSystem,
        waveSystem: systems.waveSystem,
        healthSystem: systems.healthSystem,
        eventBus: systems.eventBus,
      },
      {
        onCleanupNeeded: () => this.entityCleanupService.cleanupDestroyedEntities(),
        onNotification: (msg, type) =>
          this.uiManager.showNotification(msg, type),
        onCommitButtonUpdate: () => this.uiManager.updateFormationInfo(),
        getLocalTeam: () => this.localTeam,
        getLocalPlayerId: () => this.matchData.playerId,
      }
    );
  }

  /**
   * Create network and game event coordinators
   */
  private createCoordinators(systems: GameSystems): void {
    // Create network coordinator
    this.networkCoordinator = new NetworkCoordinator(
      this.client,
      this.lockstepManager,
      this.uiManager,
      this.scene,
      {
        cameraController: systems.cameraController,
        resourceSystem: systems.resourceSystem,
        combatSystem: systems.combatSystem,
        animationSystem: systems.animationSystem,
        rotationSystem: systems.rotationSystem,
        interpolationSystem: systems.interpolationSystem,
        healthBarSystem: systems.healthBarSystem,
      },
      {
        onPlayerDisconnected: () => this.handleExit(),
        onPlayerReconnected: () => {},
        onMatchEnd: () => this.handleExit(),
      }
    );

    this.networkCoordinator.setupNetworkEventHandlers();
    this.networkCoordinator.setupPhalanxClientHandlers();

    // Create game event coordinator
    this.gameEventCoordinator = new GameEventCoordinator(
      systems.eventBus,
      this.uiManager,
      this.lockstepManager,
      systems.entityManager,
      this.entityFactory,
      {
        localPlayerId: this.matchData.playerId,
        localTeam: this.localTeam,
      },
      {
        onGameOver: (_isWinner) => {
          setTimeout(() => {
            this.handleExit();
          }, 5000);
        },
      }
    );

    this.gameEventCoordinator.setupAllEventHandlers();
  }

  /**
   * Setup unit placement UI
   */
  private setupUnitPlacementUI(systems: GameSystems): void {
    this.uiManager.setupUnitPlacementButtons(
      () => this.handleUnitButtonClick(systems, 'mutant'),
      () => this.handleUnitButtonClick(systems, 'prisma'),
      () => this.handleUnitButtonClick(systems, 'lance')
    );

    // Setup touch drag callbacks for mobile unit placement
    this.uiManager.setDragCallbacks({
      onDragStart: (unitType) => {
        systems.cameraController.enableDragMode();
        systems.formationGridSystem.startTouchDrag(
          this.matchData.playerId,
          unitType
        );
      },
      onDragMove: (x, y) => {
        systems.formationGridSystem.updateTouchDrag(x, y);
      },
      onDragEnd: (x, y) => {
        systems.formationGridSystem.endTouchDrag(x, y);
        systems.cameraController.disableDragMode();
      },
      onDragCancel: () => {
        systems.formationGridSystem.cancelTouchDrag();
        systems.cameraController.disableDragMode();
      },
    });
  }

  /**
   * Handle unit button click
   */
  private handleUnitButtonClick(
    systems: GameSystems,
    unitType: 'mutant' | 'prisma' | 'lance'
  ): void {
    this.uiManager.setActiveUnitButton(unitType);
    systems.formationGridSystem.enterPlacementMode(
      this.matchData.playerId,
      unitType
    );
  }

  /**
   * Setup selection filter
   */
  private setupSelectionFilter(systems: GameSystems): void {
    const originalSelectEntity = systems.selectionSystem.selectEntity.bind(
      systems.selectionSystem
    );

    systems.selectionSystem.selectEntity = (entity: ISelectableEntity) => {
      originalSelectEntity(entity);
    };
  }

  private setupResizeHandler(): void {
    window.addEventListener('resize', () => {
      this.engine.resize();
    });
  }

  /**
   * Start the game
   * The render loop is managed by PhalanxClient via onFrame handler
   */
  public start(): void {
    // PhalanxClient manages the render loop via onFrame callback
    // No need for engine.runRenderLoop() anymore
  }

  /**
   * Cleanup resources
   */
  public dispose(): void {
    // Dispose coordinators first
    this.networkCoordinator?.dispose();

    // Dispose UI
    this.uiManager.dispose();

    // Dispose all systems
    this.systemRegistry.dispose();

    // Clear managers
    this.entityFactory.clear();
    this.assetManager.dispose();

    // Dispose engine
    this.engine.dispose();
  }
}
