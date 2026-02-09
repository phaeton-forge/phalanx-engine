import { Engine, Scene } from '@babylonjs/core';
import { SystemRegistry } from './SystemRegistry';
import { LockstepManager } from './LockstepManager';
import { EntityFactory } from './EntityFactory';
import { UIManager } from './UIManager';
import { AssetManager } from './AssetManager';
import { NetworkCoordinator } from './NetworkCoordinator';
import { GameEventCoordinator } from './GameEventCoordinator';
import { GameInitializer } from './GameInitializer';
import { EntityCleanupService } from './EntityCleanupService';
import { SceneManager } from './SceneManager';
import { MovementSystem } from '../systems/MovementSystem';
import { PhysicsSystem } from '../systems/PhysicsSystem';
import { HealthSystem } from '../systems/HealthSystem';
import { ProjectileSystem } from '../systems/ProjectileSystem';
import { CombatSystem } from '../systems/CombatSystem';
import { ResourceSystem } from '../systems/ResourceSystem';
import { TerritorySystem } from '../systems/TerritorySystem';
import { FormationGridSystem } from '../systems/FormationGridSystem';
import { VictorySystem } from '../systems/VictorySystem';
import { WaveSystem } from '../systems/WaveSystem';
import { InterpolationSystem } from '../systems/InterpolationSystem';
import { AnimationSystem } from '../systems/AnimationSystem';
import { RotationSystem } from '../systems/RotationSystem';
import { HealthBarSystem } from '../systems/HealthBarSystem';
import { CameraController } from '../systems/CameraController';
import { InputManager } from '../systems/InputManager';
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
  private gameInitializer!: GameInitializer;
  private entityCleanupService!: EntityCleanupService;

  // Managers
  private lockstepManager!: LockstepManager;
  private entityFactory!: EntityFactory;
  private uiManager!: UIManager;
  private assetManager!: AssetManager;

  // Core systems
  private sceneManager!: SceneManager;

  // Gameplay systems
  private movementSystem!: MovementSystem;
  private physicsSystem!: PhysicsSystem;
  private healthSystem!: HealthSystem;
  private projectileSystem!: ProjectileSystem;
  private combatSystem!: CombatSystem;
  private resourceSystem!: ResourceSystem;
  private territorySystem!: TerritorySystem;
  private formationGridSystem!: FormationGridSystem;
  private victorySystem!: VictorySystem;
  private waveSystem!: WaveSystem;

  // Visual systems
  private interpolationSystem!: InterpolationSystem;
  private animationSystem!: AnimationSystem;
  private rotationSystem!: RotationSystem;
  private healthBarSystem!: HealthBarSystem;

  // Input/Camera
  private cameraController!: CameraController;
  private inputManager!: InputManager;

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

    // Create system registry and initialize core dependencies
    this.systemRegistry = new SystemRegistry(this.engine, this.scene);
    this.systemRegistry.createCoreDependencies();

    // Create scene manager (not a GameSystem, but needed by other systems)
    this.sceneManager = new SceneManager(
      this.scene,
    );

    // Create all gameplay systems (core simulation systems)
    this.movementSystem = new MovementSystem();
    this.physicsSystem = new PhysicsSystem();
    this.healthSystem = new HealthSystem();
    this.projectileSystem = new ProjectileSystem();
    this.combatSystem = new CombatSystem();
    this.resourceSystem = new ResourceSystem();
    this.territorySystem = new TerritorySystem();
    this.formationGridSystem = new FormationGridSystem();
    this.victorySystem = new VictorySystem();
    this.waveSystem = new WaveSystem();
    this.interpolationSystem = new InterpolationSystem();

    // Create visual systems
    this.animationSystem = new AnimationSystem();
    this.rotationSystem = new RotationSystem();

    // Define system processing order
    // Tick systems - order matters for determinism!
    // Physics must run first to update positions
    // Movement checks for arrival after physics
    // Combat uses updated positions for targeting
    // Projectiles need combat results
    // Health processes death timers
    // Resources/Wave/Territory are independent
    const tickSystems = [
      this.physicsSystem,
      this.movementSystem,
      this.combatSystem,
      this.projectileSystem,
      this.healthSystem,
      this.resourceSystem,
      this.waveSystem,
      this.territorySystem,
      this.formationGridSystem,
      this.victorySystem,
    ];

    // Frame systems - visual updates only
    // Animation and rotation before interpolation
    const frameSystems = [
      this.resourceSystem, // UI updates
      this.animationSystem,
      this.rotationSystem,
      this.interpolationSystem,
      this.formationGridSystem,
      this.combatSystem, // Tower turret rotation
    ];

    // Register systems and call init() on each
    this.systemRegistry.registerSystems(tickSystems, frameSystems);

    this.setupResizeHandler();
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
    // Phase 1: Initialize entity factory
    this.entityFactory = new EntityFactory(
      this.sceneManager,
      this.systemRegistry.entityManager
    );
    this.entityFactory.setInterpolationSystem(this.interpolationSystem);

    // Phase 2: Initialize UI manager
    this.uiManager = new UIManager(
      this.resourceSystem,
      this.formationGridSystem,
      this.matchData.playerId
    );

    // Phase 3: Initialize AssetManager for preloading 3D models
    this.assetManager = new AssetManager(this.scene);

    // Phase 4: Initialize game initializer
    this.gameInitializer = new GameInitializer(
      this.entityFactory,
      this.uiManager,
      this.assetManager,
      {
        sceneManager: this.sceneManager,
        resourceSystem: this.resourceSystem,
        formationGridSystem: this.formationGridSystem,
        victorySystem: this.victorySystem,
        waveSystem: this.waveSystem,
        movementSystem: this.movementSystem,
        interpolationSystem: this.interpolationSystem,
      },
      this.matchData,
      this.localTeam,
      this.client
    );

    this.uiManager.setupBeforeUnloadWarning();
    this.uiManager.setupExitButton(() => this.handleExit());

    // Phase 5: Preload assets (async)
    await this.gameInitializer.initialize();

    // Phase 6: Create late-initialized systems
    this.cameraController = new CameraController(this.scene, this.localTeam);
    this.healthBarSystem = new HealthBarSystem();
    this.healthBarSystem.init(this.systemRegistry.getContext());

    // Register healthBarSystem as a frame system (late initialization)
    this.systemRegistry.addFrameSystem(this.healthBarSystem);

    // Set late systems in initializer
    this.gameInitializer.setLateSystems(
      this.cameraController
    );

    // Phase 7: Create input manager
    this.inputManager = new InputManager(
      this.sceneManager
    );
    this.inputManager.init(this.systemRegistry.getContext());

    // Phase 8: Create lockstep manager (needs all systems)
    this.lockstepManager = this.createLockstepManager();

    // Phase 9: Create entity cleanup service
    this.entityCleanupService = new EntityCleanupService(
      this.systemRegistry.entityManager,
      this.entityFactory,
      this.interpolationSystem
    );

    // Phase 10: Create coordinators
    this.createCoordinators();

    // Phase 11: Setup scene and create entities
    this.gameInitializer.setupScene();

    // Phase 12: Setup unit placement UI
    this.setupUnitPlacementUI();
  }

  /**
   * Create LockstepManager with all dependencies
   */
  private createLockstepManager(): LockstepManager {
    return new LockstepManager(
      this.client,
      {
        movementSystem: this.movementSystem,
        formationGridSystem: this.formationGridSystem,
        eventBus: this.systemRegistry.eventBus,
      },
      this.systemRegistry,
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
  private createCoordinators(): void {
    // Create network coordinator
    this.networkCoordinator = new NetworkCoordinator(
      this.client,
      this.lockstepManager,
      this.systemRegistry,
      this.uiManager,
      this.scene,
      {
        cameraController: this.cameraController,
        interpolationSystem: this.interpolationSystem,
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
      this.systemRegistry.eventBus,
      this.uiManager,
      this.lockstepManager,
      this.systemRegistry.entityManager,
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
  private setupUnitPlacementUI(): void {
    this.uiManager.setupUnitPlacementButtons(
      () => this.handleUnitButtonClick('mutant'),
      () => this.handleUnitButtonClick('prisma'),
      () => this.handleUnitButtonClick('lance')
    );

    // Setup touch drag callbacks for mobile unit placement
    this.uiManager.setDragCallbacks({
      onDragStart: (unitType) => {
        this.cameraController.enableDragMode();
        this.formationGridSystem.startTouchDrag(
          this.matchData.playerId,
          unitType
        );
      },
      onDragMove: (x, y) => {
        this.formationGridSystem.updateTouchDrag(x, y);
      },
      onDragEnd: (x, y) => {
        this.formationGridSystem.endTouchDrag(x, y);
        this.cameraController.disableDragMode();
      },
      onDragCancel: () => {
        this.formationGridSystem.cancelTouchDrag();
        this.cameraController.disableDragMode();
      },
    });
  }

  /**
   * Handle unit button click
   */
  private handleUnitButtonClick(
    unitType: 'mutant' | 'prisma' | 'lance'
  ): void {
    this.uiManager.setActiveUnitButton(unitType);
    this.formationGridSystem.enterPlacementMode(
      this.matchData.playerId,
      unitType
    );
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
    this.uiManager?.dispose();

    // Dispose late systems (not in SystemRegistry)
    this.cameraController?.dispose();
    this.inputManager?.dispose();

    // Dispose scene manager
    this.sceneManager?.dispose();

    // Dispose all systems registered in SystemRegistry
    this.systemRegistry.dispose();

    // Clear managers
    this.entityFactory?.clear();
    this.assetManager?.dispose();

    // Dispose engine
    this.engine.dispose();
  }
}
