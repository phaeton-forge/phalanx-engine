/**
 * SocketManager - Manages socket.io connection and event handling
 *
 * Handles:
 * - Connection/disconnection to server
 * - Socket event routing
 * - Reconnection logic with retries
 * - Connection state tracking
 */

import { io, Socket } from 'socket.io-client';
import type {
  MatchFoundEvent,
  CountdownEvent,
  GameStartEvent,
  TickSyncEvent,
  CommandsBatchEvent,
  QueueStatusEvent,
  RoomCreatedEvent,
  RoomErrorEvent,
  RoomExpiredEvent,
  RoomCancelledEvent,
  RoomRecoveredEvent,
  PlayerDisconnectedEvent,
  PlayerReconnectedEvent,
  PlayerReadyEvent,
  ReconnectStateEvent,
  ReconnectStatusEvent,
  SubmitCommandsAck,
  MatchEndEvent,
  HashComparisonEvent,
  GamePausedEvent,
  GameResumedEvent,
  PhalanxError,
  ConnectionState,
  PlayerCommand,
  SocketTransport,
} from './types.js';

/**
 * Configuration for SocketManager
 */
export interface SocketManagerConfig {
  /** Server URL */
  serverUrl: string;
  /** Player ID */
  playerId: string;
  /** Username */
  username: string;
  /** Authentication token (e.g., Google ID token) */
  authToken?: string;
  /** Connection timeout in milliseconds */
  connectionTimeoutMs: number;
  /** Timeout for private-room recovery acknowledgement in milliseconds */
  recoverRoomTimeoutMs: number;
  /** Socket.IO transports to use when connecting */
  socketTransports: readonly SocketTransport[];
  /** Whether to auto-reconnect */
  autoReconnect: boolean;
  /** Maximum reconnection attempts */
  maxReconnectAttempts: number;
  /** Delay between reconnection attempts in milliseconds */
  reconnectDelayMs: number;
  /** Enable debug logging */
  debug: boolean;
}

/**
 * Callbacks from SocketManager to the client
 */
export interface SocketManagerCallbacks {
  // Connection events
  onConnected: () => void;
  onDisconnected: () => void;
  onReconnecting: (attempt: number) => void;
  onReconnectFailed: () => void;
  onError: (error: PhalanxError) => void;

  // Match lifecycle events
  onMatchFound: (data: MatchFoundEvent) => void;
  onCountdown: (data: CountdownEvent) => void;
  onGameStart: (data: GameStartEvent) => void;
  onMatchEnd: (data: MatchEndEvent) => void;

  // Tick events
  onTickSync: (data: TickSyncEvent) => void;
  onCommandsBatch: (data: CommandsBatchEvent) => void;

  // Player events
  onPlayerDisconnected: (data: PlayerDisconnectedEvent) => void;
  onPlayerReconnected: (data: PlayerReconnectedEvent) => void;
  onPlayerReady: (data: PlayerReadyEvent) => void;

  // Reconnection events
  onReconnectState: (data: ReconnectStateEvent) => void;
  onReconnectStatus: (data: ReconnectStatusEvent) => void;

  // Desync detection events
  onHashComparison: (data: HashComparisonEvent) => void;

  // Pause events
  onGamePaused: (data: GamePausedEvent) => void;
  onGameResumed: (data: GameResumedEvent) => void;

  // Private room events
  onRoomError: (data: RoomErrorEvent) => void;
  onRoomExpired: (data: RoomExpiredEvent) => void;
  onRoomCancelled: (data: RoomCancelledEvent) => void;
  onRoomRecovered: (data: RoomRecoveredEvent) => void;

  // State queries (for reconnection logic)
  isPlaying: () => boolean;
  getCurrentMatchId: () => string | null;
}

/**
 * SocketManager - Handles socket.io connection and event handling
 */
export class SocketManager {
  private socket: Socket | null = null;
  private config: SocketManagerConfig;
  private callbacks: SocketManagerCallbacks;

  private connectionState: ConnectionState = 'disconnected';
  private reconnectAttempts: number = 0;

  constructor(config: SocketManagerConfig, callbacks: SocketManagerCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  // ============================================
  // CONNECTION
  // ============================================

  /**
   * Connect to the server
   */
  async connect(): Promise<void> {
    if (this.connectionState === 'connected') {
      return;
    }

    this.connectionState = 'connecting';

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket?.disconnect();
        this.connectionState = 'disconnected';
        reject(new Error('Connection timeout'));
      }, this.config.connectionTimeoutMs);

