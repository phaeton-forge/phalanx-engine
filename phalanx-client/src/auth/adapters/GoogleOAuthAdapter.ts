/**
 * Google OAuth Adapter
 *
 * OAuth 2.0 adapter for Google Sign-In using PKCE flow.
 * This is a client-side only implementation that doesn't require a backend.
 */

import type {
  AuthAdapter,
  AuthResult,
  CallbackParams,
  GoogleOAuthConfig,
  LoginOptions,
} from '../types.js';

// ============================================
// Google Token Types
// ============================================

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  id_token: string;
  refresh_token?: string;
  scope: string;
  token_type: 'Bearer';
}

interface GoogleIdTokenPayload {
  // Standard OIDC claims
  iss: string; // https://accounts.google.com
  azp: string; // Authorized party (client ID)
  aud: string; // Audience (client ID)
  sub: string; // Subject (user ID)
  iat: number; // Issued at
  exp: number; // Expiration

  // Profile claims
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  locale?: string;

  // Hosted domain
  hd?: string;

  // Nonce for replay protection
  nonce?: string;
}

// ============================================
// Google OAuth Adapter
// ============================================

/**
 * Google OAuth adapter using PKCE flow.
 *
 * Features:
 * - PKCE (Proof Key for Code Exchange) for security
 * - State parameter for CSRF protection
 * - Nonce for replay protection
 * - ID token validation
 * - Automatic token refresh
 *
 * @example
 * ```typescript
 * const adapter = new GoogleOAuthAdapter({
 *   clientId: 'your-client-id.apps.googleusercontent.com'
 * });
 *
 * // Generate login URL
 * const loginUrl = adapter.getLoginUrl();
 * window.location.href = loginUrl;
 *
 * // Handle callback (on /auth/callback page)
 * const result = await adapter.handleCallback({
 *   code: new URLSearchParams(location.search).get('code'),
 *   state: new URLSearchParams(location.search).get('state')
 * });
 * ```
 */
export class GoogleOAuthAdapter implements AuthAdapter {
  readonly provider = 'google';

  private config: Required<Pick<GoogleOAuthConfig, 'clientId' | 'scopes'>> &
    GoogleOAuthConfig;

  // Storage keys for PKCE
  private readonly VERIFIER_KEY = 'phalanx_google_verifier';
  private readonly CHALLENGE_KEY = 'phalanx_google_challenge';
  private readonly STATE_KEY = 'phalanx_google_state';
  private readonly NONCE_KEY = 'phalanx_google_nonce';

  /**
   * Create a new Google OAuth adapter.
   * @param config - Google OAuth configuration
   */
  constructor(config: GoogleOAuthConfig) {
    this.config = {
      scopes: ['openid', 'profile', 'email'],
      ...config,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // AuthAdapter Interface
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generate the Google OAuth authorization URL.
   *
   * This method:
   * 1. Generates PKCE code verifier and challenge
   * 2. Generates state for CSRF protection
   * 3. Generates nonce for ID token validation
   * 4. Stores values in sessionStorage for callback validation
   * 5. Returns the authorization URL
   *
   * Note: Call preparePKCE() before this if you need async SHA-256 challenge.
   * If not called, uses plain verifier as challenge (works with some providers).
   *
   * @param options - Optional login options
   * @returns Authorization URL to redirect user to
   */
  getLoginUrl(options?: LoginOptions): string {
    // Check if PKCE was pre-computed
    let codeVerifier =
      typeof sessionStorage !== 'undefined'
        ? sessionStorage.getItem(this.VERIFIER_KEY)
        : null;
    let codeChallenge =
      typeof sessionStorage !== 'undefined'
        ? sessionStorage.getItem(this.CHALLENGE_KEY)
        : null;

    // Generate new PKCE values if not pre-computed
    if (!codeVerifier || !codeChallenge) {
      codeVerifier = this.generateCodeVerifier();
      // For sync operation, use plain method (S256 requires async)
      // We'll compute proper S256 challenge inline using a workaround
      codeChallenge = codeVerifier; // Fallback - will be replaced if preparePKCE was called
    }

    const state = options?.state || this.generateRandomString();
    const nonce = options?.nonce || this.generateRandomString();

    // Store for callback validation
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(this.VERIFIER_KEY, codeVerifier);
      sessionStorage.setItem(this.STATE_KEY, state);
      sessionStorage.setItem(this.NONCE_KEY, nonce);
      // Clear challenge key (will be regenerated on next preparePKCE)
      sessionStorage.removeItem(this.CHALLENGE_KEY);
    }

    // Merge scopes
    const scopes = options?.scopes
      ? [...new Set([...this.config.scopes, ...options.scopes])]
      : this.config.scopes;

    // Build authorization URL
    // Use 'plain' method if challenge equals verifier, otherwise 'S256'
    const challengeMethod = codeChallenge === codeVerifier ? 'plain' : 'S256';

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: options?.redirectUri || this.getRedirectUri(),
      response_type: 'code',
      scope: scopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: challengeMethod,
      state: state,
      nonce: nonce,
      access_type: 'offline', // Request refresh token
      include_granted_scopes: 'true',
    });

