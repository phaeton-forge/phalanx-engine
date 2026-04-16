import * as THREE from 'three';
import { GameWorld, Entity } from 'phalanx-ecs';
import { FPVector3 } from 'phalanx-math';
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
import { createBoardMesh } from '../rendering/BoardMesh.ts';
import { createCheckerMesh } from '../rendering/CheckerMesh.ts';
import { INITIAL_POSITIONS, CAMERA_POSITION, BOARD_HEIGHT, CHECKER_HEIGHT } from '../config/constants.ts';
import { TeamTag } from '../enums/TeamTag.ts';
import { LockstepManager } from '../network/LockstepManager.ts';
import { NetworkManager } from '../network/NetworkManager.ts';
import { ALL_SETTLED, GAME_OVER, TURN_CHANGED, CHECKER_ELIMINATED, ROUND_STARTED, ROUND_OVER } from '../events/GameEvents.ts';
import type { GameOverEvent, TurnChangedEvent, CheckerEliminatedEvent, RoundStartedEvent, RoundOverEvent } from '../events/GameEvents.ts';
import { UIManager } from '../ui/UIManager.ts';
import { MainMenuScreen } from '../ui/screens/MainMenu.ts';
import { AuthModal } from '../ui/screens/AuthModal.ts';
import { MatchmakingScreen } from '../ui/screens/Matchmaking.ts';
import { GameHUDScreen } from '../ui/screens/GameHUD.ts';
import { MatchResultScreen } from '../ui/screens/MatchResult.ts';
import { ProfileScreen } from '../ui/screens/Profile.ts';
import { PauseOverlay } from '../ui/screens/PauseOverlay.ts';
import { PrivateMatchScreen } from '../ui/screens/PrivateMatch.ts';
import type { CountdownEvent, GamePausedEvent, GameResumedEvent } from 'phalanx-client';

export type GameMode = 'hotseat' | 'online';

/**
 * Game — thin orchestrator that wires together the ECS world,
 * Three.js scene, UI, and the render loop.
 *
 * Supports two modes:
 * - hotseat: local two-player (Stage 1, internal tick loop)
 * - online:  network 1v1 via PhalanxClient (Stage 2, event tick mode)
 */
export class Game {
  private world!: GameWorld;
  private sceneCtx: SceneContext;
  private readonly mode: GameMode;

  // Network (online mode only)
  private networkManager: NetworkManager | null = null;
  private commandFlushUnsubscribe: (() => void) | null = null;
  private localTeam: TeamTag = TeamTag.White;
  private isGuestMode = false;

  // UI
  private uiManager: UIManager;
  private mainMenu!: MainMenuScreen;
  private authModal!: AuthModal;
  private matchmakingScreen!: MatchmakingScreen;
  private gameHUD!: GameHUDScreen;
  private matchResult!: MatchResultScreen;
  private profileScreen!: ProfileScreen;
  private privateMatchScreen!: PrivateMatchScreen;
  private pauseOverlay!: PauseOverlay;

  // Camera auto-rotate for menu
  private menuAutoRotateRAF = 0;
  private isInGame = false;
  private isPaused = false;
  private flickInputSystem: FlickInputSystem | null = null;

  /** Decorative meshes shown in the menu scene (board + checkers) */
  private menuDecorations: THREE.Object3D[] = [];

  constructor(canvas: HTMLCanvasElement, mode: GameMode = 'hotseat') {
    this.mode = mode;
    this.sceneCtx = setupScene(canvas);
    this.uiManager = new UIManager();
  }

  /**
   * Start the game. Sets up the scene, shows the main menu (or goes directly
   * into hotseat if mode=hotseat via query param).
   */
  public async start(): Promise<void> {
    if (this.mode === 'hotseat') {
      this.startHotseat();
      return;
    }

    // Online mode: show main menu with auth
    this.networkManager = new NetworkManager();
    this.setupUI();
    this.startMenuAutoRotate();
    this.uiManager.showScreen('main-menu');

    // Update auth state in UI
    const authState = this.networkManager.getAuthState();
    this.mainMenu.updateAuthState(authState);

    // Listen for auth state changes
    this.networkManager.onAuthStateChanged((state) => {
      this.mainMenu.updateAuthState(state);

      // If user just signed in and auth modal is showing, close it and go to menu
      if (state.isAuthenticated && this.uiManager.getCurrentScreen() === 'auth') {
        this.uiManager.hideScreen('auth');
        this.uiManager.showScreen('main-menu');
        this.mainMenu.updateAuthState(state);
      }
    });

    this.networkManager.onAuthError((error) => {
      console.error('[Game] Auth error:', error);
      this.authModal.setStatus(`Ошибка: ${error.message}`, true);
    });
  }

