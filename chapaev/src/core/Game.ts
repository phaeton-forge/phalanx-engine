import type { GameWorld } from '@phalanx-engine/ecs';
import type { SceneContext } from '../rendering';
import { setupScene, MenuScenePresenter } from '../rendering';
import type { FlickInputSystem } from '../systems';
import { TeamTag } from '../enums/TeamTag.ts';
import {
  NetworkContext,
  RoomRecoveryManager,
  PrivateRoomCoordinator,
  MatchmakingCoordinator,
  type NetworkManagerOptions,
} from '../network';
import { GameUIController } from '../ui/GameUIController.ts';
import { GameHUDScreen } from '../ui/screens/GameHUD.ts';
import { bindHUDToWorld } from '../ui/HUDBindings.ts';
import { bootstrapWorld } from './WorldBootstrapper.ts';
import { PauseController } from './PauseController.ts';
import type {
  MatchFoundEvent,
  ReconnectStateEvent,
} from '@phalanx-engine/client';
import type { PlatformAdapter } from '../platform/PlatformAdapter.ts';
import { consumeUrlRoomCode } from '../platform/platformUtils.ts';
import { t } from '../i18n/i18n.ts';
import { generateBotOpponentDisplayName } from '../util/botOpponentName.ts';
import {
  trackGameEnd,
  trackGameExit,
  trackGameStart,
} from '../analytics/yandexMetrika.ts';

export type GameMode = 'hotseat' | 'online' | 'ai' | 'online_ai';

/** Local play sub-modes shown on the LocalGameMode screen. */
export type LocalMode = 'hotseat' | 'ai';

/**
 * Game — thin orchestrator that wires together the ECS world,
 * Three.js scene, UI, and the render loop.
 *
 * Supports three modes:
 * - hotseat: local two-player on one screen (Stage 1, internal tick loop)
 * - ai:      single-player vs. computer (Stage 1, internal tick loop)
 * - online:  network 1v1 via PhalanxClient (Stage 2, event tick mode)
 *
 * In `online` mode the user can also transition into `hotseat` or `ai` mode
 * in-memory from the main menu — no page reload needed.
 */
export class Game {
  /** The mode the app booted in (from URL); does not change after construction. */
  private readonly initialMode: GameMode;
  private readonly sceneCtx: SceneContext;
  private readonly ui = new GameUIController();
  private readonly menuPresenter: MenuScenePresenter;
  private readonly platform: PlatformAdapter;

  /**
   * Resolves after the first game frame is rendered.
   * `main.ts` awaits this to call `adapter.ready()` at the right moment,
   * so the platform loading splash hides only after a real frame is visible.
   */
  readonly firstFrameRendered: Promise<void>;
  private resolveFirstFrame!: () => void;

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
  /** Unsubscribe for the portal live party-invite join listener. */
  private joinRoomUnsubscribe: (() => void) | null = null;
  private localTeam: TeamTag = TeamTag.White;
  private hasSentClientReady = false;
  private inGameFlag = false;

  /** Metrika `game_type` for the active session (set when play starts). */
  private activeAnalyticsGameType: string | null = null;
  /** Wall-clock start for `game_end` duration (set with `game_start`). */
  private gameSessionStartedAt: number | null = null;

  /**
   * Distinguishes real online play from a local AI substitute after matchmaking
   * times out (affects pause behaviour — no server pause in substitute mode).
   */
  private onlineSessionKind: 'none' | 'network' | 'substitute_ai' = 'none';

  constructor(
    canvas: HTMLCanvasElement,
    platform: PlatformAdapter,
    mode: GameMode = 'hotseat'
  ) {
    this.initialMode = mode;
    this.platform = platform;
    this.sceneCtx = setupScene(canvas);
    this.menuPresenter = new MenuScenePresenter(this.sceneCtx);
    this.firstFrameRendered = new Promise<void>((resolve) => {
      this.resolveFirstFrame = resolve;
    });
  }

