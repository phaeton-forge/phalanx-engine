import type {
  CountdownEvent,
  MatchFoundEvent,
  GameStartEvent,
} from 'phalanx-client';
import type { NetworkContext } from './NetworkContext.ts';
import type { RoomRecoveryManager } from './RoomRecoveryManager.ts';
import { clearRoom as clearActiveRoom } from './RoomPersistence.ts';
import type { UIManager } from '../ui/UIManager.ts';
import type { MatchmakingScreen } from '../ui/screens/Matchmaking.ts';
import type { PrivateMatchScreen } from '../ui/screens/PrivateMatch.ts';

export interface PrivateRoomCallbacks {
  onMatchReady(matchData: MatchFoundEvent): void;
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
 */
export class PrivateRoomCoordinator {
  constructor(
    private readonly ctx: NetworkContext,
    private readonly recovery: RoomRecoveryManager,
    private readonly ui: UIRefs,
    private readonly callbacks: PrivateRoomCallbacks
  ) {}

  async createRoom(): Promise<void> {
    const { uiManager, matchmaking, privateMatch } = this.ui;

    try {
      this.log('host', 'createRoom:start');
      this.ui.stopMenuAutoRotate();
      uiManager.hideScreen('private-match');
      uiManager.destroyScreen('matchmaking');
      uiManager.showScreen('matchmaking');
      matchmaking.setStatus('Подключение к серверу...');

      this.attachConnectErrorListeners();

      this.log('host', 'client.connect:before');
      await this.ctx.manager.client.connect();
      this.log('host', 'client.connect:after');
      matchmaking.setStatus('Создание комнаты...');

      this.log('host', 'manager.createRoom:before');
      const roomEvent = await this.ctx.manager.createRoom();
      const roomCode = roomEvent.code;
      this.log('host', 'manager.createRoom:after', { roomCode });

      // Wire up event-driven recovery before any further awaits — the
      // socket can be torn down at any moment on mobile.
      this.recovery.startTrackingHostRoom(roomCode);
      this.log('host', 'recovery.startTrackingHostRoom', { roomCode });

      uiManager.hideScreen('matchmaking');
      privateMatch.showWaiting(roomCode);
      uiManager.showScreen('private-match');

      console.log(`[PrivateRoom] Created: ${roomCode}`);
      this.log('host', 'awaitMatchStart:before', { roomCode });

      await this.awaitMatchStart(matchmaking);
      this.log('host', 'awaitMatchStart:after', { roomCode });
    } catch (error) {
      console.error(
        '[PrivateRoom] Creation failed:',
        error instanceof Error ? error.message : JSON.stringify(error),
        error
      );
      this.log('host', 'createRoom:error', {
        error: this.stringifyError(error),
      });
      matchmaking.setStatus('Ошибка подключения');
      matchmaking.stopTimer();
      this.recovery.stop();
      this.callbacks.onCancelled();
    }
  }

