/**
 * Phalanx Client Library
 *
 * Client-side library for connecting to Phalanx Engine servers.
 * Provides a type-safe API for matchmaking, game synchronization,
 * command submission, and reconnection handling.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { PhalanxClient } from '@phalanx-engine/client';
 *
 * // Create and connect
 * const client = await PhalanxClient.create({
 *   serverUrl: 'http://localhost:3000',
 *   playerId: 'player-123',
 *   username: 'MyPlayer',
 * });
 *
 * // Matchmaking
 * client.onMatchFound((data) => console.log('Match found!', data));
 * client.joinQueue();
 *
 * // Game loop - just two callbacks!
 * client.onTick((tick, commands) => {
 *   // Process commands from all players
 *   for (const [playerId, playerCommands] of Object.entries(commands.commands)) {
 *     for (const cmd of playerCommands) {
 *       handleCommand(playerId, cmd);
 *     }
 *   }
 *   // Run simulation
 *   world.simulate();
 * });
 *
 * client.onFrame((alpha, dt) => {
 *   // Interpolate positions for smooth rendering
 *   interpolate(alpha);
 *   // Render
 *   scene.render();
 * });
 *
 * // Send commands
 * client.sendCommand('move', { targetX: 10, targetZ: 20 });
 * ```
 *
 * @packageDocumentation
 */

// ============================================
// Main Client
// ============================================

export { PhalanxClient } from './PhalanxClient.js';
export { MatchLogError, MatchResumeRejected } from './types.js';

// ============================================
// Utilities
// ============================================

// Event emitter (for building custom clients or extensions)
export { EventEmitter } from './EventEmitter.js';

// Render loop (for custom rendering setups)
export { RenderLoop } from './RenderLoop.js';
export type { RenderLoopConfig, CommandFlushCallback } from './RenderLoop.js';

// Socket manager (for custom networking setups)
export { SocketManager } from './SocketManager.js';
export type {
  SocketManagerConfig,
  SocketManagerCallbacks,
} from './SocketManager.js';

export { deriveMatchRandomSeed, resolveMatchRandomSeed } from './matchSeed.js';

// State hasher utility for desync detection
export { StateHasher } from './StateHasher.js';

// Desync detector (advanced usage - for custom desync handling)
export { DesyncDetector } from './DesyncDetector.js';
export type { DesyncConfig, DesyncEvent } from './DesyncDetector.js';

// ============================================
// Room Recovery (mobile-friendly reconnection)
// ============================================

export {
  RoomRecoveryController,
  RoomPersistence,
  isMobileBrowser,
  pickMobileFriendlyTransports,
  loadOrCreateGuestPlayerId,
  MemoryKeyValueStorage,
  defaultKeyValueStorage,
  MatchSessionStore,
  getRecoverTimeoutMs,
  DEFAULT_RECOVER_TIMEOUT_BUDGET,
  armBrowserLifecycle,
} from './recovery/index.js';
export type {
  RoomRecoveryConfig,
  RoomRecoveryStatusEvent,
  RoomRecoveryPhase,
  RoomTerminatedEvent,
  RoomRecoveryControllerEvents,
  RecoveryClientPort,
  RoomPersistenceConfig,
  PersistedRoom,
  RoomRole,
  KeyValueStorage,
  MatchSession,
  RecoverTimeoutBudget,
  BrowserLifecycleHandle,
  BrowserLifecycleHandlers,
} from './recovery/index.js';

// ============================================
// Authentication
// ============================================

// Auth manager (managed OAuth for Google, Discord, Steam)
export { AuthManager } from './auth/AuthManager.js';
export type { AuthManagerConfig } from './auth/AuthManager.js';

// Google OAuth adapter
export { GoogleOAuthAdapter } from './auth/adapters/GoogleOAuthAdapter.js';

// Storage adapters
export { LocalStorageAdapter, MemoryStorageAdapter } from './auth/storage.js';
export type { AuthStorage } from './auth/storage.js';

// Auth types
export type {
  AuthAdapter,
  AuthResult,
  AuthState,
  AuthUser,
  AuthError,
  CallbackParams,
  LoginOptions,
  GoogleOAuthConfig,
  DiscordOAuthConfig,
  SteamAuthConfig,
  StoredAuthData,
} from './auth/types.js';

// ============================================
// Types
// ============================================

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
  MatchPlayerInfo,
  MatchResumeState,
  MatchSnapshot,
  MatchSnapshotRequest,
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
  ServerDesyncEvent,
  ServerShutdownEvent,
  SessionSupersededEvent,
  SessionTokenEvent,
  SubmitCommandsAck,
  SubmittedCommand,
  TickSyncEvent,
} from '@phalanx-engine/protocol';

export type {
  // Configuration
  PhalanxClientConfig,
  PhalanxAuthConfig,
  PhalanxRoomRecoveryConfig,
  PauseConfig,
  SocketTransport,

  // Auth
  PhalanxAuthState,
  PhalanxAuthUser,

  // Commands
  CommandsBatch,

  // Handlers
  TickHandler,
  FrameHandler,
  Unsubscribe,
  PauseHandler,

  // Match log / resume failures that exist only on the client
  MatchLogFailureReason,
  MatchResumeFailureReason,

  // Errors
  PhalanxError,

  // State types
  ConnectionState,
  ClientState,

  // Event handlers (for legacy 'on' API)
  PhalanxClientEvents,
} from './types.js';
