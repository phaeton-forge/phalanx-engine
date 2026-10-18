/**
 * Phalanx Engine
 * A game-agnostic deterministic lockstep multiplayer engine
 */

// Main class
export { Phalanx } from './Phalanx.js';

// Authentication
export {
  TokenValidatorService,
  createDevValidator,
  createEndpointValidator,
} from './services/TokenValidator.js';

// Utilities
export { DeterministicRandom } from './utils/index.js';
export { FP, FPVector2, FPVector3, FixedPoint } from './utils/index.js';
export type { FPVector2Interface, FPVector3Interface } from './utils/index.js';

// Types for TypeScript users
export type {
  PhalanxConfig,
  PlayerCommand,
  MatchFoundEvent,
  GameStartEvent,
  TickSyncEvent,
  CommandsBatchEvent,
  TickCommands,
  SubmitCommandsEvent,
  PlayerInfo,
  MatchInfo,
  GameMode,
  GameModePreset,
  CustomGameMode,
  CorsConfig,
  TlsConfig,
  QueuedPlayer,
  QueueStatusEvent,
  MatchLogErrorReason,
  MatchLogRequest,
  MatchLogCancelRequest,
  MatchLogEntry,
  MatchLogChunkEvent,
  MatchLogErrorEvent,
  MatchArchive,
  ServerShutdownEvent,
  MatchErrorEvent,
  SessionConfig,
  ReconnectConfig,
  MatchResumeErrorReason,
  MatchResumeStateEvent,
  SessionTokenEvent,
  SessionSupersededEvent,
  StateHashEvent,
  DesyncDetectedEvent,
  PhalanxEventType,
  PhalanxEventHandlers,
  // Auth types
  AuthConfig,
  TokenValidator,
  TokenValidationResult,
  // Desync config
  DesyncConfig,
  DesyncAction,
  // Pause config
  PauseConfig,
  // Game type routing
  TickMode,
  GameTypeConfig,
  // Private room events
  RoomCreatedEvent,
  RoomRecoveredEvent,
  RoomErrorEvent,
  // Task 10
  AbsenceConfig,
  EndMatchResult,
  PlayerAbsentEvent,
  PlayerCommandContext,
  // Task 11
  GameModuleSpec,
  SimHostConfig,
  ServerRoomMatchConfig,
} from './types/index.js';
export type { AnyGameDefinition, SlotConfig } from '@phalanx-engine/runtime';

// Constants
export {
  GAME_MODES,
  DEFAULT_ABSENCE,
  DEFAULT_SESSION_TTL_MS,
} from './config/defaults.js';
export {
  SessionTokens,
  SESSION_TOMBSTONE_TTL_MS,
} from './services/SessionTokens.js';
export type {
  SessionClaims,
  SessionIssueClaims,
  SessionVerifyResult,
} from './services/SessionTokens.js';
