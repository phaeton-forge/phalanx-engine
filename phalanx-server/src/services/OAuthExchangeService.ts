/**
 * OAuth Token Exchange Service
 *
 * Handles server-side OAuth token exchange for secure authentication.
 * The client sends the authorization code, and we exchange it for tokens
 * using the client_secret which is kept secure on the server.
 */

import type { AuthConfig } from '../types/index.js';

// ============================================
// Types
// ============================================

export interface TokenExchangeRequest {
  /** Authorization code from OAuth provider */
  code: string;
  /** Code verifier for PKCE */
  codeVerifier: string;
  /** Redirect URI used in the authorization request */
  redirectUri: string;
  /** OAuth provider (currently only 'google') */
  provider: 'google';
}

export interface TokenExchangeResponse {
  /** Whether the exchange was successful */
  success: boolean;
  /** ID token (JWT) - the main auth token */
  idToken?: string;
  /** Access token for API calls */
  accessToken?: string;
  /** Token expiration in seconds */
  expiresIn?: number;
  /** Error message if failed */
  error?: string;
  /** Error code */
  errorCode?: string;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  id_token: string;
  refresh_token?: string;
  scope: string;
  token_type: 'Bearer';
}

interface GoogleTokenError {
  error: string;
  error_description?: string;
}

// ============================================
// OAuth Exchange Service
// ============================================

/**
 * Service for exchanging OAuth authorization codes for tokens.
 * Keeps client_secret secure on the server side.
 */
export class OAuthExchangeService {
  private config: AuthConfig;

  constructor(config: AuthConfig) {
    this.config = config;
  }

  /**
   * Exchange an authorization code for tokens.
   */
  async exchangeCode(request: TokenExchangeRequest): Promise<TokenExchangeResponse> {
    switch (request.provider) {
      case 'google':
        return this.exchangeGoogleCode(request);
      default:
        return {
          success: false,
          error: `Unsupported provider: ${request.provider}`,
          errorCode: 'unsupported_provider',
        };
    }
  }

  /**
   * Exchange a Google authorization code for tokens.
   */
  private async exchangeGoogleCode(request: TokenExchangeRequest): Promise<TokenExchangeResponse> {
    if (!this.config.google?.clientId) {
      return {
        success: false,
        error: 'Google OAuth not configured on server',
        errorCode: 'not_configured',
      };
    }

    if (!this.config.google?.clientSecret) {
      return {
        success: false,
        error: 'Google client_secret not configured on server',
        errorCode: 'missing_secret',
      };
    }

    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.config.google.clientId,
          client_secret: this.config.google.clientSecret,
          code: request.code,
          code_verifier: request.codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: request.redirectUri,
        }),
      });

      if (!response.ok) {
        const error = (await response.json()) as GoogleTokenError;
        console.error('[OAuthExchange] Google token exchange failed:', error);
        return {
          success: false,
          error: error.error_description || error.error || 'Token exchange failed',
          errorCode: error.error || 'exchange_failed',
        };
      }

      const tokens = (await response.json()) as GoogleTokenResponse;

      console.log('[OAuthExchange] Successfully exchanged code for tokens');

      return {
        success: true,
        idToken: tokens.id_token,
        accessToken: tokens.access_token,
        expiresIn: tokens.expires_in,
      };
    } catch (error) {
      console.error('[OAuthExchange] Error exchanging code:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Token exchange failed',
        errorCode: 'exchange_error',
      };
    }
  }
}
