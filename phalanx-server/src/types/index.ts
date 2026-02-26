/**
 * Phalanx Engine Types
 * All exported types for TypeScript users
 */

/**
 * Game mode preset string
 */
export type GameModePreset = '1v1' | '2v2' | '3v3' | '4v4' | 'FFA4';

/**
 * Custom game mode configuration
 */
export interface CustomGameMode {
  playersPerMatch: number;
  teamsCount: number;
}

/**
 * Game mode - either a preset string or custom configuration
 */
export type GameMode = GameModePreset | CustomGameMode;

/**
 * CORS configuration
 */
export interface CorsConfig {
  origin: string | string[];
  methods?: string[];
  credentials?: boolean;
}

/**
 * TLS/SSL configuration for secure WebSocket connections (WSS)
 */
export interface TlsConfig {
  /** Enable TLS/SSL encryption */
  enabled: boolean;
  /** Path to the private key file (PEM format) */
  keyPath: string;
  /** Path to the certificate file (PEM format) */
  certPath: string;
  /** Optional path to CA certificate chain (for Let's Encrypt) */
  caPath?: string;
}

/**
 * Action to take when desync is detected
 */
export type DesyncAction = 'log-only' | 'end-match';

/**
 * Configuration for desync detection behavior
 */
export interface DesyncConfig {
  /** Whether desync detection is enabled */
  enabled: boolean;
  /** Action to take on confirmed desync */
  action: DesyncAction;
  /** Number of consecutive desyncs before taking action (default: 1) */
  gracePeriodTicks: number;
}

/**
 * Token validator function type.
 * Implement this to validate tokens from your OAuth provider.
 */
export type TokenValidator = (token: string) => Promise<TokenValidationResult>;

/**
 * Result of token validation
 */
export interface TokenValidationResult {
  /** Whether the token is valid */
  valid: boolean;
  /** User ID from the token (if valid) */
  userId?: string;
  /** Username from the token (if valid) */
  username?: string;
  /** Email from the token (if valid) */
  email?: string;
  /** Token expiration timestamp in milliseconds (if valid) */
  expiresAt?: number;
  /** Error message (if invalid) */
  error?: string;
}

/**
 * Authentication configuration for securing WebSocket connections
 */
export interface AuthConfig {
  /** Enable authentication (default: false for development) */
  enabled: boolean;

  /**
   * Custom token validator function.
   * If not provided and enabled=true, you must configure a built-in validator.
   */
  validator?: TokenValidator;

  /**
   * Built-in Google token validation.
   * Validates Google ID tokens.
   */
  google?: {
    /** Your Google OAuth Client ID */
    clientId: string;
    /** Your Google OAuth Client Secret (required for token exchange) */
    clientSecret?: string;
    /** Allowed hosted domains (optional, for Google Workspace) */
    allowedDomains?: string[];
  };

  /**
   * Allow unauthenticated connections (for development/testing).
   * If true, connections without tokens are allowed when auth is enabled.
   * @default false
   */
  allowAnonymous?: boolean;

  /**
   * Cache validated tokens to reduce validation overhead.
   * @default true
   */
  cacheTokens?: boolean;

  /**
   * Token cache TTL in milliseconds.
   * @default 300000 (5 minutes)
   */
  cacheTtlMs?: number;
}

/**
 * Full Phalanx configuration
 */
export interface PhalanxConfig {
  // === Server ===
  port: number;
  cors: CorsConfig;

  // === TLS/SSL (optional) ===
  tls?: TlsConfig;

  // === Authentication (optional) ===
  auth?: AuthConfig;

  // === Tick System ===
  tickRate: number;
  tickDeadlineMs: number;

  // === Matchmaking ===
  gameMode: GameMode;
  matchmakingIntervalMs: number;
  countdownSeconds: number;

  // === Timeouts ===
  timeoutTicks: number;
  disconnectTicks: number;
  reconnectGracePeriodMs: number;

  // === Command Validation ===
  maxTickBehind: number;
  maxTickAhead: number;

  // === Command History (for reconnection) ===
  commandHistoryTicks: number;

