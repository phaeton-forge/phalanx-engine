import { Engine, Scene } from '@babylonjs/core';
import { GameWorld } from '@phalanx-engine/ecs';
import type { SoASchemaDefinition, SoAComponentStore, CommandsBatch } from '@phalanx-engine/ecs';
import { ProjectileEntity } from '../entities/ProjectileEntity';
import { ProjectileComponent, TeamComponent, InterpolationComponent, TransformSoASchema } from '../components';
import { LockstepManager } from './LockstepManager';
import { EntityFactory } from './EntityFactory';
import { UIManager } from './UIManager';
import { AssetManager } from './AssetManager';
import { GameEventCoordinator } from './GameEventCoordinator';
import { GameInitializer } from './GameInitializer';
import { EntityCleanupService } from './EntityCleanupService';
import { SceneManager } from './SceneManager';
import { MovementSystem } from '../systems/MovementSystem';
import { PhysicsWorld } from '@phalanx-engine/physics';
import { FP } from '@phalanx-engine/math';
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
import { TeamTag } from '../enums/TeamTag';
import { ComponentType } from '../components';
import { networkConfig } from '../config/constants';
import type { PhalanxClient, MatchFoundEvent } from '@phalanx-engine/client';

/**
 * Game - Main game orchestrator using component-based architecture
 * Supports networked 1v1 multiplayer via Phalanx Engine
 *
 * This class acts as a thin orchestrator, delegating responsibilities to:
 * - GameWorld: ECS facade (systems, entities, events, tick/frame loop)
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

  // ECS facade
  private world: GameWorld;

  // Coordinators
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

  // Network event unsubscribers
  private networkEventUnsubscribers: (() => void)[] = [];

  // Gameplay systems
  private movementSystem!: MovementSystem;
  private physicsWorld!: PhysicsWorld;
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

    const debugPanelEnabled = import.meta.env.DEV;

    // Create GameWorld facade (replaces SystemRegistry + NetworkCoordinator)
    this.world = new GameWorld({
      componentTypes: Object.values(ComponentType),
      tickFrameProvider: this.client,
      debug: debugPanelEnabled,
      debugPanelConfig: debugPanelEnabled
        ? {
          toggleKey: 'Backquote',
        }
        : undefined,
      pooling: {
        entityTypes: {
          'projectile': {
            factory: () => new ProjectileEntity(),
            pool: { initialSize: 50, maxSize: 200 },
            components: [
              { type: ComponentType.Projectile, factory: () => new ProjectileComponent() },
              { type: ComponentType.Team, factory: () => new TeamComponent() },
              { type: ComponentType.Interpolation, factory: () => new InterpolationComponent() },
            ],
          },
        },
      },
    });

    // Create scene manager (not a GameSystem, but needed by other systems)
    this.sceneManager = new SceneManager(
      this.scene,
    );

    // Create all gameplay systems (core simulation systems)
    this.movementSystem = new MovementSystem();

    // Create PhysicsWorld (phalanx-physics facade)
    this.physicsWorld = new PhysicsWorld({
      gridCellSize: FP.FromFloat(8),
      subSteps: networkConfig.physicsSubsteps,
      tickRate: networkConfig.tickRate,
      maxVelocity: FP.FromFloat(15.0),
      pushStrength: FP.FromFloat(15.0),
    });
    const { physicsSystem } = this.physicsWorld.getSystems();

    // Wire game-specific collision filter:
    // Skip collisions between units and friendly buildings (same-team static entities)
    const entityManager = this.world.entityManager;
    this.physicsWorld.setCollisionFilter((entityIdA: number, entityIdB: number) => {
      const eA = entityManager.getEntity(entityIdA);
      const eB = entityManager.getEntity(entityIdB);
      if (!eA || !eB) return false;

      const bodyA = eA.getComponent<import('@phalanx-engine/physics').PhysicsBodyComponent>(ComponentType.PhysicsBody);
      const bodyB = eB.getComponent<import('@phalanx-engine/physics').PhysicsBodyComponent>(ComponentType.PhysicsBody);

      if ((bodyA?.isStatic || bodyB?.isStatic)) {
        const teamA = eA.getComponent<TeamComponent>(ComponentType.Team);
        const teamB = eB.getComponent<TeamComponent>(ComponentType.Team);
        if (teamA && teamB && teamA.team === teamB.team) {
          return false; // skip same-team static collisions
        }
      }
      return true;
    });

    this.healthSystem = new HealthSystem();
    this.projectileSystem = new ProjectileSystem(this.scene);
    this.combatSystem = new CombatSystem();
    this.resourceSystem = new ResourceSystem();
    this.territorySystem = new TerritorySystem();
    this.formationGridSystem = new FormationGridSystem(this.scene);
    this.victorySystem = new VictorySystem();
    this.waveSystem = new WaveSystem();
    this.interpolationSystem = new InterpolationSystem();

    // Create visual systems
    this.animationSystem = new AnimationSystem(this.scene);
    this.rotationSystem = new RotationSystem();
    this.healthBarSystem = new HealthBarSystem(this.scene);

    // Define system processing order
    // Tick systems - order matters for determinism!
    // 1. MovementSystem sets velocities on PhysicsBodyComponent
    // 2. PhysicsSystem runs full pipeline per sub-step: integrate → collide → friction
    // 3. Combat/Health/etc. react to updated positions and collision events
    const tickSystems = [
      this.movementSystem,
      physicsSystem,
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
      this.healthBarSystem,
    ];

    // Register systems and call init() on each
    this.world.registerSystems(tickSystems, frameSystems);

    // Wire pool manager to ProjectileSystem
    this.projectileSystem.setPoolManager(this.world.pools);

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
      this.world.entityManager,
    );

    // Phase 2: Initialize UI manager (decoupled from systems, uses EventBus)
    this.uiManager = new UIManager(
      this.world.eventBus,
      this.matchData.playerId
    );

    // Phase 3: Initialize AssetManager for preloading 3D models
    this.assetManager = new AssetManager(this.scene);

    // Phase 4: Initialize game initializer (uses SystemContext to access systems)
    this.gameInitializer = new GameInitializer(
      this.entityFactory,
      this.uiManager,
      this.assetManager,
      this.world.context,
      this.sceneManager,
      this.matchData,
      this.localTeam,
      this.client
    );

    this.uiManager.setupBeforeUnloadWarning();
    this.uiManager.setupExitButton(() => this.handleExit());
    this.uiManager.setupPauseButton(
      () => this.world.pause(),
      () => this.world.resume()
    );

    // Phase 5: Preload assets (async)
    await this.gameInitializer.initialize();

    // Phase 6: Create late-initialized systems
    this.cameraController = new CameraController(this.scene, this.localTeam);

    // Setup "Switch To Base" button (needs cameraController)
    this.uiManager.setupBaseButton(() => this.cameraController.focusOnFormationGrid());

    // Set late systems in initializer
    this.gameInitializer.setLateSystems(
      this.cameraController
    );

    // Phase 7: Create lockstep manager (needs all systems)
    this.lockstepManager = this.createLockstepManager();

    // Phase 8: Create entity cleanup service (pool-aware)
    this.entityCleanupService = new EntityCleanupService(
      this.world.entityManager,
      this.entityFactory,
      this.world.pools
    );

    // Phase 9: Create coordinators
    this.createCoordinators();

    // Phase 10: Setup scene and create entities
    this.gameInitializer.setupScene();

    // Phase 11: Setup unit placement UI
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
        eventBus: this.world.eventBus,
      },
      {
        onCleanupNeeded: () => this.entityCleanupService.cleanupDestroyedEntities(),
        onNotification: (msg, type) =>
          this.uiManager.showNotification(msg, type),
        // Formation UI updates now happen via UI_FORMATION_UPDATED events
        onCommitButtonUpdate: () => {},
        getLocalTeam: () => this.localTeam,
        getLocalPlayerId: () => this.matchData.playerId,
      }
    );
  }

  /**
   * Setup network event handlers and game event coordinators, then start the world loop
   */
  private createCoordinators(): void {
    this.networkEventUnsubscribers.push(
      this.client.on('playerDisconnected', (_event) => {
        this.uiManager.showNotification('Opponent disconnected', 'warning');
        setTimeout(() => {
          this.handleExit();
        }, 3000);
      })
    );

    this.networkEventUnsubscribers.push(
      this.client.on('playerReconnected', (_event) => {
        this.uiManager.showNotification('Opponent reconnected', 'info');
      })
    );

    this.networkEventUnsubscribers.push(
      this.client.on('matchEnd', (event) => {
        this.uiManager.showNotification(`Match ended: ${event.reason}`, 'info');
        setTimeout(() => {
          this.handleExit();
        }, 2000);
      })
    );

    // Pause / Resume — listen to client events directly to get pausedBy info.
    // Note: GameWorld also subscribes to pause/resume via ITickFrameProvider
    // and handles stopping the tick loop. We just update the UI here.
    this.networkEventUnsubscribers.push(
      this.client.on('gamePaused', (event) => {
        this.uiManager.showPauseOverlay(event.requestedBy);
      })
    );

    this.networkEventUnsubscribers.push(
      this.client.on('gameResumed', () => {
        this.uiManager.hidePauseOverlay();
      })
    );

    this.world.start({
      beforeTick: (tick: number, commandsBatch: CommandsBatch) => {
        // Link transform store to physics on first tick
        if (tick === 0) {
          const txStore = this.world.entityManager.getOrCreateSoAStore(TransformSoASchema);
          this.physicsWorld.setTransformStore(
            txStore as unknown as SoAComponentStore<SoASchemaDefinition>,
            {
              fpPositionX: 'fpPositionX',
              fpPositionY: 'fpPositionY',
              fpPositionZ: 'fpPositionZ',
              visualPositionX: 'visualPositionX',
              visualPositionZ: 'visualPositionZ',
            },
          );
        }

        // Snapshot positions before simulation
        this.interpolationSystem.snapshotPositions();

        // Execute commands through lockstep manager (before tick systems run)
        this.lockstepManager.processTick(tick, commandsBatch);
      },
      afterTick: (_tick: number) => {
        // Capture new positions after simulation
        this.interpolationSystem.captureCurrentPositions();

        // Cleanup destroyed entities
        this.lockstepManager.cleanup();
      },
      beforeFrame: (_alpha: number, dt: number) => {
        // Update camera controller (keyboard/touch input)
        this.cameraController.update(dt);
      },
      afterFrame: (alpha: number, _dt: number) => {
        // Interpolate visual positions using alpha
        this.interpolationSystem.interpolate(alpha);
        // Render the scene (GameWorld no longer calls scene.render automatically)
        this.scene.render();
      },
    });

    // Create game event coordinator
    this.gameEventCoordinator = new GameEventCoordinator(
      this.world.eventBus,
      this.uiManager,
      this.lockstepManager,
      this.world.entityManager,
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
   * Cleanup resources
   */
  public dispose(): void {
    // Stop tick/frame loop
    this.world.stop();

    // Unsubscribe from network event handlers
    for (const unsubscribe of this.networkEventUnsubscribers) {
      unsubscribe();
    }
    this.networkEventUnsubscribers = [];

    // Dispose UI
    this.uiManager?.dispose();

    // Dispose late systems (not in GameWorld)
    this.cameraController?.dispose();

    // Dispose scene manager
    this.sceneManager?.dispose();

    // Dispose all systems registered in GameWorld
    this.world.dispose();

    // Clear managers
    this.entityFactory?.clear();
    this.assetManager?.dispose();

    // Dispose engine
    this.engine.dispose();
  }
}
