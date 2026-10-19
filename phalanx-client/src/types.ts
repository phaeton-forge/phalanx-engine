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
import type {
  CommandsBatchEvent,
  CountdownEvent,
  GamePausedEvent,
  GameResumedEvent,
  GameStartEvent,
  HashComparisonEvent,
  MatchEndEvent,
  MatchFoundEvent,
  MatchLogChunkEvent,
  MatchLogEntry,
  MatchLogErrorEvent,
  MatchLogErrorReason,
  MatchPlayerInfo,
  MatchResumeErrorReason,
  MatchResumeState,
  PlayerCommand,
  PlayerDisconnectedEvent,
  PlayerReadyEvent,
  PlayerReconnectedEvent,
  QueueStatusEvent,
  ReconnectStateEvent,
  ReconnectStatusEvent,
  RoomCancelledEvent,
  RoomCreatedEvent,
  RoomErrorEvent,
  RoomExpiredEvent,
  RoomRecoveredEvent,
  ServerShutdownEvent,
  SessionSupersededEvent,
  SessionTokenEvent,
  SubmitCommandsAck,
  SubmittedCommand,
  TickSyncEvent,
} from '@phalanx-engine/protocol';

// Re-export DesyncEvent for convenience
export type { DesyncEvent };
export type {
  RoomRecoveryStatusEvent,
  RoomTerminatedEvent,
} from './recovery/RoomRecoveryController.js';

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
   * Client build id sent with `queue-join`, `room-create`, and `room-join`.
   * Omitted from those payloads when unset. The server ignores values that
   * are not strings of length 1–128. Also sent on `match-resume` and
   * stored next to the session token when `gameId` is set.
   */
  buildId?: string;

  /**
   * Game id for the session-token record (`phalanx.session.<gameId>`).
   * When omitted, the client does not create a `MatchSessionStore` and
   * does not persist `session-token`. There is no default.
   */
  gameId?: string;

  /**
   * The server was started with `reconnect.requireSessionToken`.
   * When true, a resume timeout does not fall through to
   * `reconnect-match`, which that server always refuses.
   * Omitted means the client does not know, and the legacy rebind
   * still runs after a timeout.
   */
  requireSessionToken?: boolean;

  /**
   * Storage for `MatchSessionStore`. Defaults to `localStorage`
   * (`LocalStorageAdapter`), with an in-memory fallback when the DOM
   * is unavailable. Ignored when `gameId` is omitted.
   */
  matchSessionStorage?: KeyValueStorage;

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

export type {
  CommandsBatchEvent,
  CountdownEvent,
  GamePausedEvent,
  GameResumedEvent,
  GameStartEvent,
  HashComparisonEvent,
  MatchEndEvent,
  MatchFoundEvent,
  MatchLogChunkEvent,
  MatchLogEntry,
  MatchLogErrorEvent,
  MatchLogErrorReason,
  MatchPlayerInfo,
  MatchResumeErrorReason,
  MatchResumeState,
  PlayerCommand,
  PlayerDisconnectedEvent,
  PlayerReadyEvent,
  PlayerReconnectedEvent,
  QueueStatusEvent,
  ReconnectStateEvent,
  ReconnectStatusEvent,
  RoomCancelledEvent,
  RoomCreatedEvent,
  RoomErrorEvent,
  RoomExpiredEvent,
  RoomRecoveredEvent,
  ServerShutdownEvent,
  SessionSupersededEvent,
  SessionTokenEvent,
  SubmitCommandsAck,
  SubmittedCommand,
  TickSyncEvent,
};

/**
 * Why `fetchMatchLog` stopped.
 * `'not-member'`, `'not-found'`, `'invalid'` and `'truncated'` arrive on
 * `match-log-error`.
 * `'disconnected'` is local, when the socket closes mid-read.
 * `'aborted'` is local, when the caller breaks or a newer fetch
 * replaces this one. The server does not send either.
 */
export type MatchLogFailureReason =
  | 'not-member'
  | 'not-found'
  | 'invalid'
  | 'truncated'
  | 'disconnected'
  | 'aborted';

/**
 * Thrown by `PhalanxClient.fetchMatchLog` when the server emits
 * `match-log-error`, when the socket drops, or when this read is aborted.
 */
export class MatchLogError extends Error {
  readonly reason: MatchLogFailureReason;

  constructor(reason: MatchLogFailureReason) {
    super(`match-log failed: ${reason}`);
    this.name = 'MatchLogError';
    this.reason = reason;
  }
}

/**
 * Why `resumeMatch` rejected.
 * `'invalid'`, `'expired'`, `'match-ended'` and `'build-mismatch'` arrive
 * on `match-resume-error`.
 * `'timeout'` is local, when `connectionTimeoutMs` elapses with no
 * answer. The server does not send it.
 */
export type MatchResumeFailureReason =
  'invalid' | 'expired' | 'match-ended' | 'build-mismatch' | 'timeout';

/**
 * Thrown by `PhalanxClient.resumeMatch` when the server emits
 * `match-resume-error`, or when the request times out.
 * Named `MatchResumeRejected` because `MatchResumeError` is the
 * runtime's local-resume error.
 */
export class MatchResumeRejected extends Error {
  readonly reason: MatchResumeFailureReason;

  constructor(reason: MatchResumeFailureReason) {
    super(`match-resume rejected: ${reason}`);
    this.name = 'MatchResumeRejected';
    this.reason = reason;
  }
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
  'disconnected' | 'connecting' | 'connected' | 'reconnecting';

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

  /** Process is shutting down. Matches on this relay will end. */
  serverShutdown: (event: ServerShutdownEvent) => void;

  /** A session token was issued. The client does not parse `token`. */
  sessionToken: (event: { token: string }) => void;

  /** This socket was replaced. It is no longer in the match. */
  sessionSuperseded: (event: SessionSupersededEvent) => void;
}