  // ── UI Setup ────────────────────────────────────────────────────

  private setupUI(): void {
    // Main Menu
    this.mainMenu = new MainMenuScreen(this.uiManager, {
      onFindMatch: () => this.handleFindMatch(),
      onPrivateMatch: () => this.handlePrivateMatch(),
      onLocalGame: () => this.handleLocalGame(),
      onProfile: () => this.handleShowProfile(),
      onSignIn: () => this.handleShowAuth(),
      onSignOut: () => void this.handleSignOut(),
    });

    // Auth Modal
    this.authModal = new AuthModal(this.uiManager, {
      onGoogleSignIn: () => this.handleGoogleSignIn(),
      onGuestPlay: () => this.handleGuestPlay(),
      onClose: () => {
        this.uiManager.hideScreen('auth');
        this.uiManager.showScreen('main-menu');
      },
    });

    // Matchmaking
    this.matchmakingScreen = new MatchmakingScreen(this.uiManager, {
      onCancel: () => this.handleCancelMatchmaking(),
    });

    // Game HUD
    this.gameHUD = new GameHUDScreen(this.uiManager, {
      onPause: () => this.handlePause(),
      onSettings: () => { /* TODO: settings */ },
    });

    // Match Result
    this.matchResult = new MatchResultScreen(this.uiManager, {
      onRematch: () => { /* TODO: rematch */ },
      onNewGame: () => this.handleFindMatch(),
      onMainMenu: () => this.returnToMainMenu(),
    });

    // Profile
    this.profileScreen = new ProfileScreen(this.uiManager, {
      onBack: () => {
        this.uiManager.hideScreen('profile');
        this.uiManager.showScreen('main-menu');
      },
      onSignOut: () => {
        void this.handleSignOut();
        this.uiManager.hideScreen('profile');
        this.uiManager.showScreen('main-menu');
      },
    });

    // Pause (auto-registers itself with UIManager)
    this.pauseOverlay = new PauseOverlay(this.uiManager, {
      onResume: () => {
        if (!this.networkManager) return;
        // Send resume request to server — both clients will receive gameResumed event
        this.networkManager.client.resumeGame();
      },
      onLeave: () => this.returnToMainMenu(),
    });

    // Private Match
    this.privateMatchScreen = new PrivateMatchScreen(this.uiManager, {
      onCreateRoom: () => {
        // TODO: implement private room creation
        console.log('[Game] Create room - not yet implemented');
      },
      onJoinRoom: (code: string) => {
        // TODO: implement private room joining
        console.log(`[Game] Join room ${code} - not yet implemented`);
      },
      onCancel: () => {
        this.uiManager.hideScreen('private-match');
        this.uiManager.showScreen('main-menu');
      },
      onBack: () => {
        this.uiManager.hideScreen('private-match');
        this.uiManager.showScreen('main-menu');
      },
    });
  }

  // ── UI Handlers ─────────────────────────────────────────────────

  private handleShowAuth(): void {
    this.uiManager.hideScreen('main-menu');
    this.uiManager.destroyScreen('auth');
    this.uiManager.showScreen('auth');
  }

  private handleGoogleSignIn(): void {
    if (!this.networkManager) return;
    this.authModal.setStatus('Перенаправление на Google...');
    this.networkManager.login();
  }

  private handleGuestPlay(): void {
    // Guest mode: skip auth requirement and go directly to matchmaking
    this.isGuestMode = true;
    this.uiManager.hideScreen('auth');
    this.uiManager.showScreen('main-menu');
    // Immediately start matchmaking as guest
    this.handleFindMatch();
  }

  private async handleSignOut(): Promise<void> {
    if (!this.networkManager) return;
    await this.networkManager.logout();
    this.mainMenu.updateAuthState(this.networkManager.getAuthState());
  }

