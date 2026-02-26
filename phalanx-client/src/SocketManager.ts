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
  PlayerDisconnectedEvent,
  PlayerReconnectedEvent,
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

  // Reconnection events
  onReconnectState: (data: ReconnectStateEvent) => void;
  onReconnectStatus: (data: ReconnectStatusEvent) => void;

  // Desync detection events
  onHashComparison: (data: HashComparisonEvent) => void;

  // Pause events
  onGamePaused: (data: GamePausedEvent) => void;
  onGameResumed: (data: GameResumedEvent) => void;

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
  async joinQueue(): Promise<QueueStatusEvent> {
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
        this.callbacks.onReconnectState(state);
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

    // Match end
    this.socket.on('match-end', (data: MatchEndEvent) => {
      this.callbacks.onMatchEnd(data);
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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
