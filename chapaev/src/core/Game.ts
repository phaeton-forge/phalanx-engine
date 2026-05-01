import type { GameWorld } from 'phalanx-ecs';
import type { SceneContext } from '../rendering';
import { setupScene, MenuScenePresenter } from '../rendering';
import type { FlickInputSystem } from '../systems';
import { TeamTag } from '../enums/TeamTag.ts';
import {
  NetworkContext,
  RoomRecoveryManager,
  PrivateRoomCoordinator,
  MatchmakingCoordinator,
} from '../network';
import { GameUIController } from '../ui/GameUIController.ts';
import { GameHUDScreen } from '../ui/screens/GameHUD.ts';
import { bindHUDToWorld } from '../ui/HUDBindings.ts';
import { bootstrapWorld } from './WorldBootstrapper.ts';
import { PauseController } from './PauseController.ts';
import type { MatchFoundEvent, ReconnectStateEvent } from 'phalanx-client';
import type { IPlatformAds } from '../platform/YandexSDK.ts';
import { t } from '../i18n/i18n.ts';

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
  private readonly mode: GameMode;
  private readonly sceneCtx: SceneContext;
  private readonly ui = new GameUIController();
  private readonly menuPresenter: MenuScenePresenter;
  private readonly platform: IPlatformAds;

  // Online-mode-only collaborators (constructed in `start`).
  private ctx: NetworkContext | null = null;
  private matchmaking: MatchmakingCoordinator | null = null;
  private privateRoom: PrivateRoomCoordinator | null = null;
  private recovery: RoomRecoveryManager | null = null;
  private pauseController: PauseController | null = null;

  // Live world state.
  private world: GameWorld | null = null;
  private flickInputSystem: FlickInputSystem | null = null;
  private commandFlushUnsubscribe: (() => void) | null = null;
  private reconnectStateUnsubscribe: (() => void) | null = null;
  private localTeam: TeamTag = TeamTag.White;
  private hasSentClientReady = false;
  private inGame = false;

  constructor(
    canvas: HTMLCanvasElement,
    platform: IPlatformAds,
    mode: GameMode = 'hotseat'
  ) {
    this.mode = mode;
    this.platform = platform;
    this.sceneCtx = setupScene(canvas);
    this.menuPresenter = new MenuScenePresenter(this.sceneCtx);
  }

  start(): void {
    if (this.mode === 'hotseat') {
      this.startHotseat();
      return;
    }

    this.bootstrapOnlineCollaborators();
    this.menuPresenter.startAutoRotate();

    const roomCode = this.consumeDeepLinkRoomCode();

    if (roomCode) {
      void this.privateRoom!.joinRoom(roomCode);
      return;
    }

    // Cold-start recovery: persisted host record from a previous tab.
    const persistedCode = this.recovery!.loadColdStartCode();
    if (persistedCode) {
      void this.privateRoom!.coldStartRecover(persistedCode);
      return;
    }

    this.ui.uiManager.showScreen('main-menu');
  }

  // ── Online-mode bootstrap ───────────────────────────────────────

  private bootstrapOnlineCollaborators(): void {
    this.ctx = new NetworkContext();

    this.ui.build({
      onFindMatch: () => this.handleFindMatch(),
      onPrivateMatch: () => this.ui.showPrivateMatch(),
      onLocalGame: () => {
        window.location.search = '?mode=hotseat';
      },
      onSignOut: () => {},

      onCancelMatchmaking: () => this.handleCancelMatchmaking(),

      onPause: () => this.pauseController?.requestPause(),
      onResume: () => this.pauseController?.requestResume(),
      onLeaveMatch: async () => {
        await this.platform.showFullscreenAd();
        this.returnToMainMenu();
      },

      onNewGame: () => this.handleFindMatch(),
      onMainMenu: async () => {
        await this.platform.showFullscreenAd();
        this.returnToMainMenu();
      },

      onCreateRoom: () => {
        void this.privateRoom!.createRoom();
      },
      onJoinRoom: (code: string) => {
        void this.privateRoom!.joinRoom(code);
      },
      onCancelPrivateMatch: () => this.handleCancelPrivateMatch(),

      isInGame: () => this.inGame,
    });

    this.recovery = new RoomRecoveryManager(
      this.ctx,
      {
        setRecoveryStatus: (text) =>
          this.ui.privateMatch.setRecoveryStatus(text),
        setMatchmakingStatus: (text) => this.ui.matchmaking.setStatus(text),
      },
      {
        onRoomTerminated: () => this.returnToMainMenu(),
      }
    );

    this.privateRoom = new PrivateRoomCoordinator(
      this.ctx,
      this.recovery,
      {
        uiManager: this.ui.uiManager,
        matchmaking: this.ui.matchmaking,
        privateMatch: this.ui.privateMatch,
        stopMenuAutoRotate: () => this.menuPresenter.stopAutoRotate(),
      },
      {
        onMatchReady: (matchData) => this.startOnlineGame(matchData),
        onCancelled: () => this.returnToMainMenu(),
      }
    );

    this.matchmaking = new MatchmakingCoordinator(
      this.ctx,
      {
        uiManager: this.ui.uiManager,
        matchmaking: this.ui.matchmaking,
      },
      {
        onMatchReady: (matchData) => this.startOnlineGame(matchData),
        onError: () => this.returnToMainMenu(),
      }
    );
  }

  // ── UI handlers ─────────────────────────────────────────────────

  private handleFindMatch(): void {
    this.menuPresenter.stopAutoRotate();
    this.ui.showMatchmaking();
    void this.matchmaking!.connectAndStart();
  }

  private handleCancelMatchmaking(): void {
    this.ui.matchmaking.stopTimer();
    this.ctx!.replace();
    this.ui.uiManager.hideScreen('matchmaking');
    this.ui.uiManager.showScreen('main-menu');
    this.menuPresenter.startAutoRotate();
  }

  private handleCancelPrivateMatch(): void {
    this.privateRoom!.cancel();
    this.ctx!.replace();
    this.ui.uiManager.hideScreen('private-match');
    this.ui.uiManager.hideScreen('matchmaking');
    this.ui.uiManager.showScreen('main-menu');
    this.menuPresenter.startAutoRotate();
  }

  private returnToMainMenu(): void {
    this.inGame = false;
    this.hasSentClientReady = false;
    this.flickInputSystem = null;
    this.pauseController?.reset();
    this.recovery?.stop();

    if (this.world) {
      this.world.stop();
      this.world.dispose();
      this.world = null;
    }

    this.commandFlushUnsubscribe?.();
    this.commandFlushUnsubscribe = null;
    this.reconnectStateUnsubscribe?.();
    this.reconnectStateUnsubscribe = null;

    this.ctx!.replace();

    this.ui.destroyTransientScreens();
    this.ui.uiManager.showScreen('main-menu');
    this.menuPresenter.startAutoRotate();
  }

  // ── Hot-seat mode (Stage 1) ─────────────────────────────────────

  private startHotseat(): void {
    this.inGame = true;

    const hud = new GameHUDScreen(this.ui.uiManager, {
      // In hotseat the pause button just exits to main menu (online mode).
      onPause: () => {
        window.location.search = '';
      },
      onSettings: () => this.ui.showInGameSettings(),
    });
    this.ui.uiManager.showScreen('game');
    hud.setPlayerNames(t('name.whiteTeam'), t('name.blackTeam'));
    hud.setHotseatMode(true);
    hud.updateTurnIndicator(true, 'white');

    const { world } = bootstrapWorld('hotseat', this.sceneCtx, null);
    this.world = world;

    bindHUDToWorld(world, hud, { mode: 'hotseat' });

    const { composer, controls } = this.sceneCtx;
    world.start({
      afterFrame: () => {
        controls.update();
        composer.render();
      },
    });
  }

  // ── Online game start (after matchmaking) ───────────────────────

  private startOnlineGame(matchData: MatchFoundEvent): void {
    if (!this.ctx) return;


    this.inGame = true;
    this.hasSentClientReady = false;

    // teamId: 0 = white, 1 = black.
    const localPlayerIndex = matchData.teamId;
    this.localTeam = localPlayerIndex === 0 ? TeamTag.White : TeamTag.Black;
    console.log(
      `[Game] Local team id: ${localPlayerIndex}, team: ${this.localTeam}`
    );

    this.menuPresenter.adjustCameraForTeam(this.localTeam);

    this.ui.uiManager.destroyScreen('game');
    this.ui.uiManager.showScreen('game');

    const localUser = this.ctx.manager.client.getUser();
    const localName = localUser?.username ?? t('name.you');
    const opponentName = matchData.opponents[0]?.username ?? t('name.opponent');
    this.ui.gameHUD.setPlayerNames(
      localPlayerIndex === 0 ? localName : opponentName,
      localPlayerIndex === 1 ? localName : opponentName
    );
    this.ui.gameHUD.updateTurnIndicator(localPlayerIndex === 0);

    const { world, flickInputSystem, interpolationSystem } = bootstrapWorld(
      'online',
      this.sceneCtx,
      this.ctx.manager
    );
    this.world = world;
    this.flickInputSystem = flickInputSystem;

    // Keep a minimal frame subscription so PhalanxClient flushes commands.
    this.commandFlushUnsubscribe = this.ctx.manager.client.onFrame(() => {});

    bindHUDToWorld(world, this.ui.gameHUD, {
      mode: 'online',
      localTeam: this.localTeam,
      onGameOver: () => {
        setTimeout(() => this.returnToMainMenu(), 3500);
      },
    });

    this.setupNetworkEvents();

    const { composer, controls } = this.sceneCtx;
    world.start({
      beforeTick: () => interpolationSystem!.snapshotPositions(),
      afterTick: () => interpolationSystem!.captureCurrentPositions(),
      beforeFrame: (alpha: number) => {
        interpolationSystem!.interpolate(alpha);
        controls.update();
      },
      afterFrame: () => composer.render(),
    });

    this.sendClientReady('initial game start');
  }

  // ── Network events ──────────────────────────────────────────────

  private setupNetworkEvents(): void {
    if (!this.ctx) return;
    const manager = this.ctx.manager;

    this.pauseController = new PauseController(
      this.ctx,
      this.ui.uiManager,
      this.ui.pauseOverlay
    );
    this.pauseController.setFlickInputSystem(this.flickInputSystem);

    manager.onPlayerDisconnected(() => {
      console.log('[Game] Opponent disconnected.');
      this.ui.gameHUD.showToast(t('toast.opponentLeft'), 'info', 2000);
      setTimeout(() => this.returnToMainMenu(), 2000);
    });

    manager.onPlayerReconnected(() =>
      console.log('[Game] Opponent reconnected.')
    );
    manager.onMatchEnd((reason) =>
      console.log(`[Game] Match ended: ${reason}`)
    );
    manager.onDesync((tick) =>
      console.warn(`[Game] Desync detected at tick ${tick}`)
    );

    this.reconnectStateUnsubscribe?.();
    this.reconnectStateUnsubscribe = manager.client.on(
      'reconnectState',
      (snapshot: ReconnectStateEvent) => {
        if (snapshot.state !== 'waiting-for-ready') return;
        if (!this.inGame || !this.world || !this.hasSentClientReady) return;
        this.sendClientReady('waiting-for-ready reconnect');
      }
    );

    manager.client.on('gamePaused', (event) =>
      this.pauseController!.handleNetworkPause(event)
    );
    manager.client.on('gameResumed', (event) =>
      this.pauseController!.handleNetworkResume(event)
    );
  }

  private sendClientReady(reason: string): void {
    if (!this.ctx) return;
    this.ctx.manager.sendReady();
    this.hasSentClientReady = true;
    console.log(`[Game] Sent client-ready signal (${reason})`);
  }

  // ── Cleanup ─────────────────────────────────────────────────────

  dispose(): void {
    this.menuPresenter.stopAutoRotate();
    this.commandFlushUnsubscribe?.();
    this.commandFlushUnsubscribe = null;
    this.reconnectStateUnsubscribe?.();
    this.reconnectStateUnsubscribe = null;
    if (this.world) {
      this.world.stop();
      this.world.dispose();
    }
    this.ctx?.dispose();
    this.sceneCtx.renderer.dispose();
    this.ui.dispose();
  }

  private consumeDeepLinkRoomCode(): string | null {
    const urlParams = new URLSearchParams(window.location.search);
    const roomCodeFromUrl = urlParams.get('ROOM') ?? urlParams.get('room');

    if (roomCodeFromUrl) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    return roomCodeFromUrl ? roomCodeFromUrl.toUpperCase() : null;
  }
}