  private handleShowProfile(): void {
    if (!this.networkManager) return;
    this.profileScreen.setAuthState(this.networkManager.getAuthState());
    this.uiManager.destroyScreen('profile');
    this.uiManager.hideScreen('main-menu');
    this.uiManager.showScreen('profile');
  }

  private handleFindMatch(): void {
    if (!this.networkManager) return;

    // If auth is enabled, user is not signed in, and not in guest mode — show auth modal
    if (this.networkManager.authEnabled && !this.networkManager.getAuthState().isAuthenticated && !this.isGuestMode) {
      this.handleShowAuth();
      return;
    }

    this.stopMenuAutoRotate();
    this.uiManager.hideScreen('main-menu');
    this.uiManager.destroyScreen('matchmaking');
    this.uiManager.showScreen('matchmaking');

    void this.connectAndStartMatch();
  }

  private handlePrivateMatch(): void {
    this.uiManager.hideScreen('main-menu');
    this.privateMatchScreen.showMenu();
    this.uiManager.showScreen('private-match');
  }

  private handleLocalGame(): void {
    // Navigate to hotseat mode
    window.location.search = '?mode=hotseat';
  }

  private handleCancelMatchmaking(): void {
    this.matchmakingScreen.stopTimer();
    this.networkManager?.dispose();
    this.networkManager = new NetworkManager();

    // Re-attach auth listeners
    this.networkManager.onAuthStateChanged((state) => {
      this.mainMenu.updateAuthState(state);
    });

    this.uiManager.hideScreen('matchmaking');
    this.uiManager.showScreen('main-menu');
    this.startMenuAutoRotate();
  }

  private handlePause(): void {
    if (!this.networkManager || this.isPaused) return;

    // Send pause request to server — both clients will receive gamePaused event
    this.networkManager.client.pauseGame();
  }

  private handleNetworkPause(event: GamePausedEvent): void {
    this.isPaused = true;

    // Block game input
    if (this.flickInputSystem) {
      this.flickInputSystem.cancelDrag();
      this.flickInputSystem.enabled = false;
    }

    // Determine if we are the one who paused (only pauser can resume)
    const localPlayerId = this.networkManager?.client.getPlayerId() ?? '';
    const isLocalPause = event.requestedBy === localPlayerId;
    this.pauseOverlay.setCanResume(isLocalPause);

    // Show pause overlay on BOTH clients (as overlay, so game HUD stays visible)
    this.uiManager.destroyScreen('pause');
    this.uiManager.showOverlay('pause');
  }

  private handleNetworkResume(_event: GameResumedEvent): void {
    this.isPaused = false;

    // Restore game input
    if (this.flickInputSystem) {
      this.flickInputSystem.enabled = true;
    }

    // Hide pause overlay on BOTH clients
    this.uiManager.hideScreen('pause');
  }

  private returnToMainMenu(): void {
    this.isInGame = false;
    this.isPaused = false;
    this.flickInputSystem = null;

    // Stop ECS world
    if (this.world) {
      this.world.stop();
      this.world.dispose();
    }

    // Disconnect network
    this.commandFlushUnsubscribe?.();
    this.commandFlushUnsubscribe = null;
    this.networkManager?.dispose();
    this.networkManager = new NetworkManager();

    // Re-setup auth listeners
    this.networkManager.onAuthStateChanged((state) => {
      this.mainMenu.updateAuthState(state);
    });

    // Hide all screens and show main menu
    for (const screen of ['game', 'match-result', 'pause', 'countdown', 'matchmaking'] as const) {
      this.uiManager.destroyScreen(screen);
    }

    this.mainMenu.updateAuthState(this.networkManager.getAuthState());
    this.uiManager.showScreen('main-menu');
    this.startMenuAutoRotate();
  }

  // ── Matchmaking Flow ────────────────────────────────────────────

