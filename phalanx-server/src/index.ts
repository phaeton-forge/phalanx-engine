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
} from './types/index.js';

// Constants
export { GAME_MODES } from './config/defaults.js';