  // === Determinism Features (Phase 2.1) ===
  /** Enable input sequence validation (default: false for backward compatibility) */
  validateInputSequence?: boolean;
  /** Enable state hashing for desync detection (default: false) */
  enableStateHashing?: boolean;
  /** Interval in ticks between state hash checks (default: 60) */
  stateHashInterval?: number;
  /** Desync detection behavior configuration */
  desync?: Partial<DesyncConfig>;
}

/**
 * Player command sent from client
 */
export interface PlayerCommand {
  type: string;
  tick: number;
  playerId: string;
  data: unknown;
  /** Optional sequence number for input validation (monotonically increasing per player) */
  sequence?: number;
}

/**
 * Information about a player
 */
export interface PlayerInfo {
  id: string;
  teamId: number;
  connected: boolean;
  lastTick: number;
}

/**
 * Information about an active match
 */
export interface MatchInfo {
  id: string;
  players: PlayerInfo[];
  currentTick: number;
  state: 'countdown' | 'playing' | 'paused' | 'finished';
  createdAt: Date;
}

/**
 * Player info for match-found event (minimal data)
 */
export interface MatchPlayerInfo {
  playerId: string;
  username: string;
}

/**
 * Match found event payload - personalized for each player
 */
export interface MatchFoundEvent {
  matchId: string;
  playerId: string;
  teamId: number;
  teammates: MatchPlayerInfo[];
  opponents: MatchPlayerInfo[];
}

/**
 * Countdown event payload - sent every second before game starts
 */
export interface CountdownEvent {
  seconds: number;
}

/**
 * Game start event payload - sent when countdown reaches 0
 */
export interface GameStartEvent {
  matchId: string;
  /** Random seed for deterministic RNG (optional for backward compatibility) */
  randomSeed?: number;
}

/**
 * Tick sync event payload - sent every tick for synchronization
 */
export interface TickSyncEvent {
  tick: number;
  timestamp: number;
}

/**
 * Commands batch event payload - sent to all clients each tick
 */
export interface CommandsBatchEvent {
  tick: number;
  commands: PlayerCommand[];
}

/**
 * Commands grouped by player for a specific tick
 */
export interface TickCommands {
  [playerId: string]: PlayerCommand[];
}

/**
 * Submit commands event payload from client
 */
export interface SubmitCommandsEvent {
  tick: number;
  commands: PlayerCommand[];
}

/**
 * Player queued for matchmaking
 */
export interface QueuedPlayer {
  playerId: string;
  username: string;
  socketId: string;
  joinedAt: number;
}

/**
 * Queue status response
 */
export interface QueueStatusEvent {
  position: number;
  waitTime: number;
}

/**
 * State hash event from client (2.1.3)
 */
export interface StateHashEvent {
  tick: number;
  hash: string;
}

/**
 * Desync detected event (2.1.3)
 */
export interface DesyncDetectedEvent {
  tick: number;
  hashes: { [playerId: string]: string };
}

/**
 * Available Phalanx events
 */
export type PhalanxEventType =
  | 'match-created'
  | 'match-started'
  | 'match-ended'
  | 'match-paused'
  | 'match-resumed'
  | 'player-command'
  | 'player-timeout'
  | 'player-reconnected'
  | 'player-disconnected'
  | 'desync-detected';

/**
 * Event handler types
 */
export interface PhalanxEventHandlers {
  'match-created': (match: MatchInfo) => void;
  'match-started': (match: MatchInfo) => void;
  'match-ended': (matchId: string, reason: string) => void;
  'match-paused': (matchId: string, requestedBy: string) => void;
  'match-resumed': (matchId: string, requestedBy: string) => void;
  'player-command': (
    playerId: string,
    command: PlayerCommand
  ) => boolean | void;
  'player-timeout': (playerId: string, matchId: string) => void;
  'player-reconnected': (playerId: string, matchId: string) => void;
  'player-disconnected': (playerId: string, matchId: string) => void;
  'desync-detected': (
    matchId: string,
    tick: number,
    hashes: { [playerId: string]: string }
  ) => void;
}