  start(): void {
    if (this.initialMode === 'hotseat' || this.initialMode === 'ai') {
      // Legacy URL-driven path: skip the menu and start a local match directly.
      this.startLocal(this.initialMode);
      return;
    }

    this.bootstrapOnlineCollaborators();
    this.menuPresenter.startAutoRotate();

    const roomCode = this.consumeDeepLinkRoomCode();

    if (roomCode) {
      void this.privateRoom!.openDeepLinkRoom(roomCode);
      return;
    }

    // Cold-start recovery: persisted host record from a previous tab.
    const persistedCode = this.recovery!.loadColdStartCode();
    if (persistedCode) {
      void this.privateRoom!.coldStartRecover(persistedCode);
      return;
    }

    // Portal invite cold-launch (CrazyGames): the game was opened from a
    // friend's party invite carrying a room code. This is a *separate* channel
    // from the `?ROOM=` / Telegram / Yandex deep-link consumed above, so it
    // can't double-fire. Join as a guest; wins over instant-multiplayer since
    // an explicit room to join beats spawning a fresh empty one.
    const inviteRoomCode = this.platform.getInviteRoomCode?.() ?? null;
    if (inviteRoomCode) {
      console.log('[Game] Launched from invite — joining room', inviteRoomCode);
      void this.privateRoom!.joinRoom(inviteRoomCode);
      return;
    }

    // Instant Multiplayer (CrazyGames): launched from the Multiplayer landing
    // page or a party invite with no specific room to join — create a fresh
    // joinable private room straight away instead of showing the menu, so
    // friends can join immediately. Checked AFTER deep-link / cold-start so an
    // explicit room to join always wins over spawning a new empty one.
    if (this.platform.isInstantMultiplayer?.()) {
      console.log('[Game] Instant multiplayer — creating room on launch');
      void this.privateRoom!.createRoom();
      return;
    }

    this.ui.uiManager.showScreen('main-menu');
  }

  // ── Online-mode bootstrap ───────────────────────────────────────

