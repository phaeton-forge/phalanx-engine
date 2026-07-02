import type { CountdownEvent, MatchFoundEvent } from '@phalanx-engine/client';
import type { NetworkContext } from './NetworkContext.ts';
import type { RoomRecoveryManager } from './RoomRecoveryManager.ts';
import type { PlatformAdapter } from '../platform/PlatformAdapter.ts';
import type { UIManager } from '../ui/UIManager.ts';
import type { MatchmakingScreen } from '../ui/screens/Matchmaking.ts';
import type { PrivateMatchScreen } from '../ui/screens/PrivateMatch.ts';
import { trackMatchFound } from '../analytics/yandexMetrika.ts';
import { t } from '../i18n/i18n.ts';

export interface PrivateRoomCallbacks {
  onMatchReady(matchData: MatchFoundEvent, origin: 'public' | 'private'): void;
  onCancelled(): void;
}

interface UIRefs {
  uiManager: UIManager;
  matchmaking: MatchmakingScreen;
  privateMatch: PrivateMatchScreen;
  stopMenuAutoRotate(): void;
}

/**
 * Owns the create-room / join-room / cold-start-recover flows. Pulls
 * `RoomRecoveryManager` for the recovery state machine and reads the
 * current `NetworkManager` through `NetworkContext` so it survives the
 * "cancel → fresh manager" cycle without needing to be re-instantiated.
 *
 * The pre-game stall watchdog (if `matchFound`/`countdown` arrive but
 * `gameStart` doesn't) is auto-armed by the engine's
 * `RoomRecoveryController` whenever a room is being tracked, so this
 * coordinator does not need its own copy of that timer.
 */
export class PrivateRoomCoordinator {
  /**
   * Room the local player is currently in, tracked so the portal room state
   * (CrazyGames Multiplayer module) can be announced on join and cleared on
   * leave. Null when not in any private room.
   */
  private currentRoomCode: string | null = null;

  constructor(
    private readonly ctx: NetworkContext,
    private readonly recovery: RoomRecoveryManager,
    private readonly platform: PlatformAdapter,
    private readonly ui: UIRefs,
    private readonly callbacks: PrivateRoomCallbacks
  ) {}

  async createRoom(): Promise<void> {
    const { uiManager, matchmaking, privateMatch } = this.ui;

    try {
      this.ui.stopMenuAutoRotate();
      uiManager.hideScreen('private-match');
      uiManager.destroyScreen('matchmaking');
      uiManager.showScreen('matchmaking');
      matchmaking.setStatus(t('net.connecting'));

      this.attachConnectErrorListeners();

      await this.ctx.manager.client.connect();
      matchmaking.setStatus(t('net.creatingRoom'));

      const roomEvent = await this.ctx.manager.createRoom();
      const roomCode = roomEvent.code;

      // Wire up event-driven recovery before any further awaits — the
      // socket can be torn down at any moment on mobile.
      this.recovery.startTrackingHostRoom(roomCode);

      // Announce the joinable room to the portal + show the native invite CTA
      // so friends can be pulled in while we sit on the waiting screen.
      this.enterPortalRoom(roomCode);

      uiManager.hideScreen('matchmaking');
      privateMatch.showWaiting(roomCode);
      uiManager.showScreen('private-match');

      console.log(`[PrivateRoom] Created: ${roomCode}`);

      await this.awaitMatchStart(matchmaking);
    } catch (error) {
      console.error(
        '[PrivateRoom] Creation failed:',
        error instanceof Error ? error.message : JSON.stringify(error),
        error
      );
      matchmaking.setStatus(t('net.connectionError'));
      matchmaking.stopTimer();
      this.recovery.stop();
      this.leavePortalRoom();
      this.callbacks.onCancelled();
    }
  }

