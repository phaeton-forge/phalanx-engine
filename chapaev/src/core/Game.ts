import { GameWorld, Entity } from 'phalanx-ecs';
import type { CommandsBatch } from 'phalanx-ecs';
import { setupScene } from '../rendering/SceneSetup.ts';
import type { SceneContext } from '../rendering/SceneSetup.ts';
import { ThreeRenderSystem } from '../systems/ThreeRenderSystem.ts';
import { PhysicsSystem } from '../systems/PhysicsSystem.ts';
import { GameRulesSystem } from '../systems/GameRulesSystem.ts';
import { FlickInputSystem } from '../systems/FlickInputSystem.ts';
import { RapierVFXSystem } from '../systems/RapierVFXSystem.ts';
import { SoundSystem } from '../systems/SoundSystem.ts';
import { InterpolationSystem } from '../systems/InterpolationSystem.ts';
import { ComponentType } from '../components/Component.ts';
import { GameStateComponent } from '../components/GameStateComponent.ts';
import { InterpolationComponent } from '../components/InterpolationComponent.ts';
import { PlayerComponent } from '../components/PlayerComponent.ts';
import { createBoardEntity } from '../entities/BoardEntity.ts';
import { createCheckerEntity } from '../entities/CheckerEntity.ts';
import { INITIAL_POSITIONS } from '../config/constants.ts';
import { TeamTag } from '../enums/TeamTag.ts';
import { LockstepManager } from '../network/LockstepManager.ts';
import { NetworkManager } from '../network/NetworkManager.ts';
import { GAME_OVER } from '../events/GameEvents.ts';
import type { GameOverEvent } from '../events/GameEvents.ts';

export type GameMode = 'hotseat' | 'online';

/**
 * Game — thin orchestrator that wires together the ECS world,
 * Three.js scene, and the render loop.
 *
 * Supports two modes:
 * - hotseat: local two-player (Stage 1, internal tick loop)
 * - online:  network 1v1 via PhalanxClient (Stage 2, server-driven ticks)
 */
export class Game {
  private world!: GameWorld;
  private sceneCtx: SceneContext;
  private readonly mode: GameMode;

  // Network (online mode only)
  private networkManager: NetworkManager | null = null;
  private lockstepManager: LockstepManager | null = null;
  private interpolationSystem: InterpolationSystem | null = null;
  private localTeam: TeamTag = TeamTag.White;

  constructor(canvas: HTMLCanvasElement, mode: GameMode = 'hotseat') {
    this.mode = mode;
    this.sceneCtx = setupScene(canvas);
  }

  /**
   * Start the game. For online mode, this connects to the server,
   * waits for a match, then initialises the ECS world.
   */
  public async start(): Promise<void> {
    if (this.mode === 'online') {
      await this.startOnline();
    } else {
      this.startHotseat();
    }
  }

  // ── Hot-seat mode (Stage 1) ─────────────────────────────────────

  private startHotseat(): void {
    // ECS world with internal tick loop at 60 Hz
    this.world = new GameWorld({
      componentTypes: Object.values(ComponentType),
      tickRate: 60,
    });

    this.createEntities();

    const physicsSystem = new PhysicsSystem();
    const gameRulesSystem = new GameRulesSystem();
    const flickInputSystem = new FlickInputSystem(
      this.sceneCtx.camera,
      this.sceneCtx.renderer.domElement,
      this.sceneCtx.scene,
      this.sceneCtx.controls,
    );
    const renderSystem = new ThreeRenderSystem(this.sceneCtx.scene);
    const rapierVFXSystem = new RapierVFXSystem();
    const soundSystem = new SoundSystem();

    const tickSystems = [physicsSystem, gameRulesSystem];
    const frameSystems = [flickInputSystem, renderSystem, rapierVFXSystem, soundSystem];

    this.world.registerSystems(tickSystems, frameSystems);

    const meshMap = renderSystem.getMeshMap();
    flickInputSystem.setMeshMap(meshMap);
    rapierVFXSystem.setMeshMap(meshMap);

    const { composer, controls } = this.sceneCtx;

    this.world.start({
      afterFrame: () => {
        controls.update();
        composer.render();
      },
    });
  }

  // ── Online mode (Stage 2) ───────────────────────────────────────

