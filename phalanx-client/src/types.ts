/**
 * Phalanx Client Types
 * Types for the client-side library
 */

import type { DesyncEvent } from './DesyncDetector.js';

// Re-export DesyncEvent for convenience
export type { DesyncEvent };

/**
 * Configuration for pause/resume behavior
 */
export interface PauseConfig {
  /**
   * Maximum number of pauses allowed per player.
   * Set to Infinity for unlimited pauses.
   * @default Infinity
   */
  maxPausesPerPlayer: number;

  /**
   * Whether the game can only be resumed by the same player who paused it.
   * If false, any player can resume the game.
   * @default false
   */
  requireSamePlayerToResume: boolean;
}

/**
 * Configuration for the Phalanx client
 */
export interface PhalanxClientConfig {
  /**
   * URL of the Phalanx server (e.g., 'http://localhost:3000')
   */
  serverUrl: string;

  /**
   * Unique identifier for this player.
   * If auth is enabled and user signs in, this will be overwritten with the auth user ID.
   */
  playerId?: string;

  /**
   * Display name for this player.
   * If auth is enabled and user signs in, this will be overwritten with the auth username.
   */
  username?: string;

  /**
   * Authentication token (e.g., Google ID token).
   * Required if server has authentication enabled.
   * If using built-in auth, this is managed automatically.
   */
  authToken?: string;

  /**
   * Authentication configuration.
   * If provided, the client will manage authentication internally.
   */
  auth?: PhalanxAuthConfig;

  /**
   * Whether to automatically attempt reconnection after disconnection
   * @default true
   */
  autoReconnect?: boolean;

  /**
   * Maximum number of reconnection attempts
   * @default 5
   */
  maxReconnectAttempts?: number;

  /**
   * Delay between reconnection attempts in milliseconds
   * @default 1000
   */
  reconnectDelayMs?: number;

  /**
   * Connection timeout in milliseconds
   * @default 10000
   */
  connectionTimeoutMs?: number;

  /**
   * Tick rate (ticks per second) - should match server configuration
   * @default 20
   */
  tickRate?: number;

  /**
   * Pause/resume behavior configuration.
   * Should match server configuration for proper validation.
   */
  pause?: Partial<PauseConfig>;

  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean;
}

/**
 * Authentication configuration for PhalanxClient
 */
export interface PhalanxAuthConfig {
  /**
   * OAuth provider to use
   */
  provider: 'google';

  /**
   * Google OAuth configuration
   */
  google?: {
    /**
     * Google OAuth Client ID
     */
    clientId: string;

    /**
     * OAuth scopes (default: ['openid', 'profile', 'email'])
     */
    scopes?: string[];

    /**
     * Redirect URI after auth (default: window.location.origin)
     */
    redirectUri?: string;

    /**
     * Backend endpoint URL for token exchange.
     * Required for secure token exchange with client_secret on server.
     */
    tokenExchangeUrl?: string;
  };
}

/**
 * A command sent from or to players
 * When received from server, includes playerId and tick added by server
 */
export interface PlayerCommand {
  type: string;
  data: unknown;
  /** Added by server when broadcasting - identifies the player who sent the command */
  playerId?: string;
  /** Added by server when broadcasting - the tick this command was submitted for */
  tick?: number;
}

/**
 * Information about a player in match-found event
 */
export interface MatchPlayerInfo {
  playerId: string;
  username: string;
}

/**
 * Event received when a match is found
 */
export interface MatchFoundEvent {
  matchId: string;
  playerId: string;
  teamId: number;
  teammates: MatchPlayerInfo[];
  opponents: MatchPlayerInfo[];
}

/**
 * Event received during countdown before game starts
 */
export interface CountdownEvent {
  seconds: number;
}

/**
 * Event received when the game starts
 */
export interface GameStartEvent {
  matchId: string;
  /** Random seed for deterministic RNG (optional for backward compatibility) */
  randomSeed?: number;
}

/**
 * Event received on each tick for synchronization
 */
export interface TickSyncEvent {
  tick: number;
  timestamp: number;
}

/**
 * Commands batch received each tick from the server
 */
export interface CommandsBatchEvent {
  tick: number;
  commands: PlayerCommand[];
}

/**
 * Queue status event received after joining queue
 */
export interface QueueStatusEvent {
  position: number;
  waitTime: number;
}

/**
 * Event received when another player disconnects
 */