  private async connectAndStartMatch(): Promise<void> {
    if (!this.networkManager) return;

    try {
      this.matchmakingScreen.setStatus('Подключение к серверу...');

      // Setup error handlers
      this.networkManager.client.on('disconnected', () => {
        this.matchmakingScreen.setStatus('Соединение потеряно');
      });

      this.networkManager.client.on('error', (error) => {
        console.error('[Game] Network error:', error.message);
      });

      await this.networkManager.client.connect();
      this.matchmakingScreen.setStatus('Поиск соперника...');

      await this.networkManager.client.joinQueue();

      const matchData = await this.networkManager.client.waitForMatch();
      this.matchmakingScreen.stopTimer();

      // Show countdown screen
      this.uiManager.hideScreen('matchmaking');
      this.uiManager.destroyScreen('countdown');
      this.uiManager.showScreen('countdown');

      await this.networkManager.client.waitForCountdown((event: CountdownEvent) => {
        this.matchmakingScreen.updateCountdown(event.seconds);
      });

      const gameStartEvent = await this.networkManager.client.waitForGameStart();

      console.log('[Game] Game start event received, randomSeed:', gameStartEvent.randomSeed);

      // Store match data on the network manager so localPlayerIndex works
      this.networkManager.setMatchData(matchData);

      // Transition to game
      this.uiManager.hideScreen('countdown');
      this.startOnlineGame(matchData);
    } catch (error) {
      console.error('[Game] Matchmaking failed:', error);
      this.matchmakingScreen.setStatus('Ошибка подключения');
      this.returnToMainMenu();
    }
  }

  // ── Hot-seat mode (Stage 1) ─────────────────────────────────────

  private startHotseat(): void {
    this.isInGame = true;

    // Show simplified HUD for hotseat
    this.gameHUD = new GameHUDScreen(this.uiManager, {
      onPause: () => {
        // In hotseat, pause button exits to main menu (online mode)
        window.location.search = '';
      },
      onSettings: () => { /* TODO */ },
    });
    this.uiManager.showScreen('game');
    this.gameHUD.setPlayerNames('Белые', 'Чёрные');
    this.gameHUD.setHotseatMode(true);
    this.gameHUD.updateTurnIndicator(true, 'white');

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

    // Hotseat HUD subscriptions
    this.world.eventBus.on<TurnChangedEvent>(TURN_CHANGED, (event) => {
      const team = event.team === TeamTag.White ? 'white' : 'black';
      this.gameHUD.updateTurnIndicator(true, team);
    });

    this.world.eventBus.on<CheckerEliminatedEvent>(CHECKER_ELIMINATED, (event) => {
      const gsEntities = this.world.entityManager.queryEntities(ComponentType.GameState);
      const gs = gsEntities[0]?.getComponent<GameStateComponent>(ComponentType.GameState);
      if (!gs) return;
      if (event.team === TeamTag.White) {
        this.gameHUD.updateCheckerCount(0, gs.whiteAliveCount, 8);
      } else {
        this.gameHUD.updateCheckerCount(1, gs.blackAliveCount, 8);
      }
    });

    this.world.eventBus.on<RoundStartedEvent>(ROUND_STARTED, (event) => {
      this.gameHUD.updateRound(event.roundNumber);
      this.gameHUD.updateCheckerCount(0, 8, 8);
      this.gameHUD.updateCheckerCount(1, 8, 8);
    });

    this.world.eventBus.on<RoundOverEvent>(ROUND_OVER, (event) => {
      if (event.winner === null) {
        this.gameHUD.showToast('Ничья в раунде', 'info');
      } else {
        this.gameHUD.showToast(
          event.winner === TeamTag.White ? 'Белые выиграли раунд!' : 'Чёрные выиграли раунд!',
          'success',
        );
      }
    });

    this.world.eventBus.on<GameOverEvent>(GAME_OVER, (event) => {
      this.gameHUD.showToast(
        event.winner === TeamTag.White ? '🏆 Белые победили!' : '🏆 Чёрные победили!',
        'success',
        4000,
      );
    });

    const { composer, controls } = this.sceneCtx;

    this.world.start({
      afterFrame: () => {
        controls.update();
        composer.render();
      },
    });
  }

  // ── Online game start (after matchmaking) ───────────────────────