      this.socket = io(this.config.serverUrl, {
        forceNew: true,
        transports: [...this.config.socketTransports],
        reconnection: false, // We handle reconnection ourselves
        auth: this.config.authToken
          ? { token: this.config.authToken }
          : undefined,
      });

      this.socket.on('connect', () => {
        clearTimeout(timeout);
        this.connectionState = 'connected';
        this.reconnectAttempts = 0;
        this.setupEventHandlers();
        this.callbacks.onConnected();
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        clearTimeout(timeout);
        this.connectionState = 'disconnected';
        reject(new Error(`Connection failed: ${error.message}`));
      });
    });
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    this.connectionState = 'disconnected';
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return (
      this.connectionState === 'connected' && this.socket?.connected === true
    );
  }

  /**
   * Get connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Update player credentials (after auth)
   */
  updateCredentials(playerId: string, username: string, authToken?: string): void {
    this.config.playerId = playerId;
    this.config.username = username;
    this.config.authToken = authToken;
  }

  // ============================================
  // QUEUE OPERATIONS
  // ============================================

  /**
   * Join the matchmaking queue
   */
  async joinQueue(gameType?: string): Promise<QueueStatusEvent> {
    this.ensureConnected();

    return new Promise((resolve, reject) => {
      const errorHandler = (error: PhalanxError) => {
        this.socket?.off('queue-status', statusHandler);
        reject(new Error(error.message));
      };

      const statusHandler = (status: QueueStatusEvent) => {
        this.socket?.off('queue-error', errorHandler);
        resolve(status);
      };

      this.socket!.once('queue-status', statusHandler);
      this.socket!.once('queue-error', errorHandler);

      this.socket!.emit('queue-join', {
        playerId: this.config.playerId,
        username: this.config.username,
        gameType,
      });
    });
  }

  /**
   * Leave the matchmaking queue
   */
  leaveQueue(): void {
    this.ensureConnected();

    this.socket!.emit('queue-leave', {
      playerId: this.config.playerId,
    });
  }

  // ============================================
  // PRIVATE ROOM OPERATIONS
  // ============================================

  /**
   * Create a private room. Resolves with the room code.
   */
  async createRoom(gameType?: string): Promise<RoomCreatedEvent> {
    this.ensureConnected();

    return new Promise((resolve, reject) => {
      const errorHandler = (error: RoomErrorEvent) => {
        this.socket?.off('room-created', createdHandler);
        reject(new Error(error.message));
      };

      const createdHandler = (event: RoomCreatedEvent) => {
        this.socket?.off('room-error', errorHandler);
        resolve(event);
      };

      this.socket!.once('room-created', createdHandler);
      this.socket!.once('room-error', errorHandler);

      this.socket!.emit('room-create', {
        playerId: this.config.playerId,
        username: this.config.username,
        gameType,
      });
    });
  }

  /**
   * Join an existing private room by code.
   * After joining, the server will emit match-found to both players.
   */
  joinRoom(code: string): void {
    this.ensureConnected();

    this.socket!.emit('room-join', {
      playerId: this.config.playerId,
      username: this.config.username,
      code,
    });
  }

  /**
   * Cancel a previously created private room.
   */
  cancelRoom(): void {
    this.ensureConnected();
    this.socket!.emit('room-cancel');
  }

  /**
   * Reclaim a private room after the underlying socket was briefly torn
   * down and reconnected.
   *
   * This is the client half of the host-disconnect grace-period contract
   * introduced server-side in PR #18 and extended with countdown/game-start
   * snapshotting in PR #19: the server holds the room (and, if the guest
   * already joined, the running match) open for `HOST_DISCONNECT_GRACE_MS`
   * so the host's new socket can reclaim it via `room-recover`.
   *
   * Typical trigger: a mobile browser kills the WebSocket when the user
   * switches to a messenger to share the invite link, then re-opens the
   * tab. The caller (Game / UI layer) should listen for `visibilitychange`
   * and, when the tab becomes visible again and the socket is dead, call
   * `connect()` followed by `recoverRoom(code)`.
   *
   * Resolves with the `RoomRecoveredEvent` on success. Rejects with the
   * server's error message on `room-error`, or with `'Recover timeout'`
   * if the server never answers within `timeoutMs` (default 10 s). The
   * timeout is important because a stubbornly flaky connection can cause
   * `socket.emit` to succeed locally but never round-trip — we must not
   * leave the host hanging on a dead promise while their countdown UI
   * stays frozen.
   */
  async recoverRoom(
    code: string,
    timeoutMs: number = this.config.recoverRoomTimeoutMs,
  ): Promise<RoomRecoveredEvent> {
    this.ensureConnected();

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = (): void => {
        this.socket?.off('room-recovered', recoveredHandler);
        this.socket?.off('room-error', errorHandler);
        clearTimeout(timer);
      };

      const recoveredHandler = (event: RoomRecoveredEvent): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(event);
      };

      const errorHandler = (error: RoomErrorEvent): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(error.message));
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Recover timeout'));
      }, timeoutMs);

      this.socket!.once('room-recovered', recoveredHandler);
      this.socket!.once('room-error', errorHandler);

      this.socket!.emit('room-recover', {
        playerId: this.config.playerId,
        username: this.config.username,
        code,
      });
    });
  }

  /**
   * Register a handler for room-recovered events. Exposed alongside the
   * one-shot `recoverRoom` promise so callers that want to observe
   * recoveries initiated elsewhere (e.g. for analytics) can do so.
   */
  onRoomRecovered(handler: (event: RoomRecoveredEvent) => void): void {
    this.socket?.on('room-recovered', handler);
  }

  /**
   * Register a handler for room-expired events.
   */
  onRoomExpired(handler: (event: RoomExpiredEvent) => void): void {
    this.socket?.on('room-expired', handler);
  }

  /**
   * Register a handler for room-cancelled events.
   */
  onRoomCancelled(handler: (event: RoomCancelledEvent) => void): void {
    this.socket?.on('room-cancelled', handler);
  }

  /**
   * Wait for match found event
   */
  async waitForMatch(): Promise<MatchFoundEvent> {
    this.ensureConnected();

    return new Promise((resolve) => {
      this.socket!.once('match-found', (data: MatchFoundEvent) => {
        resolve(data);
      });
    });
  }

  /**
   * Wait for countdown to complete
   */
  async waitForCountdown(
    onCountdown?: (event: CountdownEvent) => void
  ): Promise<void> {
    this.ensureConnected();

    return new Promise((resolve) => {
      const countdownHandler = (data: CountdownEvent) => {
        this.callbacks.onCountdown(data);
        onCountdown?.(data);

        if (data.seconds === 0) {
          this.socket?.off('countdown', countdownHandler);
          resolve();
        }
      };

      this.socket!.on('countdown', countdownHandler);
    });
  }

  /**
   * Wait for game start event
   */
  async waitForGameStart(): Promise<GameStartEvent> {
    this.ensureConnected();

    return new Promise((resolve) => {
      this.socket!.once('game-start', (data: GameStartEvent) => {
        resolve(data);
      });
    });
  }

  // ============================================
  // COMMANDS
  // ============================================

  /**
   * Submit commands with acknowledgment
   */
  async submitCommands(
    tick: number,
    commands: PlayerCommand[]
  ): Promise<SubmitCommandsAck> {
    this.ensureConnected();

    return new Promise((resolve) => {
      this.socket!.once('submit-commands-ack', (ack: SubmitCommandsAck) => {
        resolve(ack);
      });

      this.socket!.emit('submit-commands', { tick, commands });
    });
  }

  /**
   * Submit commands without acknowledgment (fire and forget)
   */
  submitCommandsAsync(tick: number, commands: PlayerCommand[]): void {
    this.ensureConnected();
    this.socket!.emit('submit-commands', { tick, commands });
  }

  /**
   * Send state hash for desync detection
   * @param tick - The tick this hash is for
   * @param hash - The state hash string
   */
  sendStateHash(tick: number, hash: string): void {
    this.ensureConnected();
    this.socket!.emit('state-hash', { tick, hash });
  }

  /**
   * Send a pause-game request to the server (fire-and-forget)
   */
  sendPauseGame(): void {
    this.ensureConnected();
    this.socket!.emit('pause-game');
  }

  /**
   * Send a resume-game request to the server (fire-and-forget)
   */
  sendResumeGame(): void {
    this.ensureConnected();
    this.socket!.emit('resume-game');
  }

  /**
   * Notify the server that this client has finished loading and is ready to receive ticks.
   */
  sendReady(): void {
    this.ensureConnected();
    this.socket!.emit('client-ready');
  }

  // ============================================
  // RECONNECTION
  // ============================================

  /**
   * Reconnect to a specific match
   */
  async reconnectToMatch(matchId: string): Promise<ReconnectStateEvent> {
    this.ensureConnected();

    return new Promise((resolve, reject) => {
      const statusHandler = (status: ReconnectStatusEvent) => {
        this.callbacks.onReconnectStatus(status);
        if (!status.success) {
          this.socket?.off('reconnect-state', stateHandler);
          reject(new Error(status.reason || 'Reconnection failed'));
        }
      };

      const stateHandler = (state: ReconnectStateEvent) => {
        this.socket?.off('reconnect-status', statusHandler);
        // Do NOT invoke `callbacks.onReconnectState` here — the global
        // `reconnect-state` handler registered in `setupEventHandlers`
        // already fires for this same message. Calling it twice would
        // drive downstream state updates (and any synthetic countdown /
        // game-start replays) through the client twice per server event.
        resolve(state);
      };

      this.socket!.once('reconnect-status', statusHandler);
      this.socket!.once('reconnect-state', stateHandler);

      this.socket!.emit('reconnect-match', {
        playerId: this.config.playerId,
        matchId,
      });
    });
  }

  /**
   * Attempt automatic reconnection with retries
   */
  async attemptReconnection(): Promise<void> {
    if (!this.config.autoReconnect) {
      throw new Error('Auto-reconnect is disabled');
    }

    const savedMatchId = this.callbacks.getCurrentMatchId();
    this.connectionState = 'reconnecting';

    while (this.reconnectAttempts < this.config.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.callbacks.onReconnecting(this.reconnectAttempts);

      try {
        await this.delay(this.config.reconnectDelayMs);
        await this.connect();

        if (savedMatchId) {
          await this.reconnectToMatch(savedMatchId);
        }

        return;
      } catch {
        // Continue to next attempt
      }
    }

    this.callbacks.onReconnectFailed();
    throw new Error('Max reconnection attempts reached');
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private setupEventHandlers(): void {
    if (!this.socket) return;

    if (this.config.debug) {    }

    // Match found
    this.socket.on('match-found', (data: MatchFoundEvent) => {
      if (this.config.debug) {      }
      this.callbacks.onMatchFound(data);
    });

    // Game start
    this.socket.on('game-start', (data: GameStartEvent) => {
      if (this.config.debug) {      }
      this.callbacks.onGameStart(data);
    });

    // Countdown
    this.socket.on('countdown', (data: CountdownEvent) => {
      if (this.config.debug) {      }
      this.callbacks.onCountdown(data);
    });

    // Tick synchronization
    this.socket.on('tick-sync', (data: TickSyncEvent) => {
      this.callbacks.onTickSync(data);
    });

    // Commands batch
    this.socket.on('commands-batch', (data: CommandsBatchEvent) => {
      this.callbacks.onCommandsBatch(data);
    });

    // Player events
    this.socket.on('player-disconnected', (data: PlayerDisconnectedEvent) => {
      this.callbacks.onPlayerDisconnected(data);
    });

    this.socket.on('player-reconnected', (data: PlayerReconnectedEvent) => {
      this.callbacks.onPlayerReconnected(data);
    });

    this.socket.on('player-ready', (data: PlayerReadyEvent) => {
      this.callbacks.onPlayerReady(data);
    });

    // Match end
    this.socket.on('match-end', (data: MatchEndEvent) => {
      this.callbacks.onMatchEnd(data);
    });

    // Reconnect-state — unlike `reconnectToMatch` which attaches a
    // one-shot listener for the explicit reconnect flow, this global
    // handler catches snapshots delivered out-of-band, e.g. by the
    // private-room host-recover path where the client initiates
    // `room-recover` and the server proactively emits reconnect-state
    // to wire the socket back into a match that started while the host
    // was offline.
    //
    // When the snapshot reports an in-flight countdown or an already
    // emitted `game-start`, we fan it out through the same `countdown`
    // / `game-start` callbacks the normal lifecycle uses, so client
    // code that blocks on `waitForCountdown` / `waitForGameStart`
    // wakes up instead of hanging forever waiting for events that
    // were broadcast while the socket was dead.
    this.socket.on('reconnect-state', (data: ReconnectStateEvent) => {
      this.callbacks.onReconnectState(data);
      // Fan the snapshot out through the same socket event bus that
      // `setupEventHandlers` and `waitForCountdown`/`waitForGameStart`
      // listen on. Using `socket.emit` against the local socket would
      // send to the server, not the local listeners — socket.io-client
      // has no public "emit-to-self", so we replay through every
      // registered listener instead. This wakes callers blocked in
      // `waitForCountdown` / `waitForGameStart` on top of firing the
      // normal callback hooks.
      if (
        typeof data.countdownSecondsRemaining === 'number' &&
        data.countdownSecondsRemaining >= 0
      ) {
        this.emitSyntheticLocal('countdown', {
          seconds: data.countdownSecondsRemaining,
        } satisfies CountdownEvent);
      }
      // Only synthesize `game-start` when the snapshot shows the client
      // is still in a pre-play phase. For an in-progress match (state
      // `playing` / `paused` / `finished`) the caller is doing a normal
      // mid-match reconnect, and PhalanxClient's `onGameStart` callback
      // would reset `currentTick` to 0 — clobbering the authoritative
      // tick that `onReconnectState` just applied. In that case the
      // client is already past the game-start transition, so there's
      // nothing to replay.
      if (
        data.gameStartEmitted === true &&
        (data.state === 'countdown' || data.state === 'waiting-for-ready')
      ) {
        const gameStart: GameStartEvent = {
          matchId: data.matchId,
          ...(typeof data.randomSeed === 'number'
            ? { randomSeed: data.randomSeed }
            : {}),
        };
        this.emitSyntheticLocal('game-start', gameStart);
      }
    });

    // Hash comparison (for desync detection)
    this.socket.on('hash-comparison', (data: HashComparisonEvent) => {
      this.callbacks.onHashComparison(data);
    });

    // Pause events
    this.socket.on('game-paused', (data: GamePausedEvent) => {
      this.callbacks.onGamePaused(data);
    });

    this.socket.on('game-resumed', (data: GameResumedEvent) => {
      this.callbacks.onGameResumed(data);
    });

    // Private room events
    this.socket.on('room-error', (data: RoomErrorEvent) => {
      this.callbacks.onRoomError(data);
    });

    this.socket.on('room-expired', (data: RoomExpiredEvent) => {
      this.callbacks.onRoomExpired(data);
    });

    this.socket.on('room-cancelled', (data: RoomCancelledEvent) => {
      this.callbacks.onRoomCancelled(data);
    });

    this.socket.on('room-recovered', (data: RoomRecoveredEvent) => {
      this.callbacks.onRoomRecovered(data);
    });

    // Disconnection handling
    this.socket.on('disconnect', () => {
      const wasPlaying = this.callbacks.isPlaying();
      this.connectionState = 'disconnected';
      this.callbacks.onDisconnected();

      if (wasPlaying && this.config.autoReconnect) {
        this.attemptReconnection().catch(() => {
          // Reconnection failed, already emitted reconnectFailed event
        });
      }
    });

    // Error handling
    this.socket.on('error', (error: PhalanxError) => {
      this.callbacks.onError(error);
    });
  }

  private ensureConnected(): void {
    if (!this.socket || !this.isConnected()) {
      throw new Error('Not connected to server. Call connect() first.');
    }
  }


  /**
   * Replay `payload` through every listener currently registered for
   * `event` on the local socket.
   *
   * socket.io-client's `socket.emit` sends to the server, so there is
   * no public API to dispatch a server→client event against the
   * client's own handlers. For the private-room recover path we need
   * exactly that: the server already decided that, e.g., countdown
   * should show "3", and we want every listener the application has
   * wired up — including one-shot promises inside `waitForCountdown`
   * / `waitForGameStart` — to observe the value as if the server had
   * broadcast it on the wire.
   *
   * Iterating a snapshot of `socket.listeners(event)` (rather than
   * the live list) is deliberate: a listener may call `socket.off`
   * on itself during handling (e.g. `waitForCountdown`'s handler
   * unsubscribes on `seconds === 0`), which would mutate the array
   * under us and skip siblings.
   */
  private emitSyntheticLocal(event: string, payload: unknown): void {
    if (!this.socket) return;
    const listeners = this.socket.listeners(event).slice();
    for (const listener of listeners) {
      try {
        (listener as (data: unknown) => void)(payload);
      } catch (err) {
        if (this.config.debug) {
          console.error(
            `[SocketManager] synthetic "${event}" listener threw:`,
            err,
          );
        }
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
