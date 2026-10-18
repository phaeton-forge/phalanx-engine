/**
 * Phalanx Engine Types
 * All exported types for TypeScript users
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ResourceLimits } from 'node:worker_threads';
import type { AnyGameDefinition, SlotConfig } from '@phalanx-engine/runtime';

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
 * One finished match, handed to `PhalanxConfig.onMatchArchived`.
 * `formatVersion` is 1. The engine does not store this value.
 * `log` entries match `match-log-chunk` `entries`: non-empty ticks,
 * ascending, the same `PlayerCommand[]` arrays the room stored.
 */
export interface MatchArchive {
  formatVersion: 1;
  matchId: string;
  /** Present when the room was created with a game type. */
  gameType?: string;
  /** `GameRoom.getBuildId()`, omitted when no player sent one. */
  buildId?: string;
  /** `GameRoom.randomSeed`, the same value sent in `game-start`. */
  seed: number;
  /** Index is `teamId`. Order matches `GameRoom` teams. */
  teams: { playerId: string; username: string }[][];
  /**
   * `reason` from `match-ended` / `match-end`
   * (`'stopped' | 'desync' | 'turn-timeout' | …`).
   */
  endReason: string;
  /** Set when `endMatch` resolved a winning team. Otherwise omitted. */
  winnerTeamId?: number;
  /** Epoch ms of `startGame()`. */
  startedAt: number;
  /** Epoch ms when this archive was built. */
  endedAt: number;
  /**
   * Last tick broadcast in `commands-batch` (`currentTick - 1`).
   * `-1` when no tick was broadcast.
   */
  lastTick: number;
  /** Room `tickRate`, including a `gameTypes` override. */
  tickRate: number;
  /** Room `commandHistoryTicks`. */
  historyMode: number | 'full';
  /**
   * `true` for `'full'`, and for a numeric window that still holds
   * tick 0 (or never stored a tick). `false` once the numeric window
   * has dropped the start of the log.
   */
  complete: boolean;
  log: { tick: number; commands: PlayerCommand[] }[];
}

/**
 * Tick mode: 'continuous' runs a server tick loop; 'event' is tickless (relay-only).
 */
export type TickMode = 'continuous' | 'event';

/**
 * Per-game-type configuration overrides.
 * Fields here override the base PhalanxConfig for matches of this game type.
 */