  private bootstrapOnlineCollaborators(): void {
    // Provider (not a one-shot value): a CrazyGames login mid-session refreshes
    // the cached username, and this recomputes it on the next connect/replace.
    this.ctx = new NetworkContext(() => this.getNetworkOptions());

    this.ui.build({
      onFindMatch: () => void this.handleFindMatch(),
      onPrivateMatch: () => void this.openPrivateMatchAfterAd(),
      onLocalGame: () => this.ui.showLocalGameMode(),
      onLocalGameVsAI: () => void this.startLocalAfterAd('ai'),
      onLocalGameHotseat: () => void this.startLocalAfterAd('hotseat'),
      onSignOut: () => {},

      onCancelMatchmaking: () => this.handleCancelMatchmaking(),

      onPause: () => {
        if (this.onlineSessionKind === 'substitute_ai') {
          this.trackVoluntaryGameExit();
          this.returnToMainMenu();
          return;
        }
        this.pauseController?.requestPause();
      },
      onResume: () => this.pauseController?.requestResume(),
      onLeaveMatch: () => {
        this.trackVoluntaryGameExit();
        this.returnToMainMenu();
      },

      onNewGame: () => void this.handleFindMatch(),
      onMainMenu: () => {
        this.returnToMainMenu();
      },

      onCreateRoom: () => {
        void this.privateRoom!.createRoom();
      },
      onJoinRoom: (code: string) => {
        void this.privateRoom!.joinRoom(code);
      },
      onCancelPrivateMatch: () => this.handleCancelPrivateMatch(),
      getPrivateRoomShareUrl: (code: string) =>
        this.platform.getInviteShareUrl(code),

      isInGame: () => this.inGameFlag,
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
      this.platform,
      {
        uiManager: this.ui.uiManager,
        matchmaking: this.ui.matchmaking,
        privateMatch: this.ui.privateMatch,
        stopMenuAutoRotate: () => this.menuPresenter.stopAutoRotate(),
      },
      {
        onMatchReady: (matchData, origin) =>
          this.startOnlineGame(matchData, origin),
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
        onMatchReady: (matchData, origin) =>
          this.startOnlineGame(matchData, origin),
        onError: () => this.returnToMainMenu(),
        onQueueTimeoutFallbackAI: () => this.startMatchmakingSubstituteAI(),
      }
    );

    // Live party-invite joins (CrazyGames): the player accepts an invite while
    // the game is already running (no reload). Ignore it mid-match — Chapaev is
    // 2/2 and we don't hot-swap an active game — otherwise join the room.
    this.joinRoomUnsubscribe =
      this.platform.onJoinRoomRequest?.((roomCode) => {
        if (this.inGameFlag) {
          console.log('[Game] Ignoring party invite — already in a match');
          return;
        }
        console.log('[Game] Party invite accepted — joining room', roomCode);
        void this.privateRoom!.joinRoom(roomCode);
      }) ?? null;
  }

  private getNetworkOptions(): NetworkManagerOptions {
    const userId = this.platform.getUserId();
    if (this.platform.getAuthScheme() === 'telegram' && userId) {
      return {
        playerId: `telegram:${userId}`,
        username: `Telegram-${userId}`,
      };
    }

    // Portal display name (e.g. CrazyGames User module). Optional per platform;
    // null off-portal or when the player isn't signed in, so the server keeps
    // assigning a guest name. The name then flows to the opponent's HUD.
    const username = this.platform.getUsername?.() ?? undefined;
    if (username) {
      return { username };
    }

    return {};
  }

  // ── UI handlers ─────────────────────────────────────────────────

  private async openPrivateMatchAfterAd(): Promise<void> {
    await this.platform.tryShowFullscreenAd();
    this.ui.showPrivateMatch();
  }

  private async startLocalAfterAd(mode: LocalMode): Promise<void> {
    await this.platform.tryShowFullscreenAd();
    this.handleStartLocal(mode);
  }

  private async handleFindMatch(): Promise<void> {
    await this.platform.tryShowFullscreenAd({ blocking: true });
    this.menuPresenter.stopAutoRotate();
    this.ui.showMatchmaking();
    void this.matchmaking!.connectAndStart();
  }

  private handleCancelMatchmaking(): void {
    this.ui.matchmaking.stopTimer();
    this.matchmaking?.markCancelledByUser();

    const client = this.ctx?.manager.client;
    if (client?.isConnected()) {
      try {
        client.leaveQueue();
      } catch {
        /* still proceed to replace */
      }
    }

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

  /**
   * Single source of truth for the "is a match active" flag. Also drives
   * platform gameplay lifecycle events (CrazyGames requires gameplayStart/Stop
   * around interactive play). Idempotent transitions are handled by the
   * adapter's own balancing guards.
   */
  private setInGame(value: boolean): void {
    if (this.inGameFlag === value) return;
    this.inGameFlag = value;
    if (value) {
      this.platform.onGameplayStart?.();
    } else {
      this.platform.onGameplayStop?.();
    }
  }

  private returnToMainMenu(): void {
    this.setInGame(false);
    this.onlineSessionKind = 'none';
    this.hasSentClientReady = false;
    this.clearAnalyticsSession();
    this.flickInputSystem = null;
    this.pauseController?.reset();
    this.recovery?.stop();
    this.platform.setClosingConfirmation(false);

    if (this.world) {
      this.world.stop();
      this.world.dispose();
      this.world = null;
    }

    this.commandFlushUnsubscribe?.();
    this.commandFlushUnsubscribe = null;
    this.reconnectStateUnsubscribe?.();
    this.reconnectStateUnsubscribe = null;

    // URL-launched local mode never bootstraps the menu, so there is no
    // main-menu screen to fall back to — just reload the page.
    if (!this.ctx) {
      window.location.search = '';
      return;
    }

    this.ctx.replace();

    this.ui.matchmaking.stopTimer();
    this.ui.destroyTransientScreens();
    this.ui.uiManager.showScreen('main-menu');
    this.menuPresenter.startAutoRotate();
  }

  // ── Local mode (hot-seat / vs AI) ───────────────────────────────

  /**
   * Menu auto-rotate adds a decorative board + checkers to `sceneCtx.scene`.
   * Any live `GameWorld` adds real meshes via `ThreeRenderSystem`. If a new
   * match starts without tearing both down, pieces appear duplicated.
   */
  private clearSceneAndWorldBeforeNewMatch(): void {
    this.menuPresenter.stopAutoRotate();
    if (this.world) {
      this.world.stop();
      this.world.dispose();
      this.world = null;
    }
    this.flickInputSystem = null;
  }

  /**
   * Transition from the main menu into a local match without reloading the page.
   * Tears down menu visuals, hides menu screens, then delegates to `startLocal`.
   */
  private handleStartLocal(localMode: LocalMode): void {
    this.menuPresenter.stopAutoRotate();
    this.ui.uiManager.hideScreen('local-game-mode');
    this.ui.uiManager.hideScreen('main-menu');
    this.startLocal(localMode);
  }

  private startLocal(localMode: LocalMode): void {
    this.setInGame(true);
    this.clearSceneAndWorldBeforeNewMatch();

    // Replace any previous game screen so HUD callbacks bind to local mode.
    this.ui.uiManager.destroyScreen('game');

    const hud = new GameHUDScreen(this.ui.uiManager, {
      onPause: () => {
        this.trackVoluntaryGameExit();
        this.returnToMainMenu();
      },
      onSettings: () => this.ui.showInGameSettings(),
    });
    this.ui.uiManager.showScreen('game');

    if (localMode === 'ai') {
      hud.setPlayerNames(t('name.you'), t('name.ai'));
      hud.updateTurnIndicator(true);
    } else {
      hud.setPlayerNames(t('name.whiteTeam'), t('name.blackTeam'));
      hud.setHotseatMode(true);
      hud.updateTurnIndicator(true, 'white');
    }

    const { world, flickInputSystem } = bootstrapWorld(
      localMode,
      this.sceneCtx,
      null
    );
    this.world = world;
    this.flickInputSystem = flickInputSystem;

    // Schedule the post-victory return to the main menu. Delay matches the
    // matching toast duration so the user can read the result.
    const scheduleReturn = (delayMs: number): void => {
      setTimeout(() => this.returnToMainMenu(), delayMs);
    };

    const analyticsType = localMode === 'ai' ? 'local_ai' : 'local_hotseat';
    this.beginAnalyticsSession(analyticsType);

    bindHUDToWorld(
      world,
      hud,
      localMode === 'ai'
        ? {
            mode: 'online',
            localTeam: TeamTag.White,
            onGameOver: () => {
              this.trackNaturalGameEnd();
              scheduleReturn(3500);
            },
          }
        : {
            mode: 'hotseat',
            onGameOver: () => {
              this.trackNaturalGameEnd();
              scheduleReturn(4500);
            },
          }
    );

    const { composer, controls } = this.sceneCtx;
    world.start({
      afterFrame: () => {
        controls.update();
        composer.render();
        this.resolveFirstFrame();
      },
    });
  }

  // ── Online game start (after matchmaking) ───────────────────────

  private startOnlineGame(
    matchData: MatchFoundEvent,
    origin: 'public' | 'private'
  ): void {
    if (!this.ctx) return;

    this.clearSceneAndWorldBeforeNewMatch();

    this.setInGame(true);
    this.onlineSessionKind = 'network';
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

    this.ui.gameHUD.setPauseAsMenuExit(false);

    const localUser = this.ctx.manager.client.getUser();
    const localName =
      localUser?.username ??
      this.ctx.manager.client.getUsername() ??
      t('name.you');
    const opponentName = matchData.opponents[0]?.username ?? t('name.opponent');
    this.ui.gameHUD.setPlayerNames(
      localPlayerIndex === 0 ? localName : opponentName,
      localPlayerIndex === 1 ? localName : opponentName
    );
    this.ui.gameHUD.updateTurnIndicator(localPlayerIndex === 0);

    const { world, flickInputSystem } = bootstrapWorld(
      'online',
      this.sceneCtx,
      this.ctx.manager
    );
    this.world = world;
    this.flickInputSystem = flickInputSystem;

    // Keep a minimal frame subscription so PhalanxClient flushes commands.
    this.commandFlushUnsubscribe = this.ctx.manager.client.onFrame(() => {});

    const analyticsType = origin === 'private' ? 'online_private' : 'online';
    this.beginAnalyticsSession(analyticsType);

    bindHUDToWorld(world, this.ui.gameHUD, {
      mode: 'online',
      localTeam: this.localTeam,
      onGameOver: () => {
        this.trackNaturalGameEnd();
        setTimeout(() => this.returnToMainMenu(), 3500);
      },
    });

    this.setupNetworkEvents();

    const { composer, controls } = this.sceneCtx;
    world.start({
      beforeFrame: () => {
        controls.update();
      },
      afterFrame: () => {
        composer.render();
        this.resolveFirstFrame();
      },
    });

    this.platform.setClosingConfirmation(true);
    this.sendClientReady('initial game start');
  }

  /**
   * After public matchmaking waits too long for a human opponent, drop the
   * queue silently and run a local AI opponent that mimics online HUD
   * (your turn / opponent's turn, guest-style opponent name).
   */
  private async startMatchmakingSubstituteAI(): Promise<void> {
    if (!this.ctx) return;

    this.clearSceneAndWorldBeforeNewMatch();

    this.setInGame(true);
    this.onlineSessionKind = 'substitute_ai';
    this.hasSentClientReady = false;

    this.localTeam = TeamTag.White;

    const localUser = this.ctx.manager.client.getUser();
    const localName =
      localUser?.username ??
      this.ctx.manager.client.getUsername() ??
      t('name.you');
    const opponentName = generateBotOpponentDisplayName();

    await this.ui.matchmaking.runLocalCountdown(localName, opponentName);
    this.ui.uiManager.hideScreen('countdown-local');

    this.menuPresenter.adjustCameraForTeam(this.localTeam);

    this.ui.uiManager.destroyScreen('game');
    this.ui.uiManager.showScreen('game');

    this.ui.gameHUD.setPlayerNames(localName, opponentName);
    this.ui.gameHUD.setPauseAsMenuExit(true);
    this.ui.gameHUD.updateTurnIndicator(true);

    const { world, flickInputSystem } = bootstrapWorld(
      'online_ai',
      this.sceneCtx,
      null
    );
    this.world = world;
    this.flickInputSystem = flickInputSystem;

    const scheduleReturn = (delayMs: number): void => {
      setTimeout(() => this.returnToMainMenu(), delayMs);
    };

    this.beginAnalyticsSession('online_ai');

    bindHUDToWorld(world, this.ui.gameHUD, {
      mode: 'online',
      localTeam: this.localTeam,
      onGameOver: () => {
        this.trackNaturalGameEnd();
        scheduleReturn(3500);
      },
    });

    const { composer, controls } = this.sceneCtx;
    world.start({
      afterFrame: () => {
        controls.update();
        composer.render();
        this.resolveFirstFrame();
      },
    });
  }

  private beginAnalyticsSession(gameType: string): void {
    this.activeAnalyticsGameType = gameType;
    this.gameSessionStartedAt = Date.now();
    trackGameStart(gameType);
  }

  private clearAnalyticsSession(): void {
    this.activeAnalyticsGameType = null;
    this.gameSessionStartedAt = null;
  }

  private sessionDurationMs(): number {
    if (this.gameSessionStartedAt == null) return 0;
    return Math.max(0, Date.now() - this.gameSessionStartedAt);
  }

  private trackNaturalGameEnd(): void {
    const gameType = this.activeAnalyticsGameType;
    if (!gameType) return;
    trackGameEnd(gameType, this.sessionDurationMs());
  }

  private trackVoluntaryGameExit(): void {
    const gameType = this.activeAnalyticsGameType;
    if (!gameType) return;
    trackGameExit(gameType);
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
        if (!this.inGameFlag || !this.world || !this.hasSentClientReady) return;
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
    this.joinRoomUnsubscribe?.();
    this.joinRoomUnsubscribe = null;
    if (this.world) {
      this.world.stop();
      this.world.dispose();
    }
    this.ctx?.dispose();
    this.sceneCtx.renderer.dispose();
    this.ui.dispose();
  }

  private consumeDeepLinkRoomCode(): string | null {
    // Platform deep-link code (Yandex payload or Telegram start_param). On
    // Standalone/CrazyGames this already consumes `?ROOM=` via consumeUrlRoomCode.
    const platformRoom = this.platform.getLaunchRoomCode();
    if (platformRoom) return platformRoom;

    // URL-based fallback for platforms whose primary channel is NOT the URL
    // (Telegram start_param, Yandex payload): a game opened by a plain web link
    // carrying `?ROOM=` should still deep-link. Reuse consumeUrlRoomCode so the
    // code is pattern-validated and the query param is stripped from history
    // consistently — the old inline parse skipped validation, letting a
    // malformed code drive a bogus openDeepLinkRoom.
    return consumeUrlRoomCode();
  }
}