  private startOnlineGame(_matchData: import('phalanx-client').MatchFoundEvent): void {
    if (!this.networkManager) return;

    this.isInGame = true;

    // Determine local team from server-assigned teamId (0 = white, 1 = black)
    const localPlayerIndex = _matchData.teamId;
    this.localTeam = localPlayerIndex === 0 ? TeamTag.White : TeamTag.Black;
    console.log(`[Game] Local team id: ${localPlayerIndex}, team: ${this.localTeam}`);

    // Position camera behind the local player's checkers
    this.adjustCameraForTeam(this.localTeam);

    // Show game HUD
    this.uiManager.destroyScreen('game');
    this.uiManager.showScreen('game');
    // Resolve display names: use auth username for local, opponent username from matchData
    const localUser = this.networkManager.client.getUser();
    const localName = localUser?.username ?? 'Вы';
    const opponentInfo = _matchData.opponents[0];
    const opponentName = opponentInfo?.username ?? 'Соперник';
    this.gameHUD.setPlayerNames(
      localPlayerIndex === 0 ? localName : opponentName,
      localPlayerIndex === 1 ? localName : opponentName,
    );
    this.gameHUD.updateTurnIndicator(localPlayerIndex === 0);

    // ECS world
    this.world = new GameWorld({
      componentTypes: Object.values(ComponentType),
      tickRate: 60,
    });

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
    const interpolationSystem = new InterpolationSystem();

    const tickSystems = [physicsSystem, gameRulesSystem];
    const frameSystems = [flickInputSystem, renderSystem, rapierVFXSystem, soundSystem, interpolationSystem];

    this.world.registerSystems(tickSystems, frameSystems);

    // Create lockstep manager
    const lockstepManager = new LockstepManager(
      this.networkManager.client,
      this.world.eventBus,
      this.world.entityManager,
    );

    // Keep a minimal frame subscription so PhalanxClient can flush commands
    this.commandFlushUnsubscribe = this.networkManager.client.onFrame(
      (_alpha: number, _dt: number) => {},
    );

    // Wire up mesh map
    const meshMap = renderSystem.getMeshMap();
    flickInputSystem.setMeshMap(meshMap);
    rapierVFXSystem.setMeshMap(meshMap);

    // Enable network mode on FlickInputSystem
    flickInputSystem.setNetworkMode(lockstepManager, this.localTeam);
    this.flickInputSystem = flickInputSystem;

    // Subscribe to incoming commands
    this.networkManager.onCommandsBatch((batch) => {
      lockstepManager.handleIncomingCommands(batch);
    });

    // Submit state hash when physics settles
    this.world.eventBus.on(ALL_SETTLED, () => {
      lockstepManager.submitHashOnSettle();
    });


    // Subscribe to turn changes for HUD updates
    this.world.eventBus.on<TurnChangedEvent>(TURN_CHANGED, (event) => {
      this.gameHUD.updateTurnIndicator(event.team === this.localTeam);
    });

    // Subscribe to checker eliminations for HUD dot indicators
    this.world.eventBus.on<CheckerEliminatedEvent>(CHECKER_ELIMINATED, (event) => {
      // Count alive checkers from the game state
      const gsEntities = this.world.entityManager.queryEntities(ComponentType.GameState);
      const gs = gsEntities[0]?.getComponent<GameStateComponent>(ComponentType.GameState);
      if (!gs) return;

      if (event.team === TeamTag.White) {
        this.gameHUD.updateCheckerCount(0, gs.whiteAliveCount, 8);
      } else {
        this.gameHUD.updateCheckerCount(1, gs.blackAliveCount, 8);
      }
    });

    // Subscribe to round started for HUD round counter
    this.world.eventBus.on<RoundStartedEvent>(ROUND_STARTED, (event) => {
      this.gameHUD.updateRound(event.roundNumber);
      // Reset checker indicators on new round
      this.gameHUD.updateCheckerCount(0, 8, 8);
      this.gameHUD.updateCheckerCount(1, 8, 8);
    });

    // Subscribe to round over for toast notifications
    this.world.eventBus.on<RoundOverEvent>(ROUND_OVER, (event) => {
      if (event.winner === null) {
        this.gameHUD.showToast('Ничья в раунде', 'info');
      } else if (event.winner === this.localTeam) {
        this.gameHUD.showToast('Раунд выигран!', 'success');
      } else {
        this.gameHUD.showToast('Раунд проигран', 'defeat');
      }
    });

    // Setup network event handlers
    this.setupNetworkEvents();

    // Game-over handler with UI
    this.world.eventBus.on<GameOverEvent>(GAME_OVER, (event) => {
      const isLocalWin = event.winner === this.localTeam;
      console.log(`[Game] GAME OVER! Winner: ${event.winner}. ${isLocalWin ? 'You win!' : 'You lose.'}`);

      // Show match result toast
      this.gameHUD.showToast(
        isLocalWin ? '🏆 Победа в партии!' : 'Поражение',
        isLocalWin ? 'success' : 'defeat',
        3000,
      );

      // Auto-redirect to main menu after a delay
      setTimeout(() => {
        this.returnToMainMenu();
      }, 3500);
    });

    const { composer, controls } = this.sceneCtx;

    this.world.start({
      beforeTick: () => {
        interpolationSystem.snapshotPositions();
      },
      afterTick: () => {
        interpolationSystem.captureCurrentPositions();
      },
      beforeFrame: (alpha: number, _dt: number) => {
        interpolationSystem.interpolate(alpha);
        controls.update();
      },
      afterFrame: () => {
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

    // Pause/resume: server broadcasts to ALL clients
    this.networkManager.client.on('gamePaused', (event) => {
      this.handleNetworkPause(event);
    });

    this.networkManager.client.on('gameResumed', (event) => {
      this.handleNetworkResume(event);
    });
  }

  // ── Camera ──────────────────────────────────────────────────────

  private adjustCameraForTeam(team: TeamTag): void {
    const { camera, controls } = this.sceneCtx;
    const zSign = team === TeamTag.White ? 1 : -1;

    camera.position.set(
      CAMERA_POSITION.x,
      CAMERA_POSITION.y,
      CAMERA_POSITION.z * zSign,
    );
    controls.target.set(0, 0, 0);
    controls.update();
  }

  // ── Menu auto-rotate ────────────────────────────────────────────

  private startMenuAutoRotate(): void {
    const { controls, composer } = this.sceneCtx;

    // Disable manual orbit controls during menu
    controls.enabled = false;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;

    // Add decorative board and checkers for the menu scene
    this.addMenuDecorations();

    const animate = (): void => {
      if (!this.isInGame) {
        controls.update();
        composer.render();
        this.menuAutoRotateRAF = requestAnimationFrame(animate);
      }
    };
    this.menuAutoRotateRAF = requestAnimationFrame(animate);
  }

  private stopMenuAutoRotate(): void {
    if (this.menuAutoRotateRAF) {
      cancelAnimationFrame(this.menuAutoRotateRAF);
      this.menuAutoRotateRAF = 0;
    }
    this.sceneCtx.controls.autoRotate = false;
    this.sceneCtx.controls.enabled = true;

    // Remove decorative meshes so they don't double up with ECS-managed ones
    this.removeMenuDecorations();
  }

  /** Add decorative board and checker meshes to the scene for the menu background. */
  private addMenuDecorations(): void {
    this.removeMenuDecorations();

    const { scene } = this.sceneCtx;
    const yChecker = BOARD_HEIGHT / 2 + CHECKER_HEIGHT / 2;

    // Board
    const boardGroup = createBoardMesh();
    scene.add(boardGroup);
    this.menuDecorations.push(boardGroup);

    // Checkers at starting positions
    for (const placement of INITIAL_POSITIONS) {
      const team = placement.team === 'white' ? TeamTag.White : TeamTag.Black;
      const mesh = createCheckerMesh(team);
      const pos = FPVector3.ToFloat(placement.position);
      mesh.position.set(pos.x, yChecker, pos.z);
      scene.add(mesh);
      this.menuDecorations.push(mesh);
    }
  }

  /** Remove all decorative menu meshes from the scene. */
  private removeMenuDecorations(): void {
    const { scene } = this.sceneCtx;
    for (const obj of this.menuDecorations) {
      scene.remove(obj);
    }
    this.menuDecorations = [];
  }

  // ── Cleanup ─────────────────────────────────────────────────────

  public dispose(): void {
    this.stopMenuAutoRotate();
    this.commandFlushUnsubscribe?.();
    this.commandFlushUnsubscribe = null;
    if (this.world) {
      this.world.stop();
      this.world.dispose();
    }
    this.networkManager?.dispose();
    this.sceneCtx.renderer.dispose();
    this.uiManager.dispose();
  }
}