export interface PlayerDisconnectedEvent {
  playerId: string;
  gracePeriodMs: number;
}

/**
 * Event received when another player reconnects
 */
export interface PlayerReconnectedEvent {
  playerId: string;
}

/**
 * Event received when a player reports ready during the loading phase
 */
export interface PlayerReadyEvent {
  playerId: string;
}

/**
 * State received when reconnecting to a match
 */
export interface ReconnectStateEvent {
  matchId: string;
  currentTick: number;
  state: 'countdown' | 'waiting-for-ready' | 'playing' | 'paused' | 'finished';
  recentCommands: TickCommandsHistory[];
}

/**
 * Commands history for a specific tick (used in reconnection)
 */
export interface TickCommandsHistory {
  tick: number;
  commands: PlayerCommand[];
}

/**
 * Reconnection status response
 */
export interface ReconnectStatusEvent {
  success: boolean;
  reason?: string;
}

/**
 * Acknowledgment for submitted commands
 */
export interface SubmitCommandsAck {
  accepted: boolean;
  reason?: string;
}

/**
 * Event received when match ends
 */
export interface MatchEndEvent {
  reason: string;
  /** Additional details about the match end (e.g., desync info) */
  details?: unknown;
  /** Winner information (null on desync) */
  winner?: string | null;
}

/**
 * Event received when the game is paused
 */
export interface GamePausedEvent {
  requestedBy: string;
  lastTick: number;
}

/**
 * Event received when the game is resumed
 */
export interface GameResumedEvent {
  requestedBy: string;
}

/**
 * Hash comparison data received from server
 */
export interface HashComparisonEvent {
  tick: number;
  hashes: Record<string, string>;
}

/**
 * Error event from the server
 */
export interface PhalanxError {
  message: string;
  code?: string;
}

/**
 * Connection state of the client
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

/**
 * Client state (overall lifecycle)
 */
export type ClientState =
  | 'idle'
  | 'in-queue'
  | 'match-found'
  | 'countdown'
  | 'playing'
  | 'paused'
  | 'reconnecting'
  | 'finished';

/**
 * Commands grouped by player ID (for easier processing in game logic)
 */
export interface CommandsBatch {
  tick: number;
  commands: {
    [playerId: string]: PlayerCommand[];
  };
}

/**
 * Tick handler callback type
 */
export type TickHandler = (tick: number, commands: CommandsBatch) => void;

/**
 * Frame handler callback type
 */
export type FrameHandler = (alpha: number, dt: number) => void;

/**
 * Unsubscribe function type
 */
export type Unsubscribe = () => void;

/**
 * Pause/Resume handler callback type
 */
export type PauseHandler = () => void;

/**
 * Auth user information
 */
export interface PhalanxAuthUser {
  id: string;
  username?: string;
  email?: string;
  avatarUrl?: string;
  provider: string;
}

/**
 * Auth state
 */
export interface PhalanxAuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: PhalanxAuthUser | null;
  error?: string;
}

/**
 * Events emitted by PhalanxClient
 */
export interface PhalanxClientEvents {
  // Connection events
  connected: () => void;
  disconnected: () => void;
  reconnecting: (attempt: number) => void;
  reconnectFailed: () => void;
  error: (error: PhalanxError) => void;

  // Auth events
  authStateChanged: (state: PhalanxAuthState) => void;
  authError: (error: PhalanxError) => void;

  // Queue events
  queueJoined: (status: QueueStatusEvent) => void;
  queueLeft: () => void;
  queueError: (error: PhalanxError) => void;

  // Match events
  matchFound: (event: MatchFoundEvent) => void;
  countdown: (event: CountdownEvent) => void;
  gameStart: (event: GameStartEvent) => void;
  matchEnd: (event: MatchEndEvent) => void;

  // Pause events
  gamePaused: (event: GamePausedEvent) => void;
  gameResumed: (event: GameResumedEvent) => void;

  // Tick events
  tick: (event: TickSyncEvent) => void;
  commands: (event: CommandsBatchEvent) => void;

  // Player events
  playerDisconnected: (event: PlayerDisconnectedEvent) => void;
  playerReconnected: (event: PlayerReconnectedEvent) => void;
  playerReady: (event: PlayerReadyEvent) => void;

  // Reconnection events
  reconnectState: (event: ReconnectStateEvent) => void;
  reconnectStatus: (event: ReconnectStatusEvent) => void;

  // Desync detection events
  desync: (event: DesyncEvent) => void;
}