export interface GameTypeConfig {
  gameType: string;
  tickMode?: TickMode;
  tickRate?: number;
  gameMode?: GameMode;
  countdownSeconds?: number;
  turnTimeoutMs?: number;
}

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
  tickMode?: TickMode;

  // === Game Types ===
  gameTypes?: GameTypeConfig[];
  turnTimeoutMs?: number;

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
  // Task 8 — relay log, build id, and process shutdown.
  // `commandHistoryTicks` stays 200 by default. `'full'` keeps every
  // non-empty tick for the whole match. The other fields are optional
  // and read as false / 0 when omitted, so today's behaviour is unchanged.
  commandHistoryTicks: number | 'full';
  /**
   * When true, `GameRoom.start()` rejects the match before `match-found`
   * if players' `buildId`s differ or any player has none.
   * Default: false (build ids are stored and not checked).
   */
  requireBuildId?: boolean;
  /**
   * How long `Phalanx.shutdown()` waits after `server-shutdown` before
   * `stop()`. `0` still yields once via `setImmediate` so the event can
   * leave the process. Default: 0.
   */
  shutdownGraceMs?: number;
  /**
   * When true, `start()` registers `process.once('SIGTERM')` to call
   * `shutdown('sigterm')`. `stop()` removes that listener. Default: false.
   * The process is never exited by the engine.
   */
  handleSignals?: boolean;

  // Task 8.1
  /**
   * Called once when a match that reached `startGame()` ends.
   * The engine does not write the archive anywhere. Omit the hook
   * and the match log is released with nothing built.
   * Not called before the match starts: `build-mismatch`,
   * `players-not-connected`, `ready-timeout`, or `stop()` /
   * `shutdown()` during countdown or waiting-for-ready.
   * `rec.log` reuses the stored command arrays. The engine does not
   * touch them after the call. Do not mutate them if something else
   * still holds those arrays. Do heavy work asynchronously
   * (`zlib` async, a stream into storage): the hook runs on the
   * main thread. A throw or a rejected promise is logged and does
   * not stop the relay. `shutdown()` waits for hooks that are still
   * running, up to `shutdownGraceMs` after `stop()`.
   */
  onMatchArchived?: (rec: MatchArchive) => void | Promise<void>;

  // === Determinism Features (Phase 2.1) ===
  /** Enable input sequence validation (default: false for backward compatibility) */
  validateInputSequence?: boolean;
  /** Enable state hashing for desync detection (default: false) */
  enableStateHashing?: boolean;
  /** Interval in ticks between state hash checks (default: 60) */
  stateHashInterval?: number;
  /** Desync detection behavior configuration */
  desync?: Partial<DesyncConfig>;

  // === Ready Handshake ===
  /** Timeout in milliseconds for all clients to report ready after game-start (default: 30000) */
  readyTimeoutMs?: number;

  // === Pre-countdown Player Wait ===
  /**
   * How long `GameRoom.start()` will wait for all participants' sockets
   * to be present before kicking off the countdown. If at least one
   * player is offline at start time, the match enters
   * `'waiting-for-players'` and emits `match-waiting-for-players` to
   * whoever is online; the countdown only begins once everyone
   * reconnects, or after this timeout the match is ended with
   * `match-end: 'players-not-connected'`. Default: 60000.
   */
  playersConnectTimeoutMs?: number;

  // === Pause/Resume Settings ===
  /** Pause/resume behavior configuration */
  pause?: Partial<PauseConfig>;

  // Task 9
  /**
   * Opt-in HMAC session tokens. Omit the field to keep today's
   * behaviour: no `session-token` is sent, and `match-resume` answers
   * `match-resume-error` with `reason: 'invalid'`.
   */
  session?: SessionConfig;
  /**
   * Opt-in gate on legacy rebind. Omit it, or leave
   * `requireSessionToken` false, and `reconnect-match` / `room-recover`
   * keep today's behaviour. The flat `reconnectGracePeriodMs` is
   * unrelated and stays where it is.
   */
  reconnect?: ReconnectConfig;

  // Task 10
  /**
   * Opt-in absence timer while a match is `playing`.
   * Omit the field to keep today's behaviour: a disconnected player
   * never loses the match, and no `player-absent` event is sent.
   */
  absence?: AbsenceConfig;

  // === Extension Hook ===
  /**
   * Optional hook for mounting additional request handlers on the same HTTP
   * server. Called after CORS preflight, before built-in routes.
   *
   * Return `true` to signal the request was fully handled (no further
   * routing). Return `false` (or `undefined`) to let Phalanx continue with
   * its own routing.
   */
  extraRequestHandler?: (
    req: IncomingMessage,
    res: ServerResponse
  ) => boolean | Promise<boolean>;

  // Task 11
  /**
   * Games this process can simulate. Omit it, or pass an empty list,
   * and the server stays a pure relay: no worker is spawned.
   * A worker loads each game by module path. An in-process host may
   * also take a `GameDefinition` object.
   */
  games?: ReadonlyArray<AnyGameDefinition | GameModuleSpec>;
  /** Opt-in server simulation. Default mode is one worker thread. */
  simHost?: SimHostConfig;
}

/** Module path a worker imports. `export` defaults to `default`, then `RelayGame`. */
export interface GameModuleSpec {
  module: string;
  export?: string;
  /**
   * Integer `matchConfig` keys copied into the runner config.
   * Every other extra key is rejected. Engine fields (`seed`, `side`,
   * `matchId`, …) are filled by the server and cannot be listed here.
   */
  configKeys?: readonly string[];
}

/**
 * Server-sim host. `workers` is accepted only as `1` (a pool is a later task).
 * `snapshotEveryTicks` defaults to 1000. `maxMatches` caps concurrent
 * `simMode: 'server'` rooms.
 */
export interface SimHostConfig {
  mode?: 'worker' | 'inProcess';
  workers?: 1;
  resourceLimits?: ResourceLimits;
  snapshotEveryTicks?: number;
  maxMatches?: number;
}

/**
 * `room-create` body that starts a server-simulated match.
 * Further integer fields are copied only when the game's `configKeys`
 * lists them.
 */