  async joinRoom(code: string): Promise<void> {
    const { uiManager, matchmaking } = this.ui;

    const normalizedCode = code.trim().toUpperCase();
    console.log('OnJoinRoom:', code);
    this.log('guest', 'joinRoom:start', { roomCode: normalizedCode });
    try {
      this.ui.stopMenuAutoRotate();
      uiManager.hideScreen('private-match');
      uiManager.destroyScreen('matchmaking');
      uiManager.showScreen('matchmaking');
      matchmaking.setStatus('Подключение к серверу...');

      this.attachConnectErrorListeners();

      this.log('guest', 'client.connect:before', { roomCode: normalizedCode });
      await this.ctx.manager.client.connect();
      this.log('guest', 'client.connect:after', { roomCode: normalizedCode });
      matchmaking.setStatus('Присоединение к комнате...');

      // Persist as guest in case the second player backgrounds the
      // browser between `room-join` and `match-found`.
      this.recovery.trackGuestJoin(normalizedCode);
      this.log('guest', 'recovery.trackGuestJoin', { roomCode: normalizedCode });

      // Listen for room errors — track unsub to remove the listener
      // after the race so a late event doesn't unhandled-reject.
      let unsubRoomError: (() => void) | undefined;
      const roomErrorPromise = new Promise<never>((_resolve, reject) => {
        unsubRoomError = this.ctx.manager.client.on('roomError', (event) => {
          this.log('guest', 'roomError:event', {
            roomCode: normalizedCode,
            message: event.message,
          });
          reject(new Error(event.message));
        });
      });

      this.log('guest', 'manager.joinRoom:emit', { roomCode: normalizedCode });
      this.ctx.manager.joinRoom(normalizedCode);

      let matchData: MatchFoundEvent;
      try {
        this.log('guest', 'waitForMatch:before', { roomCode: normalizedCode });
        matchData = await Promise.race([
          this.ctx.manager.client.waitForMatch(),
          roomErrorPromise,
        ]);
        this.log('guest', 'waitForMatch:after', {
          roomCode: normalizedCode,
          matchId: matchData.matchId,
          teamId: matchData.teamId,
        });
      } finally {
        unsubRoomError?.();
      }
      matchmaking.stopTimer();

      uiManager.hideScreen('matchmaking');
      uiManager.destroyScreen('countdown');
      uiManager.showScreen('countdown');

      this.log('guest', 'waitForCountdown:before', {
        roomCode: normalizedCode,
        matchId: matchData.matchId,
      });
      await this.ctx.manager.client.waitForCountdown(
        (event: CountdownEvent) => {
          this.log('guest', 'countdown:event', {
            roomCode: normalizedCode,
            matchId: matchData.matchId,
            seconds: event.seconds,
          });
          matchmaking.updateCountdown(event.seconds);
        }
      );
      this.log('guest', 'waitForCountdown:after', {
        roomCode: normalizedCode,
        matchId: matchData.matchId,
      });

      this.log('guest', 'waitForGameStart:before', {
        roomCode: normalizedCode,
        matchId: matchData.matchId,
      });
      const gameStartEvent = await this.ctx.manager.client.waitForGameStart();
      console.log(
        '[PrivateRoom] Joined match, randomSeed:',
        gameStartEvent.randomSeed
      );
      this.log('guest', 'waitForGameStart:after', {
        roomCode: normalizedCode,
        matchId: gameStartEvent.matchId,
        randomSeed: gameStartEvent.randomSeed,
      });

      this.ctx.manager.setMatchData(matchData);
      this.ctx.cleanupConnectListeners();
      clearActiveRoom();

      uiManager.hideScreen('countdown');
      this.callbacks.onMatchReady(matchData);
    } catch (error) {
      // Surface the actual server message — without this it's
      // impossible to distinguish "Room not found" / "Already in a
      // match" / "Cannot join your own room" / socket error.
      const message = error instanceof Error ? error.message : String(error);
      console.error('[PrivateRoom] Join failed:', message, error);
      this.log('guest', 'joinRoom:error', {
        roomCode: normalizedCode,
        error: message,
      });
      matchmaking.setStatus(`Ошибка: ${message}`);
      matchmaking.stopTimer();
      clearActiveRoom();
      setTimeout(() => this.callbacks.onCancelled(), 2500);
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
      this.log('recovery', 'coldStartRecover:start', { roomCode: code });
      this.ui.stopMenuAutoRotate();
      privateMatch.showWaiting(code);
      uiManager.showScreen('private-match');
      privateMatch.setRecoveryStatus?.('Восстановление подключения…');

      // Pre-arm everything BEFORE recover (see comment in awaitMatchStart).
      this.recovery.resumeTrackingHostRoom(code);
      const matchPromise = this.awaitMatchStart(matchmaking);

      this.log('recovery', 'tryRecover:before', { roomCode: code });
      await this.recovery.tryRecover();
      // Either matchPromise resolves (server's pending-recover replayed
      // match-found → game-start) or we sit on the waiting screen.
      await matchPromise;
      this.log('recovery', 'coldStartRecover:after', { roomCode: code });
    } catch (error) {
      console.error('[PrivateRoom] Cold-start recover failed:', error);
      this.log('recovery', 'coldStartRecover:error', {
        roomCode: code,
        error: this.stringifyError(error),
      });
      // Don't auto-redirect on transient errors — `tryRecover` retries
      // and only `returnToMainMenu`s on terminal outcomes itself. If we
      // get here some unexpected error escaped — fall back.
      this.recovery.stop();
      this.callbacks.onCancelled();
    }
  }