  async joinRoom(code: string): Promise<void> {
    const { uiManager, matchmaking } = this.ui;

    const normalizedCode = code.trim().toUpperCase();
    try {
      this.ui.stopMenuAutoRotate();
      uiManager.hideScreen('private-match');
      uiManager.destroyScreen('matchmaking');
      uiManager.showScreen('matchmaking');
      matchmaking.setStatus(t('net.connecting'));

      this.attachConnectErrorListeners();

      await this.ctx.manager.client.connect();
      matchmaking.setStatus(t('net.joiningRoom'));

      // Persist as guest in case the second player backgrounds the
      // browser between `room-join` and `match-found`.
      this.recovery.trackGuestJoin(normalizedCode);

      // Listen for room errors — track unsub to remove the listener
      // after the race so a late event doesn't unhandled-reject.
      let unsubRoomError: (() => void) | undefined;
      const roomErrorPromise = new Promise<never>((_resolve, reject) => {
        unsubRoomError = this.ctx.manager.client.on('roomError', (event) => {
          reject(new Error(event.message));
        });
      });

      this.ctx.manager.joinRoom(normalizedCode);

      let matchData: MatchFoundEvent;
      try {
        matchData = await Promise.race([
          this.ctx.manager.client.waitForMatch(),
          roomErrorPromise,
        ]);
      } finally {
        unsubRoomError?.();
      }
      matchmaking.stopTimer();

      trackMatchFound('private');

      uiManager.hideScreen('matchmaking');
      uiManager.destroyScreen('countdown');
      uiManager.showScreen('countdown');

      await this.ctx.manager.client.waitForCountdown(
        (event: CountdownEvent) => {
          matchmaking.updateCountdown(event.seconds);
        }
      );

      const gameStartEvent = await this.ctx.manager.client.waitForGameStart();
      console.log(
        '[PrivateRoom] Joined match, randomSeed:',
        gameStartEvent.randomSeed
      );

      // The guest is now in an active, full room. Announce the association so
      // the portal treats the player as in-room (non-joinable) rather than
      // free-roaming; no invite button for the joining side.
      this.currentRoomCode = normalizedCode;
      this.closePortalRoom();

      this.ctx.manager.setMatchData(matchData);
      this.ctx.cleanupConnectListeners();
      this.recovery.stop();

      uiManager.hideScreen('countdown');
      this.callbacks.onMatchReady(matchData, 'private');
    } catch (error) {
      // Surface the actual server message — without this it's
      // impossible to distinguish "Room not found" / "Already in a
      // match" / "Cannot join your own room" / socket error.
      const message = error instanceof Error ? error.message : String(error);
      console.error('[PrivateRoom] Join failed:', message, error);
      matchmaking.setStatus(t('net.errorPrefix', { message }));
      matchmaking.stopTimer();
      this.recovery.stop();
      this.leavePortalRoom();
      setTimeout(() => this.callbacks.onCancelled(), 2500);
    }
  }

  async openDeepLinkRoom(code: string): Promise<void> {
    const { uiManager, privateMatch, matchmaking } = this.ui;
    const normalizedCode = code.trim().toUpperCase();

    try {
      this.ui.stopMenuAutoRotate();
      privateMatch.showWaiting(normalizedCode);
      uiManager.showScreen('private-match');
      privateMatch.setRecoveryStatus?.(t('recovery.restoring'));

      this.attachConnectErrorListeners();
      await this.ctx.manager.client.connect();

      const recoverAbort = new AbortController();
      const matchPromise = this.awaitMatchStart(
        matchmaking,
        recoverAbort.signal
      );

      try {
        await this.ctx.manager.client.recoverRoom(normalizedCode, 2_000);
      } catch {
        recoverAbort.abort();
        await matchPromise.catch(() => undefined);
        this.ctx.cleanupConnectListeners();
        this.recovery.stop();
        privateMatch.stopWaitingTimer();
        uiManager.hideScreen('private-match');
        // Recovery as host failed — fall back to joining as a guest, which
        // manages its own portal room state from scratch.
        this.leavePortalRoom();
        await this.joinRoom(normalizedCode);
        return;
      }

      this.recovery.resumeTrackingHostRoom(normalizedCode);
      // Reclaimed the room as host — re-announce it as joinable to the portal
      // (matchPromise will close it once the second player arrives).
      this.enterPortalRoom(normalizedCode);
      await matchPromise;
    } catch (error) {
      console.error('[PrivateRoom] Deep-link room open failed:', error);
      matchmaking.setStatus(t('net.connectionError'));
      matchmaking.stopTimer();
      this.recovery.stop();
      this.leavePortalRoom();
      this.callbacks.onCancelled();
    }
  }

  /**
   * Reclaim a private room after a hard reload. Sets up the same
   * listener stack `createRoom` uses BEFORE issuing `room-recover`,
   * so the synchronous match-found → reconnect-state → game-start
   * cascade from the server's pending-recover path is fully observed.
   */
  async coldStartRecover(code: string): Promise<void> {
    const { uiManager, matchmaking, privateMatch } = this.ui;

    try {
      this.ui.stopMenuAutoRotate();
      privateMatch.showWaiting(code);
      uiManager.showScreen('private-match');
      privateMatch.setRecoveryStatus?.(t('recovery.restoring'));

      // Pre-arm everything BEFORE recover (see comment in awaitMatchStart).
      this.recovery.resumeTrackingHostRoom(code);
      const matchPromise = this.awaitMatchStart(matchmaking);

      // Reclaimed our host room after a hard reload — re-announce it joinable.
      this.enterPortalRoom(code);

      await this.recovery.tryRecover();
      // Either matchPromise resolves (server's pending-recover replayed
      // match-found → game-start) or we sit on the waiting screen.
      await matchPromise;
    } catch (error) {
      console.error('[PrivateRoom] Cold-start recover failed:', error);
      // Don't auto-redirect on transient errors — `tryRecover` retries
      // and only `returnToMainMenu`s on terminal outcomes itself. If we
      // get here some unexpected error escaped — fall back.
      this.recovery.stop();
      this.leavePortalRoom();
      this.callbacks.onCancelled();
    }
  }

