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
import { MatchLogError, MatchResumeRejected } from './types.js';
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
  SubmittedCommand,
  SocketTransport,
  MatchLogChunkEvent,
  MatchLogErrorEvent,
  ServerShutdownEvent,
  MatchResumeState,
  MatchResumeErrorReason,
  SessionSupersededEvent,
  SessionTokenEvent,
  MatchSnapshot,
  MatchSnapshotRequest,
  ServerDesyncEvent,
} from './types.js';
import type {
  MatchLogCancelRequest,
  MatchLogRequest,
  StateHashEvent,
  SubmitCommandsEvent,
} from '@phalanx-engine/protocol';

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
  /**
   * Sent on queue-join / room-create / room-join when set.
   * Absent from the payload otherwise.
   */
  buildId?: string;
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
  /**
   * When true, the server refuses `reconnect-match`. A resume timeout
   * must not call it. Omitted means unknown, and the legacy rebind
   * still runs.
   */
  requireSessionToken?: boolean;
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

  /** Optional so existing callers do not have to supply it. */
  onServerShutdown?: (data: ServerShutdownEvent) => void;

  /** Optional so existing callers do not have to supply it. */
  onSessionToken?: (data: SessionTokenEvent) => void;

  /** Optional so existing callers do not have to supply it. */
  onSessionSuperseded?: (data: SessionSupersededEvent) => void;

  /** Optional so existing callers do not have to supply it. */
  onServerDesync?: (data: ServerDesyncEvent) => void;

  // State queries (for reconnection logic)
  isPlaying: () => boolean;
  getCurrentMatchId: () => string | null;
  /**
   * Session saved for `gameId`, or `null`. Optional so callers that
   * never persist a token keep the legacy `reconnectToMatch` path.
   */
  loadMatchSession?: () => { token: string; matchId: string } | null;
  /** Last tick the client has already applied. Sent as `haveTick`. */
  getLastTick?: () => number;
  /** Drop the stored session after a final reconnection failure. */
  clearMatchSession?: () => void;
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
  /** The one match-log read allowed on this socket. A new read aborts it. */
  private activeMatchLog: { abort: () => void } | null = null;
  private matchLogRequestSeq = 0;
  private snapshotRequestSeq = 0;
  private readonly snapshotWaiters: SnapshotWaiter[] = [];

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
    this.rejectSnapshotWaiters('disconnected');
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
  updateCredentials(
    playerId: string,
    username: string,
    authToken?: string
  ): void {
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
        ...buildIdField(this.config.buildId),
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
        ...buildIdField(this.config.buildId),
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
      ...buildIdField(this.config.buildId),
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
    timeoutMs: number = this.config.recoverRoomTimeoutMs
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
    commands: SubmittedCommand[]
  ): Promise<SubmitCommandsAck> {
    this.ensureConnected();

    return new Promise((resolve) => {
      this.socket!.once('submit-commands-ack', (ack: SubmitCommandsAck) => {
        resolve(ack);
      });

      this.socket!.emit('submit-commands', {
        tick,
        commands,
      } satisfies SubmitCommandsEvent);
    });
  }

  /**
   * Submit commands without acknowledgment (fire and forget)
   */
  submitCommandsAsync(tick: number, commands: SubmittedCommand[]): void {
    this.ensureConnected();
    this.socket!.emit('submit-commands', {
      tick,
      commands,
    } satisfies SubmitCommandsEvent);
  }

  /**
   * Send state hash for desync detection
   * @param tick - The tick this hash is for
   * @param hash - The state hash string
   */
  sendStateHash(tick: number, hash: string): void {
    this.ensureConnected();
    this.socket!.emit('state-hash', { tick, hash } satisfies StateHashEvent);
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
   * Ask the server simulation for its latest snapshot. Sends
   * `match-snapshot-request` with a new `requestId` (1, 2, ...). The
   * server answers at most once per second with the latest id, so a
   * `match-snapshot` resolves every waiter whose id is not above the
   * delivered one. Rejects when not connected, on disconnect and on
   * `match-end`.
   */
  requestMatchSnapshot(): Promise<MatchSnapshot> {
    if (!this.socket || !this.isConnected()) {
      return Promise.reject(
        new Error('Not connected to server. Call connect() first.')
      );
    }
    this.snapshotRequestSeq += 1;
    const requestId = this.snapshotRequestSeq;
    const promise = new Promise<MatchSnapshot>((resolve, reject) => {
      this.snapshotWaiters.push({ requestId, resolve, reject });
    });
    this.socket.emit('match-snapshot-request', {
      requestId,
    } satisfies MatchSnapshotRequest);
    return promise;
  }

  private onMatchSnapshot(data: MatchSnapshot): void {
    if (
      typeof data?.tick !== 'number' ||
      typeof data.requestId !== 'number' ||
      typeof data.bytes !== 'object' ||
      data.bytes === null
    ) {
      return;
    }
    const snapshot: MatchSnapshot = {
      tick: data.tick,
      requestId: data.requestId,
      bytes: toUint8Array(data.bytes),
    };
    const remaining = this.snapshotWaiters.filter(
      (waiter) => waiter.requestId > snapshot.requestId
    );
    const due = this.snapshotWaiters.filter(
      (waiter) => waiter.requestId <= snapshot.requestId
    );
    this.snapshotWaiters.splice(0, this.snapshotWaiters.length, ...remaining);
    for (const waiter of due) waiter.resolve(snapshot);
  }

  private rejectSnapshotWaiters(reason: string): void {
    const waiters = this.snapshotWaiters.splice(0);
    for (const waiter of waiters) {
      waiter.reject(new Error(`match snapshot request failed: ${reason}`));
    }
  }

  /**
   * Notify the server that this client has finished loading and is ready to receive ticks.
   */
  sendReady(): void {
    this.ensureConnected();
    this.socket!.emit('client-ready');
  }

  /**
   * Read the command log of `matchId` from `fromTick`.
   * Chunks arrive one at a time; the iterator yields the event loop
   * between them. `break` cancels the server stream and removes the
   * socket listeners. No timer is left pending after the iterator
   * stops. A second call aborts the read already in flight on this
   * socket; chunks are matched by `requestId`, so the two streams
   * cannot mix.
   */
  fetchMatchLog(
    matchId: string,
    fromTick: number,
    maxTicks?: number
  ): AsyncIterable<MatchLogChunkEvent> {
    this.ensureConnected();
    const socket = this.socket!;
    this.matchLogRequestSeq += 1;
    const requestId = String(this.matchLogRequestSeq);

    this.activeMatchLog?.abort();

    const pending: MatchLogChunkEvent[] = [];
    let waiter: {
      resolve: (chunk: MatchLogChunkEvent) => void;
      reject: (error: Error) => void;
    } | null = null;
    const logState: { error: MatchLogError | null } = { error: null };
    let yieldTimer: ReturnType<typeof setTimeout> | null = null;
    let completed = false;
    let started = false;
    let cancelSent = false;

    const fail = (error: MatchLogError): void => {
      logState.error = error;
      if (waiter) {
        const current = waiter;
        waiter = null;
        current.reject(error);
      }
    };

    const session = {
      abort: () => {
        pending.length = 0;
        fail(new MatchLogError('aborted'));
      },
    };
    this.activeMatchLog = session;
    const release = (): void => {
      if (this.activeMatchLog === session) this.activeMatchLog = null;
    };
    const takeWaiter = (): {
      resolve: (chunk: MatchLogChunkEvent) => void;
      reject: (error: Error) => void;
    } | null => {
      const current = waiter;
      waiter = null;
      return current;
    };

    const onChunk = (chunk: MatchLogChunkEvent): void => {
      if (chunk.requestId !== requestId) return;
      if (chunk.matchId !== matchId) return;
      if (waiter) {
        const current = waiter;
        waiter = null;
        current.resolve(chunk);
      } else {
        pending.push(chunk);
      }
    };

    const onError = (payload: MatchLogErrorEvent): void => {
      if (payload.requestId !== undefined && payload.requestId !== requestId) {
        return;
      }
      if (payload.matchId !== undefined && payload.matchId !== matchId) {
        return;
      }
      fail(new MatchLogError(payload.reason));
    };

    const onDisconnect = (): void => {
      fail(new MatchLogError('disconnected'));
    };

    const yieldEventLoop = (): Promise<void> =>
      new Promise((resolve) => {
        yieldTimer = setTimeout(() => {
          yieldTimer = null;
          resolve();
        }, 0);
      });

    const generator = (async function* (): AsyncGenerator<MatchLogChunkEvent> {
      try {
        const initialError = logState.error;
        if (initialError !== null) {
          throw new MatchLogError(initialError.reason);
        }
        started = true;
        socket.on('match-log-chunk', onChunk);
        socket.on('match-log-error', onError);
        socket.on('disconnect', onDisconnect);
        socket.emit('match-log', {
          matchId,
          fromTick,
          requestId,
          ...(maxTicks !== undefined ? { maxTicks } : {}),
        } satisfies MatchLogRequest);

        let first = true;
        while (true) {
          if (!first) {
            await yieldEventLoop();
          }
          first = false;

          const pendingError = logState.error;
          if (pending.length === 0 && pendingError !== null) {
            throw new MatchLogError(pendingError.reason);
          }

          const chunk =
            pending.length > 0
              ? pending.shift()!
              : await new Promise<MatchLogChunkEvent>((resolve, reject) => {
                  const queued = logState.error;
                  if (queued !== null) {
                    reject(queued);
                    return;
                  }
                  waiter = { resolve, reject };
                });

          yield chunk;
          if (chunk.done) {
            completed = true;
            return;
          }
        }
      } finally {
        if (yieldTimer !== null) {
          clearTimeout(yieldTimer);
          yieldTimer = null;
        }
        const pendingWait = takeWaiter();
        if (pendingWait) {
          pendingWait.reject(new MatchLogError('aborted'));
        }
        if (started && !completed && !cancelSent && socket.connected) {
          cancelSent = true;
          socket.emit('match-log-cancel', {
            requestId,
          } satisfies MatchLogCancelRequest);
        }
        if (started) {
          socket.off('match-log-chunk', onChunk);
          socket.off('match-log-error', onError);
          socket.off('disconnect', onDisconnect);
        }
        release();
      }
    })();

    return {
      [Symbol.asyncIterator](): AsyncIterator<MatchLogChunkEvent> {
        return {
          next: () => generator.next(),
          throw: (error: unknown) => generator.throw(error),
          return: () => {
            session.abort();
            return generator.return(undefined);
          },
        };
      },
    };
  }

  // ============================================
  // RECONNECTION
  // ============================================

  /**
   * Resume a match with a session token.
   * `buildId` is included only when this client was configured with one.
   * Resolves on `match-resume-state`. The same `reconnect-state` handler
   * that `reconnectToMatch` relies on puts the client back into the match.
   * Rejects `MatchResumeRejected` on `match-resume-error` or when
   * `connectionTimeoutMs` elapses. That timeout is the same budget as
   * `connect()`.
   */
  async resumeMatch(
    token: string,
    haveTick: number
  ): Promise<MatchResumeState> {
    this.ensureConnected();
    const socket = this.socket;
    if (!socket) {
      throw new Error('Not connected to server. Call connect() first.');
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        finish(() => reject(new MatchResumeRejected('timeout')));
      }, this.config.connectionTimeoutMs);

      const onState = (state: MatchResumeState) => {
        finish(() => resolve(state));
      };
      const onError = (event: { reason?: unknown }) => {
        const reason = isMatchResumeWireReason(event?.reason)
          ? event.reason
          : 'invalid';
        finish(() => reject(new MatchResumeRejected(reason)));
      };

      const finish = (settle: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.off('match-resume-state', onState);
        socket.off('match-resume-error', onError);
        settle();
      };

      socket.on('match-resume-state', onState);
      socket.on('match-resume-error', onError);
      socket.emit('match-resume', {
        token,
        haveTick,
        ...buildIdField(this.config.buildId),
      });
    });
  }

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
          await this.rejoinSavedMatch(savedMatchId);
        }

        return;
      } catch {
        // Continue to next attempt
      }
    }

    this.callbacks.clearMatchSession?.();
    this.callbacks.onReconnectFailed();
    throw new Error('Max reconnection attempts reached');
  }

  /**
   * Prefer the stored token for this match. `reconnectToMatch` runs
   * only when that resume does not bind the socket. A terminal
   * refusal drops the token before the legacy attempt; a timeout
   * keeps it so a later attempt can try the token again.
   * When `requireSessionToken` is known to be on, a timeout does not
   * call `reconnectToMatch`: that server always refuses it.
   */
  private async rejoinSavedMatch(matchId: string): Promise<void> {
    const session = this.callbacks.loadMatchSession?.() ?? null;
    if (session && session.matchId === matchId) {
      const lastTick = this.callbacks.getLastTick?.() ?? -1;
      try {
        await this.resumeMatch(session.token, lastTick);
        return;
      } catch (error) {
        if (isTerminalResumeRejection(error)) {
          this.callbacks.clearMatchSession?.();
        } else if (
          this.config.requireSessionToken === true &&
          isResumeTimeout(error)
        ) {
          throw error;
        }
      }
    }
    await this.reconnectToMatch(matchId);
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private setupEventHandlers(): void {
    if (!this.socket) return;

    if (this.config.debug) {
    }

    // Match found
    this.socket.on('match-found', (data: MatchFoundEvent) => {
      if (this.config.debug) {
      }
      this.callbacks.onMatchFound(data);
    });

    // Game start
    this.socket.on('game-start', (data: GameStartEvent) => {
      if (this.config.debug) {
      }
      this.callbacks.onGameStart(data);
    });

    // Countdown
    this.socket.on('countdown', (data: CountdownEvent) => {
      if (this.config.debug) {
      }
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
      this.rejectSnapshotWaiters('match-end');
      this.callbacks.onMatchEnd(data);
    });

    this.socket.on('server-shutdown', (data: ServerShutdownEvent) => {
      this.callbacks.onServerShutdown?.(data);
    });

    this.socket.on('session-token', (data: SessionTokenEvent) => {
      this.callbacks.onSessionToken?.(data);
    });

    this.socket.on('session-superseded', (data: SessionSupersededEvent) => {
      this.callbacks.onSessionSuperseded?.(data);
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

    // Server simulation
    this.socket.on('desync', (data: ServerDesyncEvent) => {
      this.callbacks.onServerDesync?.(data);
    });

    this.socket.on('match-snapshot', (data: MatchSnapshot) => {
      this.onMatchSnapshot(data);
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
      this.rejectSnapshotWaiters('disconnected');
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
            err
          );
        }
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

const MATCH_RESUME_WIRE_REASONS: readonly MatchResumeErrorReason[] = [
  'invalid',
  'expired',
  'match-ended',
  'build-mismatch',
];

function isMatchResumeWireReason(
  value: unknown
): value is MatchResumeErrorReason {
  return (
    typeof value === 'string' &&
    (MATCH_RESUME_WIRE_REASONS as readonly string[]).includes(value)
  );
}

function isTerminalResumeRejection(
  error: unknown
): error is MatchResumeRejected {
  return (
    error instanceof MatchResumeRejected &&
    isMatchResumeWireReason(error.reason)
  );
}

function isResumeTimeout(error: unknown): error is MatchResumeRejected {
  return error instanceof MatchResumeRejected && error.reason === 'timeout';
}

/** `buildId` is included only when the config actually set one. */
function buildIdField(
  buildId: string | undefined
): { buildId: string } | Record<string, never> {
  if (buildId === undefined) return {};
  return { buildId };
}

interface SnapshotWaiter {
  readonly requestId: number;
  readonly resolve: (snapshot: MatchSnapshot) => void;
  readonly reject: (error: Error) => void;
}

/** socket.io delivers binary as a Node `Buffer` or a browser `ArrayBuffer`. */
function toUint8Array(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  const view =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.slice();
}