  cancel(): void {
    this.log('shared', 'cancel');
    this.ctx.manager.cancelRoom();
    this.ui.privateMatch.stopWaitingTimer();
    this.ui.matchmaking.stopTimer();
    this.recovery.stop();
    this.callbacks.onCancelled();
  }

  // ── Internals ────────────────────────────────────────────────────

  private attachConnectErrorListeners(): void {
    const { matchmaking } = this.ui;
    this.ctx.trackConnectListener(
      this.ctx.manager.client.on('disconnected', () => {
        this.log('shared', 'client.disconnected:event');
        matchmaking.setStatus('Соединение потеряно');
      })
    );
    this.ctx.trackConnectListener(
      this.ctx.manager.client.on('error', (error) => {
        console.error('[PrivateRoom] Network error:', error.message);
        this.log('shared', 'client.error:event', { message: error.message });
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
   */
  private async awaitMatchStart(matchmaking: MatchmakingScreen): Promise<void> {
    const { uiManager, privateMatch } = this.ui;

    this.log('host', 'awaitMatchStart:arm-listeners');
    const matchFoundPromise =
      this.waitForClientEvent<MatchFoundEvent>('matchFound');
    const gameStartPromise =
      this.waitForClientEvent<GameStartEvent>('gameStart');
    const unsubCountdown = this.ctx.manager.client.on(
      'countdown',
      (event: CountdownEvent) => {
        this.log('host', 'countdown:event', { seconds: event.seconds });
        matchmaking.updateCountdown(event.seconds);
      }
    );

    try {
      const matchData = await matchFoundPromise;
      this.log('host', 'matchFound:event', {
        matchId: matchData.matchId,
        teamId: matchData.teamId,
        teammates: matchData.teammates.length,
        opponents: matchData.opponents.length,
      });
      privateMatch.stopWaitingTimer();
      matchmaking.stopTimer();

      uiManager.hideScreen('private-match');
      uiManager.destroyScreen('countdown');
      uiManager.showScreen('countdown');

      const gameStartEvent = await gameStartPromise;
      console.log(
        '[PrivateRoom] Game start, randomSeed:',
        gameStartEvent.randomSeed
      );
      this.log('host', 'gameStart:event', {
        matchId: gameStartEvent.matchId,
        randomSeed: gameStartEvent.randomSeed,
      });

      this.ctx.manager.setMatchData(matchData);
      this.ctx.cleanupConnectListeners();
      this.recovery.stop();

      uiManager.hideScreen('countdown');
      this.callbacks.onMatchReady(matchData);
    } finally {
      this.log('host', 'awaitMatchStart:cleanup-countdown-listener');
      unsubCountdown();
    }
  }

  private waitForClientEvent<T>(
    eventName: 'matchFound' | 'gameStart'
  ): Promise<T> {
    return new Promise((resolve) => {
      const unsubscribe = this.ctx.manager.client.on(
        eventName as 'matchFound',
        (data: unknown) => {
          this.log('shared', `waitForClientEvent:${eventName}:resolve`);
          unsubscribe();
          resolve(data as T);
        }
      );
    });
  }

  private log(
    role: 'host' | 'guest' | 'recovery' | 'shared',
    message: string,
    details: Record<string, unknown> = {},
  ): void {
    console.log(`[ChapaevPrivateRoom][${role}] ${message}`, {
      at: new Date().toISOString(),
      playerId: this.ctx.manager.localPlayerId,
      isConnected: this.ctx.manager.client.isConnected(),
      clientState: this.ctx.manager.client.getClientState(),
      ...details,
    });
  }

  private stringifyError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