export interface ServerRoomMatchConfig {
  gameId: string;
  simMode: 'server';
  slots: readonly SlotConfig[];
  inputDelayTicks?: number;
  /** Bot policy used when an absent human is replaced. Requires `absence`. */
  absencePolicy?: string;
  [extra: string]: unknown;
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
 * Opt-in session tokens (Task 9). `secret` signs every token for this
 * process. `ttlMs` defaults to 60 minutes.
 */
export interface SessionConfig {
  /** HMAC-SHA256 secret. At least 32 characters. */
  secret: string;
  /** Token lifetime in milliseconds. Default: 3600000 (60 minutes). */
  ttlMs?: number;
}

/**
 * Opt-in rejection of body-`playerId` rebind into a match that has
 * already started (Task 9). Default is off.
 */
export interface ReconnectConfig {
  /**
   * When true, `reconnect-match` and `room-recover` into a match
   * that has left `waiting-for-players` are rejected.
   * `room-recover` during `waiting-for-players` stays open so a
   * player who missed `match-found` can receive the first token.
   * Waiting-room `room-recover` (no match yet) is unchanged.
   * Resume goes through `match-resume`.
   * Default: false.
   */
  requireSessionToken?: boolean;
}

/** Why `match-resume` was refused. No extra detail is sent. */
export type MatchResumeErrorReason =
  'invalid' | 'expired' | 'match-ended' | 'build-mismatch';

/**
 * Successful `match-resume`. `absentDeadline` is omitted when no other
 * player is absent. It is milliseconds until the soonest other absence
 * expires (`GameRoom.getAbsences()`), not an epoch time.
 * `snapshot` is Task 11.
 */
export interface MatchResumeStateEvent {
  matchId: string;
  slot: number;
  currentTick: number;
  state: MatchInfo['state'];
  absentDeadline?: number;
  /** Present in server-sim mode when a snapshot has been stored. Tick only. */
  snapshot?: { tick: number };
}

/**
 * Issued at `match-found`. A later issue at `game-start` and on each
 * rebind replaces it. `exp` is that issue time plus `ttlMs`, so the
 * new token extends the lifetime. `matchId` and `slot` are beside
 * `token` because the client does not parse the token. `slot` is the
 * index in `teams.flat()`.
 */
export interface SessionTokenEvent {
  token: string;
  matchId: string;
  slot: number;
}

/**
 * The socket this player was bound to has been replaced.
 * `matchId` is the match it no longer belongs to.
 */
export interface SessionSupersededEvent {
  matchId: string;
}

/**
 * Opt-in absence window (Task 10). Both durations are milliseconds.
 * `windowMs` may be longer than `matchBudgetMs`; the deadline is the
 * minimum of the two.
 */
export interface AbsenceConfig {
  /** Milliseconds granted for a single absence. */
  windowMs: number;
  /** Milliseconds of absence budget for one player across the match. */
  matchBudgetMs: number;
}

/**
 * Result passed to `ctx.endMatch` on the `player-command` hook.
 * `winnerTeamId`, when present on the wire, is the team that won.
 * `loserIds` is an input only: the room derives `winnerTeamId` from it
 * when the caller did not pass one.
 */
export interface EndMatchResult {
  reason: string;
  winnerTeamId?: number;
  loserIds?: string[];
}

/**
 * `player-absent` payload, and one row of `GameRoom.getAbsences()`.
 * Both durations are milliseconds remaining at the moment the payload
 * is produced (send time for the event, call time for the getter).
 * The client counts down from the moment it receives the event.
 */
export interface PlayerAbsentEvent {
  playerId: string;
  deadlineMs: number;
  budgetLeftMs: number;
}

/**
 * Third argument of the `player-command` hook. Two-argument handlers
 * stay valid; they ignore this context.
 */
export interface PlayerCommandContext {
  matchId: string;
  /**
   * Finish the match. Returns false when it is already finished, or when
   * `winnerTeamId` is not a team in the match (warning, match stays
   * `playing`).
   */
  endMatch(result: EndMatchResult): boolean;
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
  state:
    | 'waiting-for-players'
    | 'countdown'
    | 'waiting-for-ready'
    | 'playing'
    | 'paused'
    | 'finished';
  createdAt: Date;
  gameType?: string;
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
  /**
   * Server-sim runner config (`side: 'server'`). Present only when this
   * match has a server simulation. A client copies it and sets `side`
   * to `'client'`.
   */
  matchConfig?: { readonly [key: string]: unknown };
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
  gameType?: string;
  /** Client build id from queue-join / room-create / room-join, when valid. */
  buildId?: string;
  /** Bot slots have no socket. Omitted means human (today's rooms). */
  kind?: 'human' | 'bot';
}

/**
 * Why a `match-log` request was refused.
 * `'truncated'` means numeric history no longer contains `fromTick`.
 */
export type MatchLogErrorReason =
  'not-member' | 'not-found' | 'invalid' | 'truncated';

/**
 * Client → server request for the command log of a match.
 * `maxTicks` defaults to the whole remaining log on the server.
 */
export interface MatchLogRequest {
  matchId: string;
  fromTick: number;
  maxTicks?: number;
  /**
   * Client-chosen id for this read. Echoed on chunks and errors so a
   * socket can ignore a stream that a later request replaced.
   */
  requestId?: string;
}

/** Client → server. Stops the `match-log` stream with this `requestId`. */
export interface MatchLogCancelRequest {
  requestId?: string;
}

/** One stored tick inside a `match-log-chunk`. Empty ticks are omitted. */
export interface MatchLogEntry {
  tick: number;
  commands: PlayerCommand[];
}

/**
 * Server → requesting socket. `toTick` is inclusive. A chunk spans at
 * most 2000 ticks of the requested range (not 2000 entries). `matchId`
 * is present so a client can ignore a chunk from another match.
 */
export interface MatchLogChunkEvent {
  matchId: string;
  fromTick: number;
  toTick: number;
  entries: MatchLogEntry[];
  done: boolean;
  /** Present when the request carried a `requestId`. */
  requestId?: string;
}

/** Server → requesting socket when `match-log` is refused. */
export interface MatchLogErrorEvent {
  matchId?: string;
  requestId?: string;
  reason: MatchLogErrorReason;
}

/**
 * Sent to every player of a match before the process stops.
 * `matchIds` is the same list for every room.
 */
export interface ServerShutdownEvent {
  reason: string;
  matchIds: string[];
}

/** Sent to match players when the match cannot start. */
export interface MatchErrorEvent {
  matchId: string;
  reason: 'build-mismatch';
}

/**
 * Queue status response
 */
export interface QueueStatusEvent {
  position: number;
  waitTime: number;
}

/**
 * Private room events — client/server wire contracts.
 *
 * These mirror the interfaces exported from
 * `services/PrivateRoomService.ts` and are documented here for
 * consistency with the rest of the public event surface.
 *
 * Socket events:
 *   • server → host:  `room-created`    → `RoomCreatedEvent`
 *   • server → host:  `room-recovered`  → `RoomRecoveredEvent`
 *   • server → host:  `room-cancelled`  → `{ code: string }`
 *   • server → host:  `room-expired`    → `{ code: string }`
 *   • server → peer:  `room-error`      → `RoomErrorEvent`
 *   • client → server: `room-create`    → `{ playerId, username?, gameType? }`
 *   • client → server: `room-join`      → `{ playerId, username?, code }`
 *   • client → server: `room-cancel`    → `{}`
 *   • client → server: `room-recover`   → `{ playerId, username?, code }`
 *
 * The `code` on `room-recover` is required: it proves the caller is
 * actually the host who created the room. In an unauthenticated
 * socket environment `playerId` alone is not a credential, so the
 * server refuses to recover without a matching code and emits
 * `room-error: "Room expired"` instead (same message as "no such
 * room" so we never leak whether a given playerId currently owns
 * a room).
 */

/** Event sent to the host when a room is created. */
export interface RoomCreatedEvent {
  code: string;
}

/**
 * Event sent to the host when they successfully reclaim a room
 * via `room-recover` after a transient socket disconnect.
 */
export interface RoomRecoveredEvent {
  code: string;
}

/** Event sent when a private-room operation fails. */
export interface RoomErrorEvent {
  message: string;
  /**
   * Typed gate. `session-token-required` refuses an in-match
   * `room-recover` when `reconnect.requireSessionToken` is on.
   * `sim-unavailable` refuses a server room after the sim worker has
   * died. Other failures omit it.
   */
  reason?: 'session-token-required' | 'sim-unavailable';
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
  | 'desync-detected'
  | 'sim-digest'
  | 'sim-lag'
  | 'bot-commands-late'
  | 'sim-fault';

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
    command: PlayerCommand,
    ctx: PlayerCommandContext
  ) => boolean | void;
  'player-timeout': (playerId: string, matchId: string) => void;
  'player-reconnected': (playerId: string, matchId: string) => void;
  'player-disconnected': (playerId: string, matchId: string) => void;
  'desync-detected': (
    matchId: string,
    tick: number,
    hashes: { [playerId: string]: string }
  ) => void;
  'sim-digest': (matchId: string, tick: number, digest: string) => void;
  'sim-lag': (
    matchId: string,
    relayTick: number,
    simTick: number,
    gap: number
  ) => void;
  'bot-commands-late': (
    matchId: string,
    fromTick: number,
    filedTick: number,
    playerId: string
  ) => void;
  'sim-fault': (matchId: string, reason: string, message: string) => void;
}
