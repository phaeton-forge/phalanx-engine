/**
 * Phalanx Auth Manager
 *
 * Central manager for OAuth authentication.
 * Handles auth state lifecycle, coordinates adapters, manages token refresh,
 * and persists sessions to storage.
 */

import type {
  AuthAdapter,
  AuthResult,
  AuthState,
  AuthUser,
  CallbackParams,
  DiscordOAuthConfig,
  GoogleOAuthConfig,
  LoginOptions,
  SteamAuthConfig,
  StoredAuthData,
} from './types.js';
import type { AuthStorage } from './storage.js';
import { LocalStorageAdapter } from './storage.js';
import { GoogleOAuthAdapter } from './adapters/GoogleOAuthAdapter.js';

// ============================================
// Auth Manager Configuration
// ============================================

/**
 * Configuration for AuthManager.
 */
export interface AuthManagerConfig {
  /** OAuth provider to use */
  provider: 'google' | 'discord' | 'steam';

  /** Google OAuth configuration (required if provider is 'google') */
  google?: GoogleOAuthConfig;

  /** Discord OAuth configuration (required if provider is 'discord') */
  discord?: DiscordOAuthConfig;

  /** Steam auth configuration (required if provider is 'steam') */
  steam?: SteamAuthConfig;

  /** Auto-refresh tokens before expiry (default: true) */
  autoRefresh?: boolean;

  /** Refresh tokens this many ms before expiry (default: 60000 = 1 minute) */
  refreshBeforeExpiryMs?: number;

  /** Storage key prefix (default: 'phalanx_auth') */
  storageKey?: string;

  /** Custom storage implementation */
  storage?: AuthStorage;

  /** Enable debug logging */
  debug?: boolean;

  /** Callback when auth state changes */
  onAuthStateChange?: (state: AuthState) => void;

  /** Callback when token is refreshed */
  onTokenRefresh?: (newToken: string) => void;

  /** Callback when auth error occurs */
  onAuthError?: (error: Error) => void;
}

// ============================================
// Auth Manager
// ============================================

/**
 * Main authentication manager.
 *
 * Provides a simple API for OAuth authentication with automatic
 * token refresh, session persistence, and state management.
 *
 * @example
 * ```typescript
 * const auth = new AuthManager({
 *   provider: 'google',
 *   google: {
 *     clientId: 'your-client-id.apps.googleusercontent.com'
 *   },
 *   onAuthStateChange: (state) => {
 *     console.log('Auth state changed:', state);
 *   }
 * });
 *
 * // Check for existing session on app startup
 * const hasSession = await auth.checkSession();
 *
 * if (!hasSession) {
 *   // Redirect to login
 *   auth.login();
 *   // Or use popup
 *   const result = await auth.loginWithPopup();
 * }
 *
 * // Get token for Phalanx client
 * const token = auth.getToken();
 * ```
 */
export class AuthManager {
  private adapter: AuthAdapter;
  private storage: AuthStorage;
  private config: AuthManagerConfig;
  private state: AuthState;
  private refreshTimer?: ReturnType<typeof setTimeout>;

  /**
   * Create a new AuthManager.
   * @param config - Auth manager configuration
   */
  constructor(config: AuthManagerConfig) {
    this.config = {
      autoRefresh: true,
      refreshBeforeExpiryMs: 60000,
      storageKey: 'phalanx_auth',
      ...config,
    };

    this.storage =
      config.storage || new LocalStorageAdapter(this.config.storageKey);
    this.adapter = this.createAdapter(config);
    this.state = this.getInitialState();

    this.log('AuthManager initialized', { provider: config.provider });
  }

  // ─────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────

  /**
   * Check for existing session and restore it.
   * Call this on app startup to restore user session.
   *
   * @returns True if a valid session was restored
   */
  async checkSession(): Promise<boolean> {
    this.log('Checking for existing session...');

    const stored = await this.storage.get();

    if (!stored || !stored.token) {
      this.log('No stored session found');
      this.updateState({
        ...this.state,
        isLoading: false,
      });
      return false;
    }

    // Check if token is expired
    if (stored.expiresAt && Date.now() >= stored.expiresAt) {
      this.log('Stored token is expired, attempting refresh...');

      // Try to refresh
      if (stored.refreshToken) {
        const result = await this.adapter.refreshToken(stored.refreshToken);
        if (result?.valid) {
          await this.handleAuthSuccess(result, stored.refreshToken);
          return true;
        }
      }

      // Refresh failed, clear session
      this.log('Token refresh failed, clearing session');
      await this.logout();
      return false;
    }

    // Restore session
    this.log('Restoring session for user:', stored.user.id);
    this.updateState({
      isAuthenticated: true,
      isLoading: false,
      user: stored.user,
      token: stored.token,
      expiresAt: stored.expiresAt || null,
      provider: stored.provider,
    });

    this.scheduleTokenRefresh();
    return true;
  }