  private async startOnline(): Promise<void> {
    this.networkManager = new NetworkManager();

    const gameStartEvent = await this.networkManager.connectAndWaitForMatch(
      (msg) => console.log(`[Matchmaking] ${msg}`),
    );

    console.log('[Game] Game start event received, randomSeed:', gameStartEvent.randomSeed);

    // Determine local team from sorted player IDs
    const localPlayerIndex = this.networkManager.localPlayerIndex;
    this.localTeam = localPlayerIndex === 0 ? TeamTag.White : TeamTag.Black;
    console.log(`[Game] Local player index: ${localPlayerIndex}, team: ${this.localTeam}`);

    // Create ECS world with PhalanxClient as tick/frame provider
    this.world = new GameWorld({
      componentTypes: Object.values(ComponentType),
      tickFrameProvider: this.networkManager.client,
    });

    // Create entities with player components for online mode
    this.createEntities();
    this.assignPlayerComponents();

    // Create systems
    const physicsSystem = new PhysicsSystem();
    const gameRulesSystem = new GameRulesSystem();
    const flickInputSystem = new FlickInputSystem(
      this.sceneCtx.camera,
      this.sceneCtx.renderer.domElement,
      this.sceneCtx.scene,
      this.sceneCtx.controls,
    );
    const renderSystem = new ThreeRenderSystem(this.sceneCtx.scene);
    const rapierVFXSystem = new RapierVFXSystem();
    const soundSystem = new SoundSystem();
    this.interpolationSystem = new InterpolationSystem();

    // Tick systems: physics first, then rules
    const tickSystems = [physicsSystem, gameRulesSystem];

    // Frame systems: input → render → rapier VFX → sound → interpolation
    const frameSystems = [flickInputSystem, renderSystem, rapierVFXSystem, soundSystem, this.interpolationSystem];

    this.world.registerSystems(tickSystems, frameSystems);

    // Create lockstep manager
    this.lockstepManager = new LockstepManager(
      this.networkManager.client,
      this.world.eventBus,
      this.world.entityManager,
    );

    // Wire up mesh map
    const meshMap = renderSystem.getMeshMap();
    flickInputSystem.setMeshMap(meshMap);
    rapierVFXSystem.setMeshMap(meshMap);

    // Enable network mode on FlickInputSystem
    flickInputSystem.setNetworkMode(this.lockstepManager, this.localTeam);

    // Setup network event handlers
    this.setupNetworkEvents();

    // Setup game-over logging
    this.world.eventBus.on<GameOverEvent>(GAME_OVER, (event) => {
      const isLocalWin = event.winner === this.localTeam;
      console.log(`[Game] GAME OVER! Winner: ${event.winner}. ${isLocalWin ? 'You win!' : 'You lose.'}`);
    });

    const { composer, controls } = this.sceneCtx;
    const interpolationSystem = this.interpolationSystem;
    const lockstepManager = this.lockstepManager;

    // Start the world with lifecycle hooks (following direct-strike pattern)
    this.world.start({
      beforeTick: (tick: number, commandsBatch: CommandsBatch) => {
        // Snapshot positions BEFORE simulation tick
        interpolationSystem.snapshotPositions();

        // Execute commands from server batch (before tick systems run)
        lockstepManager.processTick(tick, commandsBatch);
      },
      afterTick: (tick: number) => {
        // Capture positions AFTER simulation tick
        interpolationSystem.captureCurrentPositions();

        // Submit state hash for desync detection
        lockstepManager.submitHashIfNeeded(tick);
      },
      beforeFrame: (_alpha: number, _dt: number) => {
        controls.update();
      },
      afterFrame: (alpha: number, _dt: number) => {
        // Interpolate visual positions between ticks for smooth rendering
        interpolationSystem.interpolate(alpha);
        composer.render();
      },
    });

    // Signal to server that we're ready
    this.networkManager.sendReady();
    console.log('[Game] Sent client-ready signal');
  }

  // ── Entity creation ─────────────────────────────────────────────

  private createEntities(): void {
    const em = this.world.entityManager;

    // Board
    em.addEntity(createBoardEntity());

    // Checkers
    for (const placement of INITIAL_POSITIONS) {
      const team = placement.team === 'white' ? TeamTag.White : TeamTag.Black;
      const entity = createCheckerEntity(team, placement.position);

      // In online mode, add InterpolationComponent to each checker
      if (this.mode === 'online') {
        entity.addComponent(new InterpolationComponent(placement.position));
      }

      em.addEntity(entity);
    }

    // Game-state singleton entity
    const gsEntity = new Entity();
    gsEntity.addComponent(new GameStateComponent(TeamTag.White));
    em.addEntity(gsEntity);
  }

  /**
   * Assign PlayerComponent to each checker based on deterministic player ordering.
   * Player 0 = white, Player 1 = black.
   */
  private assignPlayerComponents(): void {
    if (!this.networkManager?.matchData) return;

    const matchData = this.networkManager.matchData;
    const allPlayerIds = [
      matchData.playerId,
      ...matchData.teammates.map((p) => p.playerId),
      ...matchData.opponents.map((p) => p.playerId),
    ].sort();

    const checkerEntities = this.world.entityManager.queryEntities(ComponentType.Checker);
    for (const entity of checkerEntities) {
      const checker = entity.getComponent<import('../components/CheckerComponent.ts').CheckerComponent>(ComponentType.Checker);
      if (!checker) continue;

      const playerIndex = checker.team === TeamTag.White ? 0 : 1;
      const networkId = allPlayerIds[playerIndex] ?? '';
      entity.addComponent(new PlayerComponent(playerIndex, networkId));
    }
  }

  // ── Network events ──────────────────────────────────────────────

  private setupNetworkEvents(): void {
    if (!this.networkManager) return;

    this.networkManager.onPlayerDisconnected(() => {
      console.log('[Game] Opponent disconnected. Victory!');
    });

    this.networkManager.onPlayerReconnected(() => {
      console.log('[Game] Opponent reconnected.');
    });

    this.networkManager.onMatchEnd((reason) => {
      console.log(`[Game] Match ended: ${reason}`);
    });

    this.networkManager.onDesync((tick) => {
      console.warn(`[Game] Desync detected at tick ${tick}`);
    });
  }

  // ── Cleanup ─────────────────────────────────────────────────────

  public dispose(): void {
    this.world.stop();
    this.world.dispose();
    this.networkManager?.dispose();
    this.sceneCtx.renderer.dispose();
  }
}
