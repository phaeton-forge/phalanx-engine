/**
 * Phalanx Auth Module
 *
 * Managed OAuth authentication for Phalanx games.
 * Provides drop-in authentication with Google, Discord, and Steam.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { AuthManager } from '@phalanx-engine/client/auth';
 *
 * const auth = new AuthManager({
 *   provider: 'google',
 *   google: {
 *     clientId: 'your-client-id.apps.googleusercontent.com'
 *   }
 * });
 *
 * // Check for existing session
 * const hasSession = await auth.checkSession();
 *
 * if (!hasSession) {
 *   // Login with popup
 *   await auth.loginWithPopup();
 * }
 *
 * // Get token for Phalanx client
 * const client = await PhalanxClient.create({
 *   serverUrl: 'http://localhost:3000',
 *   playerId: auth.getUser()!.id,
 *   username: auth.getUser()!.username || 'Player',
 *   authToken: auth.getToken()!
 * });
 * ```
 *
 * @packageDocumentation
 */

// ============================================
// Main Auth Manager
// ============================================

export { AuthManager } from './AuthManager.js';
export type { AuthManagerConfig } from './AuthManager.js';

// ============================================
// OAuth Adapters
// ============================================

export { GoogleOAuthAdapter } from './adapters/GoogleOAuthAdapter.js';
export { computeCodeChallenge } from './adapters/GoogleOAuthAdapter.js';

// Future adapters:
// export { DiscordOAuthAdapter } from './adapters/DiscordOAuthAdapter.js';
// export { SteamAuthAdapter } from './adapters/SteamAuthAdapter.js';

// ============================================
// Storage
// ============================================

export { LocalStorageAdapter, MemoryStorageAdapter } from './storage.js';
export type { AuthStorage } from './storage.js';

// ============================================
// Types
// ============================================

export type {
  // Adapter interface
  AuthAdapter,
  LoginOptions,
  CallbackParams,
  AuthResult,

  // User and state
  AuthUser,
  AuthState,
  StoredAuthData,
  AuthError,

  // Provider configs
  GoogleOAuthConfig,
  DiscordOAuthConfig,
  SteamAuthConfig,
} from './types.js';