  /**
   * Start login flow using redirect.
   * User will be redirected to the OAuth provider.
   *
   * @param options - Optional login options
   */
  login(options?: LoginOptions): void {
    this.log('Starting login redirect flow...');

    // Prepare PKCE asynchronously, then redirect
    void this.prepareAndRedirect(options);
  }

  /**
   * Prepare PKCE and redirect to OAuth provider.
   */
  private async prepareAndRedirect(options?: LoginOptions): Promise<void> {
    // Prepare PKCE if the adapter supports it
    if ('preparePKCE' in this.adapter && typeof this.adapter.preparePKCE === 'function') {
      await (this.adapter as { preparePKCE: () => Promise<void> }).preparePKCE();
    }

    const url = this.adapter.getLoginUrl(options);

    if (typeof window !== 'undefined') {
      window.location.href = url;
    } else {
      throw new Error('login() requires a browser environment');
    }
  }


  /**
   * Start login flow using popup.
   * Better UX as user stays on the game page.
   *
   * @param options - Optional login options
   * @returns Auth result after popup flow completes
   */
  async loginWithPopup(options?: LoginOptions): Promise<AuthResult> {
    this.log('Starting login popup flow...');

    if (typeof window === 'undefined') {
      throw new Error('loginWithPopup() requires a browser environment');
    }

    // Prepare PKCE if the adapter supports it
    if ('preparePKCE' in this.adapter && typeof this.adapter.preparePKCE === 'function') {
      await (this.adapter as { preparePKCE: () => Promise<void> }).preparePKCE();
    }

    return new Promise((resolve, reject) => {
      const url = this.adapter.getLoginUrl(options);
      const width = 500;
      const height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        url,
        'phalanx-auth',
        `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
      );

      if (!popup) {
        const error = new Error(
          'Popup blocked. Please allow popups for this site.'
        );
        this.config.onAuthError?.(error);
        reject(error);
        return;
      }

      // Listen for callback message from popup
      const handleMessage = async (event: MessageEvent) => {
        // Validate origin
        if (event.origin !== window.location.origin) return;
        if (event.data?.type !== 'phalanx-auth-callback') return;

        this.log('Received auth callback from popup');
        window.removeEventListener('message', handleMessage);
        popup.close();

        try {
          const result = await this.adapter.handleCallback(event.data.params);
          if (result.valid) {
            await this.handleAuthSuccess(result);
          }
          resolve(result);
        } catch (error) {
          this.config.onAuthError?.(error as Error);
          reject(error);
        }
      };

      window.addEventListener('message', handleMessage);

      // Check if popup was closed without completing auth
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', handleMessage);
          const error = new Error('Authentication cancelled');
          this.config.onAuthError?.(error);
          reject(error);
        }
      }, 500);
    });
  }

  /**
   * Handle OAuth callback.
   * Call this on your callback page.
   *
   * @param params - Callback parameters (parsed from URL if not provided)
   * @returns Auth result
   */
  async handleCallback(params?: CallbackParams): Promise<AuthResult> {
    this.log('Handling OAuth callback...');

    const callbackParams = params || this.parseCallbackFromUrl();

    if (callbackParams.error) {
      this.log('Callback error:', callbackParams.error);
      return {
        valid: false,
        error: callbackParams.errorDescription || callbackParams.error,
        errorCode: callbackParams.error,
      };
    }

    const result = await this.adapter.handleCallback(callbackParams);

    if (result.valid) {
      await this.handleAuthSuccess(result);
    } else {
      this.config.onAuthError?.(new Error(result.error || 'Auth failed'));
    }

    return result;
  }

  /**
   * Logout and clear session.
   * Optionally revokes the token with the provider.
   */
  async logout(): Promise<void> {
    this.log('Logging out...');

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    // Get stored data to retrieve access token for revocation
    const stored = await this.storage.get();
    const accessToken = stored?.accessToken;

    // Clear state first
    await this.storage.clear();
    this.updateState(this.getInitialState());
    this.state.isLoading = false;
    this.updateState(this.state);

    // Revoke access token if available (Google requires access token, not ID token)
    if (accessToken && this.adapter.revokeToken) {
      try {
        await this.adapter.revokeToken(accessToken);
        this.log('Token revoked successfully');
      } catch (error) {
        console.warn('[AuthManager] Failed to revoke token:', error);
      }
    }
  }

  /**
   * Get current auth state.
   * @returns Copy of current auth state
   */
  getState(): AuthState {
    return { ...this.state };
  }

  /**
   * Get current token (for Phalanx client).
   * @returns Current auth token or null
   */
  getToken(): string | null {
    return this.state.token;
  }

  /**
   * Check if user is authenticated.
   * @returns True if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.state.isAuthenticated;
  }

  /**
   * Get current user info.
   * @returns User info or null
   */
  getUser(): AuthUser | null {
    return this.state.user;
  }

  /**
   * Get the OAuth provider name.
   * @returns Provider name
   */
  getProvider(): string {
    return this.adapter.provider;
  }

  /**
   * Manually refresh the current token.
   * @returns True if refresh was successful
   */
  async refreshToken(): Promise<boolean> {
    this.log('Manually refreshing token...');

    const stored = await this.storage.get();
    if (!stored?.refreshToken) {
      this.log('No refresh token available');
      return false;
    }

    const result = await this.adapter.refreshToken(stored.refreshToken);
    if (result?.valid) {
      await this.handleAuthSuccess(result, stored.refreshToken);
      return true;
    }

    this.log('Token refresh failed');
    return false;
  }

  /**
   * Get the login URL without redirecting.
   * Useful for custom login UI.
   *
   * @param options - Optional login options
   * @returns Authorization URL
   */
  getLoginUrl(options?: LoginOptions): string {
    return this.adapter.getLoginUrl(options);
  }

  // ─────────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create the appropriate adapter based on configuration.
   */
  private createAdapter(config: AuthManagerConfig): AuthAdapter {
    switch (config.provider) {
      case 'google':
        if (!config.google) {
          throw new Error('Google config required when provider is "google"');
        }
        return new GoogleOAuthAdapter(config.google);

      case 'discord':
        if (!config.discord) {
          throw new Error(
            'Discord config required when provider is "discord"'
          );
        }
        // DiscordOAuthAdapter not implemented yet
        throw new Error('Discord OAuth adapter not implemented yet');

      case 'steam':
        if (!config.steam) {
          throw new Error('Steam config required when provider is "steam"');
        }
        // SteamAuthAdapter not implemented yet
        throw new Error('Steam auth adapter not implemented yet');

      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }

  /**
   * Handle successful authentication.
   */
  private async handleAuthSuccess(
    result: AuthResult,
    existingRefreshToken?: string
  ): Promise<void> {
    this.log('Auth success for user:', result.playerId);

    const user: AuthUser = {
      id: result.playerId!,
      username: result.username,
      email: result.email,
      avatarUrl: result.avatarUrl,
      provider: result.provider!,
    };

    const storedData: StoredAuthData = {
      user,
      token: result.token!,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken || existingRefreshToken,
      expiresAt: result.expiresAt,
      provider: result.provider!,
    };

    await this.storage.set(storedData);

    this.updateState({
      isAuthenticated: true,
      isLoading: false,
      user,
      token: result.token!,
      expiresAt: result.expiresAt || null,
      provider: result.provider!,
    });

    this.scheduleTokenRefresh();
    this.config.onTokenRefresh?.(result.token!);
  }

  /**
   * Schedule automatic token refresh.
   */
  private scheduleTokenRefresh(): void {
    if (this.config.autoRefresh === false) {
      return;
    }
    if (!this.state.expiresAt) {
      return;
    }

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    const refreshBeforeMs = this.config.refreshBeforeExpiryMs || 60000;
    const refreshAt = this.state.expiresAt - refreshBeforeMs;
    const delay = refreshAt - Date.now();

    if (delay <= 0) {
      // Token already needs refresh
      this.log('Token needs immediate refresh');
      this.refreshToken();
      return;
    }

    this.log(`Scheduling token refresh in ${Math.round(delay / 1000)}s`);

    this.refreshTimer = setTimeout(() => {
      this.log('Auto-refreshing token...');
      this.refreshToken();
    }, delay);
  }

  /**
   * Update state and notify listeners.
   */
  private updateState(newState: AuthState): void {
    this.state = newState;
    this.config.onAuthStateChange?.(newState);
  }

  /**
   * Get initial auth state.
   */
  private getInitialState(): AuthState {
    return {
      isAuthenticated: false,
      isLoading: true,
      user: null,
      token: null,
      expiresAt: null,
      provider: null,
    };
  }

  /**
   * Parse OAuth callback parameters from current URL.
   */
  private parseCallbackFromUrl(): CallbackParams {
    if (typeof window === 'undefined') {
      return {};
    }

    const params = new URLSearchParams(window.location.search);
    return {
      code: params.get('code') || undefined,
      state: params.get('state') || undefined,
      error: params.get('error') || undefined,
      errorDescription: params.get('error_description') || undefined,
      url: window.location.href,
    };
  }

  /**
   * Log debug message if debug mode is enabled.
   */
  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[AuthManager]', ...args);
    }
  }
}
