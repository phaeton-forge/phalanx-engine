/**
 * Phalanx Client Types
 * Types for the client-side library
 */

import type { DesyncEvent } from './DesyncDetector.js';
import type {
  RoomRecoveryStatusEvent,
  RoomTerminatedEvent,
} from './recovery/RoomRecoveryController.js';
import type { KeyValueStorage } from './recovery/KeyValueStorage.js';
import type { RecoverTimeoutBudget } from './recovery/NetworkQuality.js';

// Re-export DesyncEvent for convenience
export type { DesyncEvent };
export type { RoomRecoveryStatusEvent, RoomTerminatedEvent } from './recovery/RoomRecoveryController.js';

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

/** Socket.IO transport names supported by PhalanxClient. */
export type SocketTransport = 'polling' | 'websocket';

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
   * Timeout for private-room recovery acknowledgements in milliseconds.
   * @default 10000
   */
  recoverRoomTimeoutMs?: number;

  /**
   * Socket.IO transports to use when connecting.
   * Defaults to WebSocket-only for existing desktop behavior. Mobile
   * clients can pass ['polling', 'websocket'] for a more resilient fallback.
   * @default ['websocket']
   */
  socketTransports?: readonly SocketTransport[];

  /**
   * If true, automatically pick `['polling']` on mobile UAs and
   * `['websocket']` on desktop. Ignored when `socketTransports` is
   * also set explicitly. Opt-in to avoid silently regressing games
   * that intentionally pin a specific transport.
   * @default false
   */
  mobileFriendlyTransports?: boolean;

  /**
   * Persist a stable guest playerId across page reloads so private-room
   * recovery can survive a hard reload. When `true`, uses the default
   * key `phalanx:guestPlayerId:v1`. When a string, uses that as the key.
   * Authenticated users override this with the auth user id, so this is
   * primarily a guest-mode quality-of-life flag.
   * @default false
   */
  persistGuestPlayerId?: boolean | string;

  /**
   * Configure mobile-friendly room recovery (visibilitychange/pageshow
   * listeners, exponential backoff, room persistence, pre-game stall
   * watchdog). When omitted recovery is disabled and the controller is
   * not constructed.
   */
  roomRecovery?: PhalanxRoomRecoveryConfig;

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
 * Configuration for the optional mobile-friendly room recovery layer.
 * See `RoomRecoveryController` for behavior. Leave unset to disable.
 */
export interface PhalanxRoomRecoveryConfig {
  /** Master enable flag. When false the controller is not created. */
  enabled: boolean;
  /**
   * localStorage key for the persisted active-room record.
   * @default 'phalanx:activeRoom:v1'
   */
  storageKey?: string;
  /**
   * Local TTL mirroring the server's RoomService.ROOM_TTL_MS.
   * @default 5 * 60 * 1000
   */
  roomTtlMs?: number;
  /**
   * Storage adapter. Defaults to `localStorage` (with a memory fallback
   * when the DOM is unavailable). React Native / Capacitor host apps can
   * supply a custom synchronous wrapper around their native storage.
   */
  storage?: KeyValueStorage;
  /** Per-quality recover-room ack timeout budget. */
  recoverTimeoutBudget?: RecoverTimeoutBudget;
  /** Max backoff retries before emitting `gave-up`. @default 5 */
  maxRecoverAttempts?: number;
  /** Auto-arm the pre-game stall watchdog. @default true */
  preGameStallWatchdog?: boolean;
  /** Pre-game stall budget in ms. @default 4500 */
  preGameStallMs?: number;
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
 * State received when reconnecting to a match.
 *
 * Includes a snapshot of the countdown / game-start phase so a client
 * that reconnected mid-countdown (e.g. a private-room host whose mobile
 * browser killed the WebSocket while they were sharing the invite link)
 * can render the correct remaining number without waiting for the next
 * 1Hz broadcast tick, and so a client that reconnected after `game-start`
 * already fired can synthesize the event locally and enter the playing
 * phase without waiting for an event it will never receive again.
 *
 * The countdown/gameStart fields are optional for wire-compatibility
 * with older servers that don't populate them.
 */
export interface ReconnectStateEvent {
  matchId: string;
  currentTick: number;
  state: 'countdown' | 'waiting-for-ready' | 'playing' | 'paused' | 'finished';
  recentCommands: TickCommandsHistory[];
  /**
   * Integer number of seconds left on the countdown at the moment this
   * snapshot was taken, or `null` if the countdown is no longer running
   * (either it never started with a positive duration, or `game-start`
   * has already been emitted).
   */
  countdownSecondsRemaining?: number | null;
  /**
   * True if `game-start` has already been broadcast for this match.
   * Clients should treat this as a signal to synthesize a local
   * `game-start` event rather than waiting for the server to emit one.
   */
  gameStartEmitted?: boolean;
  /**
   * The match's deterministic RNG seed. Forwarded here so clients that
   * missed the original `game-start` broadcast can still feed the seed
   * into their deterministic simulation on the synthesized start.
   */
  randomSeed?: number;
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

  // Private room events
  roomCreated: (event: RoomCreatedEvent) => void;
  roomError: (event: RoomErrorEvent) => void;
  roomExpired: (event: RoomExpiredEvent) => void;
  roomCancelled: (event: RoomCancelledEvent) => void;
  roomRecovered: (event: RoomRecoveredEvent) => void;

  // Room recovery (optional mobile-friendly layer)
  recoveryStatus: (event: RoomRecoveryStatusEvent) => void;
  roomTerminated: (event: RoomTerminatedEvent) => void;
}

/**
 * Event emitted when a private room is created.
 */
export interface RoomCreatedEvent {
  code: string;
}

/**
 * Event emitted when a room operation fails.
 */
export interface RoomErrorEvent {
  message: string;
}

/**
 * Event emitted when a room expires (TTL exceeded).
 */
export interface RoomExpiredEvent {
  code: string;
}

/**
 * Event emitted when a room is cancelled.
 */
export interface RoomCancelledEvent {
  code: string;
}

/**
 * Event emitted when a host successfully reclaims a private room after a
 * transient socket disconnect (e.g. mobile browser killing the WebSocket
 * when the user switches to a messenger to share the invite link).
 *
 * The returned `code` is the canonical server-side value — callers should
 * prefer it over whatever they passed into `recoverRoom`. In practice
 * this differs from the caller's input only in casing: the server
 * uppercases the provided code and rejects anything else with
 * `room-error: "Room expired"`. Echoing the stored code lets callers
 * update any cached value that drifted in case only.
 */
export interface RoomRecoveredEvent {
  code: string;
}