  cancel(): void {
    this.ctx.manager.cancelRoom();
    this.ui.privateMatch.stopWaitingTimer();
    this.ui.matchmaking.stopTimer();
    this.recovery.stop();
    this.leavePortalRoom();
    this.callbacks.onCancelled();
  }

  // ── Portal room-state announcements ──────────────────────────────
  // Mirror the private-room lifecycle to the platform (CrazyGames Multiplayer
  // module). Every method is a clean no-op on adapters that don't implement
  // the optional room API (Telegram, Yandex, standalone).

  /** Player has entered a joinable room: announce it + surface an invite CTA. */
  private enterPortalRoom(roomCode: string): void {
    this.currentRoomCode = roomCode;
    this.platform.updateRoom?.(roomCode, true);
    this.platform.showInviteButton?.(roomCode);
  }

  /**
   * Room can no longer be joined (match starting / room full). Keep the room
   * association but flip it closed and drop the invite CTA. Chapaev is a fixed
   * 2-player game, so a started match is always full.
   */
  private closePortalRoom(): void {
    if (this.currentRoomCode) {
      this.platform.updateRoom?.(this.currentRoomCode, false);
    }
    this.platform.hideInviteButton?.();
  }

  /** Player left the room entirely (cancel / error / return to menu). */
  private leavePortalRoom(): void {
    this.currentRoomCode = null;
    this.platform.hideInviteButton?.();
    this.platform.leftRoom?.();
  }

  // ── Internals ────────────────────────────────────────────────────

  private attachConnectErrorListeners(): void {
    const { matchmaking } = this.ui;
    this.ctx.trackConnectListener(
      this.ctx.manager.client.on('disconnected', () => {
        matchmaking.setStatus(t('net.connectionLost'));
      })
    );
    this.ctx.trackConnectListener(
      this.ctx.manager.client.on('error', (error) => {
        console.error('[PrivateRoom] Network error:', error.message);
      })
    );
  }

  /**
   * Listen via the client event emitter (rather than `waitForMatch`/etc.)
   * because the host's socket may get torn down mid-flow and the recover
   * path re-emits these events on the fresh socket. Both `matchFound`
   * and `gameStart` listeners MUST be registered *before* awaiting
   * anything — the server's pending-recover path emits all of
   * match-found → countdown → game-start synchronously.
   *
   * The pre-game stall watchdog (force-recover when the
   * matchFound→countdown→gameStart cascade goes silent) is owned by
   * the engine's `RoomRecoveryController` while a room is being
   * tracked, so this method only orchestrates UI transitions.
   */
  private async awaitMatchStart(
    matchmaking: MatchmakingScreen,
    abortSignal?: AbortSignal
  ): Promise<void> {
    const { uiManager, privateMatch } = this.ui;

    const matchFoundPromise = this.waitForClientEvent<MatchFoundEvent>(
      'matchFound',
      abortSignal
    );
    const gameStartPromise = this.waitForClientEvent<unknown>(
      'gameStart',
      abortSignal
    );
    const unsubCountdown = this.ctx.manager.client.on(
      'countdown',
      (event: CountdownEvent) => {
        matchmaking.updateCountdown(event.seconds);
      }
    );

    try {
      const matchData = await matchFoundPromise;
      privateMatch.stopWaitingTimer();
      matchmaking.stopTimer();

      // Second player is in — the room is now full (Chapaev is 2/2). Tell the
      // portal it's no longer joinable and retire the invite button.
      this.closePortalRoom();

      trackMatchFound('private');

      uiManager.hideScreen('private-match');
      uiManager.destroyScreen('countdown');
      uiManager.showScreen('countdown');

      await gameStartPromise;

      this.ctx.manager.setMatchData(matchData);
      this.ctx.cleanupConnectListeners();
      this.recovery.stop();

      uiManager.hideScreen('countdown');
      this.callbacks.onMatchReady(matchData, 'private');
    } finally {
      unsubCountdown();
    }
  }

  private waitForClientEvent<T>(
    eventName: 'matchFound' | 'gameStart',
    abortSignal?: AbortSignal
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (abortSignal?.aborted) {
        reject(new Error('Wait cancelled'));
        return;
      }

      let unsubscribe = (): void => {};
      const abortHandler = (): void => {
        unsubscribe();
        reject(new Error('Wait cancelled'));
      };

      unsubscribe = this.ctx.manager.client.on(
        eventName as 'matchFound',
        (data: unknown) => {
          abortSignal?.removeEventListener('abort', abortHandler);
          unsubscribe();
          resolve(data as T);
        }
      );

      abortSignal?.addEventListener('abort', abortHandler, { once: true });
    });
  }
}