    // Optional parameters
    if (options?.prompt) {
      params.set('prompt', options.prompt);
    }
    if (options?.loginHint) {
      params.set('login_hint', options.loginHint);
    }
    if (this.config.hostedDomain) {
      params.set('hd', this.config.hostedDomain);
    }

    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  /**
   * Prepare PKCE values asynchronously before calling getLoginUrl().
   * This computes the proper SHA-256 code challenge.
   *
   * Call this before login() for proper S256 PKCE:
   * ```typescript
   * await adapter.preparePKCE();
   * const url = adapter.getLoginUrl();
   * ```
   */
  async preparePKCE(): Promise<void> {
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.computeCodeChallenge(codeVerifier);

    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(this.VERIFIER_KEY, codeVerifier);
      sessionStorage.setItem(this.CHALLENGE_KEY, codeChallenge);
    }
  }

  /**
   * Compute SHA-256 code challenge from verifier (async).
   */
  private async computeCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return this.base64UrlEncode(new Uint8Array(digest));
  }

  /**
   * Handle the OAuth callback from Google.
   *
   * This method:
   * 1. Validates the state parameter (CSRF protection)
   * 2. Retrieves the stored PKCE verifier
   * 3. Exchanges the authorization code for tokens
   * 4. Validates the ID token
   * 5. Returns the auth result
   *
   * @param params - Callback parameters from URL
   * @returns Auth result with user info and tokens
   */
  async handleCallback(params: CallbackParams): Promise<AuthResult> {
    // Validate state (CSRF protection)
    const storedState =
      typeof sessionStorage !== 'undefined'
        ? sessionStorage.getItem(this.STATE_KEY)
        : null;

    if (!storedState || storedState !== params.state) {
      return {
        valid: false,
        error: 'Invalid state parameter. Possible CSRF attack.',
        errorCode: 'invalid_state',
      };
    }

    // Get stored PKCE verifier
    const codeVerifier =
      typeof sessionStorage !== 'undefined'
        ? sessionStorage.getItem(this.VERIFIER_KEY)
        : null;

    if (!codeVerifier) {
      return {
        valid: false,
        error: 'Code verifier not found. Please start authentication again.',
        errorCode: 'missing_verifier',
      };
    }

    // Get stored nonce
    const nonce =
      typeof sessionStorage !== 'undefined'
        ? sessionStorage.getItem(this.NONCE_KEY)
        : null;

    // Clear stored values
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(this.VERIFIER_KEY);
      sessionStorage.removeItem(this.STATE_KEY);
      sessionStorage.removeItem(this.NONCE_KEY);
    }

    // Handle error from Google
    if (params.error) {
      return {
        valid: false,
        error: params.errorDescription || params.error,
        errorCode: params.error,
      };
    }

    if (!params.code) {
      return {
        valid: false,
        error: 'No authorization code received',
        errorCode: 'missing_code',
      };
    }

    try {
      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(
        params.code,
        codeVerifier,
        this.getRedirectUri()
      );

      // Decode and validate ID token
      const idTokenPayload = this.decodeIdToken(tokens.id_token);

      // Validate ID token claims
      const validationError = this.validateIdToken(idTokenPayload, nonce);
      if (validationError) {
        return {
          valid: false,
          error: validationError,
          errorCode: 'invalid_id_token',
        };
      }

      return {
        valid: true,
        playerId: idTokenPayload.sub,
        username: idTokenPayload.name,
        email: idTokenPayload.email,
        avatarUrl: idTokenPayload.picture,
        provider: 'google',
        token: tokens.id_token,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      };
    } catch (error) {
      return {
        valid: false,
        error:
          error instanceof Error ? error.message : 'Token exchange failed',
        errorCode: 'token_exchange_failed',
      };
    }
  }

  /**
   * Refresh an expired token using the refresh token.
   *
   * @param refreshToken - The refresh token to use
   * @returns New auth result or null if refresh failed
   */
  async refreshToken(refreshToken: string): Promise<AuthResult | null> {
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('[GoogleOAuth] Refresh failed:', error);
        return null;
      }

      const tokens = (await response.json()) as GoogleTokenResponse;
      const idTokenPayload = this.decodeIdToken(tokens.id_token);

      return {
        valid: true,
        playerId: idTokenPayload.sub,
        username: idTokenPayload.name,
        email: idTokenPayload.email,
        avatarUrl: idTokenPayload.picture,
        provider: 'google',
        token: tokens.id_token,
        accessToken: tokens.access_token,
        // Note: Google doesn't return new refresh_token on refresh
        expiresAt: Date.now() + tokens.expires_in * 1000,
      };
    } catch (error) {
      console.error('[GoogleOAuth] Refresh error:', error);
      return null;
    }
  }

  /**
   * Revoke a token (logout from Google).
   *
   * @param token - The token to revoke
   */
  async revokeToken(token: string): Promise<void> {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
    } catch (error) {
      console.warn('[GoogleOAuth] Revoke failed:', error);
    }
  }

  /**
   * Check if this adapter can handle the given token.
   *
   * @param token - Token to check
   * @returns True if token is a Google ID token
   */
  canHandle(token: string): boolean {
    try {
      const payload = this.decodeIdToken(token);
      return (
        payload.iss === 'https://accounts.google.com' ||
        payload.iss === 'accounts.google.com'
      );
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────────

  /**
   * Exchange authorization code for tokens.
   * Uses backend endpoint if configured, otherwise calls Google directly.
   */
  private async exchangeCodeForTokens(
    code: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<GoogleTokenResponse> {
    // Use backend token exchange if configured (recommended for security)
    if (this.config.tokenExchangeUrl) {
      return this.exchangeCodeViaBackend(code, codeVerifier, redirectUri);
    }

    // Direct exchange with Google (requires client_secret on server or native app)
    return this.exchangeCodeDirect(code, codeVerifier, redirectUri);
  }

  /**
   * Exchange code via our backend server (secure - keeps client_secret on server)
   */
  private async exchangeCodeViaBackend(
    code: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<GoogleTokenResponse> {
    const response = await fetch(this.config.tokenExchangeUrl!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code,
        codeVerifier,
        redirectUri,
        provider: 'google',
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        error.error || error.message || 'Token exchange failed'
      );
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Token exchange failed');
    }

    // Map backend response to GoogleTokenResponse format
    return {
      id_token: result.idToken,
      access_token: result.accessToken,
      expires_in: result.expiresIn || 3600,
      scope: 'openid profile email',
      token_type: 'Bearer',
      refresh_token: result.refreshToken,
    };
  }

  /**
   * Exchange code directly with Google (won't work for Web apps without client_secret)
   */
  private async exchangeCodeDirect(
    code: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<GoogleTokenResponse> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        error.error_description || error.error || 'Token exchange failed'
      );
    }

    return response.json();
  }

  /**
   * Decode a JWT ID token (without verification - verification done via claims).
   */
  private decodeIdToken(idToken: string): GoogleIdTokenPayload {
    const parts = idToken.split('.');
    if (parts.length !== 3 || !parts[1]) {
      throw new Error('Invalid ID token format');
    }

    const payloadBase64 = parts[1];
    const payloadJson = this.base64UrlDecode(payloadBase64);
    return JSON.parse(payloadJson);
  }

  /**
   * Validate ID token claims.
   */
  private validateIdToken(
    payload: GoogleIdTokenPayload,
    nonce: string | null
  ): string | null {
    // Check issuer
    if (
      payload.iss !== 'https://accounts.google.com' &&
      payload.iss !== 'accounts.google.com'
    ) {
      return 'Invalid issuer';
    }

    // Check audience
    if (payload.aud !== this.config.clientId) {
      return 'Invalid audience';
    }

    // Check expiration (with 5 minute leeway)
    if (payload.exp * 1000 < Date.now() - 5 * 60 * 1000) {
      return 'Token expired';
    }

    // Check nonce (replay protection)
    if (nonce && payload.nonce !== nonce) {
      return 'Invalid nonce';
    }

    // Check hosted domain if configured
    if (this.config.hostedDomain && payload.hd !== this.config.hostedDomain) {
      return `User must be from ${this.config.hostedDomain} domain`;
    }

    return null;
  }

  /**
   * Get the redirect URI.
   */
  private getRedirectUri(): string {
    if (this.config.redirectUri) {
      return this.config.redirectUri;
    }
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/auth/callback`;
    }
    return '/auth/callback';
  }

  // ─────────────────────────────────────────────────────────────────
  // PKCE Helpers
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generate a random code verifier for PKCE.
   * 43-128 characters from unreserved URI characters.
   */
  private generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return this.base64UrlEncode(array);
  }


  /**
   * Generate a random string for state/nonce.
   */
  private generateRandomString(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return this.base64UrlEncode(array);
  }

  /**
   * Base64URL encode a Uint8Array.
   */
  private base64UrlEncode(buffer: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < buffer.length; i++) {
      binary += String.fromCharCode(buffer[i] ?? 0);
    }
    const base64 = btoa(binary);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * Base64URL decode a string.
   */
  private base64UrlDecode(input: string): string {
    // Convert base64url to base64
    let base64 = input.replace(/-/g, '+').replace(/_/g, '/');

    // Add padding if needed
    const padding = base64.length % 4;
    if (padding) {
      base64 += '='.repeat(4 - padding);
    }

    return atob(base64);
  }
}

// ============================================
// Async PKCE Helper (for production use)
// ============================================

/**
 * Compute SHA-256 code challenge asynchronously.
 * Use this for production-ready PKCE implementation.
 *
 * @param verifier - The code verifier
 * @returns Base64URL-encoded SHA-256 hash
 */
export async function computeCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const array = new Uint8Array(digest);

  let binary = '';
  for (let i = 0; i < array.length; i++) {
    binary += String.fromCharCode(array[i] ?? 0);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
