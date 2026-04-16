/**
 * Auth Module Tests
 *
 * Unit tests for the Phalanx auth module.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AuthManager,
  GoogleOAuthAdapter,
  MemoryStorageAdapter,
} from '../src/index.js';
import type { AuthState, GoogleOAuthConfig } from '../src/index.js';

// ============================================
// Test Helpers
// ============================================

const mockGoogleConfig: GoogleOAuthConfig = {
  clientId: 'test-client-id.apps.googleusercontent.com',
  redirectUri: 'http://localhost:3000/auth/callback',
};

// Mock sessionStorage for Node.js environment
const mockSessionStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

// Setup global mocks
beforeEach(() => {
  vi.stubGlobal('sessionStorage', mockSessionStorage);
  mockSessionStorage.clear();
});

// ============================================
// GoogleOAuthAdapter Tests
// ============================================

describe('GoogleOAuthAdapter', () => {
  describe('constructor', () => {
    it('should create adapter with config', () => {
      const adapter = new GoogleOAuthAdapter(mockGoogleConfig);
      expect(adapter.provider).toBe('google');
    });

    it('should use default scopes', () => {
      const adapter = new GoogleOAuthAdapter(mockGoogleConfig);
      const url = adapter.getLoginUrl();
      // URLSearchParams encodes spaces as + (which is valid)
      expect(url).toContain('scope=openid+profile+email');
    });

    it('should allow custom scopes', () => {
      const adapter = new GoogleOAuthAdapter({
        ...mockGoogleConfig,
        scopes: ['openid', 'profile', 'email', 'https://www.googleapis.com/auth/calendar'],
      });
      const url = adapter.getLoginUrl();
      expect(url).toContain('googleapis.com%2Fauth%2Fcalendar');
    });
  });

  describe('getLoginUrl', () => {
    it('should generate valid Google OAuth URL', () => {
      const adapter = new GoogleOAuthAdapter(mockGoogleConfig);
      const url = adapter.getLoginUrl();

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url).toContain('client_id=test-client-id.apps.googleusercontent.com');
      expect(url).toContain('response_type=code');
      expect(url).toContain('redirect_uri=');
    });

    it('should include PKCE parameters', async () => {
      const adapter = new GoogleOAuthAdapter(mockGoogleConfig);
      await adapter.preparePKCE();
      const url = adapter.getLoginUrl();

      expect(url).toContain('code_challenge=');
      expect(url).toContain('code_challenge_method=S256');
    });

    it('should include state parameter', () => {
      const adapter = new GoogleOAuthAdapter(mockGoogleConfig);
      const url = adapter.getLoginUrl();

      expect(url).toContain('state=');
    });

    it('should store PKCE values in sessionStorage', () => {
      const adapter = new GoogleOAuthAdapter(mockGoogleConfig);
      adapter.getLoginUrl();

      expect(mockSessionStorage.getItem('phalanx_google_verifier')).not.toBeNull();
      expect(mockSessionStorage.getItem('phalanx_google_state')).not.toBeNull();
      expect(mockSessionStorage.getItem('phalanx_google_nonce')).not.toBeNull();
    });

    it('should respect custom state', () => {
      const adapter = new GoogleOAuthAdapter(mockGoogleConfig);
      const url = adapter.getLoginUrl({ state: 'custom-state' });

      expect(url).toContain('state=custom-state');
    });

    it('should include prompt parameter when provided', () => {
      const adapter = new GoogleOAuthAdapter(mockGoogleConfig);
      const url = adapter.getLoginUrl({ prompt: 'select_account' });

      expect(url).toContain('prompt=select_account');
    });

    it('should include login_hint when provided', () => {
      const adapter = new GoogleOAuthAdapter(mockGoogleConfig);
      const url = adapter.getLoginUrl({ loginHint: 'user@example.com' });

      expect(url).toContain('login_hint=user%40example.com');
    });

    it('should include hosted domain when configured', () => {
      const adapter = new GoogleOAuthAdapter({
        ...mockGoogleConfig,
        hostedDomain: 'example.com',
      });
      const url = adapter.getLoginUrl();

      expect(url).toContain('hd=example.com');
    });
  });

  describe('handleCallback', () => {
    it('should reject invalid state', async () => {
      const adapter = new GoogleOAuthAdapter(mockGoogleConfig);
      adapter.getLoginUrl(); // Generate state

      const result = await adapter.handleCallback({
        code: 'auth-code',
        state: 'wrong-state',
      });

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('invalid_state');
    });

    it('should reject missing verifier', async () => {
      const adapter = new GoogleOAuthAdapter(mockGoogleConfig);
      mockSessionStorage.setItem('phalanx_google_state', 'test-state');
      // Note: no verifier stored

      const result = await adapter.handleCallback({
        code: 'auth-code',
        state: 'test-state',
      });

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('missing_verifier');
    });

    it('should handle error from Google', async () => {
      const adapter = new GoogleOAuthAdapter(mockGoogleConfig);
      adapter.getLoginUrl();
      const state = mockSessionStorage.getItem('phalanx_google_state');

      const result = await adapter.handleCallback({
        state: state ?? undefined,
        error: 'access_denied',
        errorDescription: 'User denied access',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe('User denied access');
      expect(result.errorCode).toBe('access_denied');
    });

    it('should reject missing code', async () => {
      const adapter = new GoogleOAuthAdapter(mockGoogleConfig);
      adapter.getLoginUrl();
      const state = mockSessionStorage.getItem('phalanx_google_state');

      const result = await adapter.handleCallback({
        state: state ?? undefined,
      });

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('missing_code');
    });
  });

  describe('canHandle', () => {
    it('should return true for Google ID tokens', () => {
      const adapter = new GoogleOAuthAdapter(mockGoogleConfig);

      // Create a mock Google ID token (just the payload matters for canHandle)
      const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const payload = btoa(
        JSON.stringify({
          iss: 'https://accounts.google.com',
          sub: '123',
        })
      );
      const signature = 'fake-signature';
      const token = `${header}.${payload}.${signature}`;

      expect(adapter.canHandle(token)).toBe(true);
    });

    it('should return false for non-Google tokens', () => {
      const adapter = new GoogleOAuthAdapter(mockGoogleConfig);

      const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const payload = btoa(
        JSON.stringify({
          iss: 'https://other-provider.com',
          sub: '123',
        })
      );
      const signature = 'fake-signature';
      const token = `${header}.${payload}.${signature}`;

      expect(adapter.canHandle(token)).toBe(false);
    });

    it('should return false for invalid tokens', () => {
      const adapter = new GoogleOAuthAdapter(mockGoogleConfig);
      expect(adapter.canHandle('not-a-jwt')).toBe(false);
    });
  });
});

// ============================================
// AuthManager Tests
// ============================================

describe('AuthManager', () => {
  describe('constructor', () => {
    it('should create manager with Google config', () => {
      const manager = new AuthManager({
        provider: 'google',
        google: mockGoogleConfig,
        storage: new MemoryStorageAdapter(),
      });

      expect(manager.getProvider()).toBe('google');
    });

    it('should throw without provider config', () => {
      expect(() => {
        new AuthManager({
          provider: 'google',
          // Missing google config
        } as any);
      }).toThrow('Google config required');
    });

    it('should throw for unsupported providers', () => {
      expect(() => {
        new AuthManager({
          provider: 'discord',
          discord: {
            clientId: 'test',
            tokenExchangeEndpoint: 'http://localhost/token',
          },
        });
      }).toThrow('Discord OAuth adapter not implemented yet');
    });
  });

  describe('getState', () => {
    it('should return initial state', () => {
      const manager = new AuthManager({
        provider: 'google',
        google: mockGoogleConfig,
        storage: new MemoryStorageAdapter(),
      });

      const state = manager.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(true);
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
    });
  });

  describe('checkSession', () => {
    it('should return false when no session exists', async () => {
      const manager = new AuthManager({
        provider: 'google',
        google: mockGoogleConfig,
        storage: new MemoryStorageAdapter(),
      });

      const hasSession = await manager.checkSession();
      expect(hasSession).toBe(false);
    });

    it('should restore valid session', async () => {
      const storage = new MemoryStorageAdapter();
      await storage.set({
        user: {
          id: 'user-123',
          username: 'Test User',
          email: 'test@example.com',
          provider: 'google',
        },
        token: 'valid-token',
        expiresAt: Date.now() + 3600000, // 1 hour from now
        provider: 'google',
      });

      const manager = new AuthManager({
        provider: 'google',
        google: mockGoogleConfig,
        storage,
      });

      const hasSession = await manager.checkSession();
      expect(hasSession).toBe(true);
      expect(manager.isAuthenticated()).toBe(true);
      expect(manager.getToken()).toBe('valid-token');
      expect(manager.getUser()?.id).toBe('user-123');
    });

    it('should clear expired session without refresh token', async () => {
      const storage = new MemoryStorageAdapter();
      await storage.set({
        user: {
          id: 'user-123',
          username: 'Test User',
          provider: 'google',
        },
        token: 'expired-token',
        expiresAt: Date.now() - 1000, // Expired
        provider: 'google',
      });

      const manager = new AuthManager({
        provider: 'google',
        google: mockGoogleConfig,
        storage,
      });

      const hasSession = await manager.checkSession();
      expect(hasSession).toBe(false);
      expect(manager.isAuthenticated()).toBe(false);
    });
  });

  describe('logout', () => {
    it('should clear session', async () => {
      const storage = new MemoryStorageAdapter();
      await storage.set({
        user: {
          id: 'user-123',
          username: 'Test User',
          provider: 'google',
        },
        token: 'valid-token',
        expiresAt: Date.now() + 3600000,
        provider: 'google',
      });

      const manager = new AuthManager({
        provider: 'google',
        google: mockGoogleConfig,
        storage,
      });

      await manager.checkSession();
      expect(manager.isAuthenticated()).toBe(true);

      await manager.logout();
      expect(manager.isAuthenticated()).toBe(false);
      expect(manager.getToken()).toBeNull();
      expect(await storage.get()).toBeNull();
    });
  });

  describe('onAuthStateChange', () => {
    it('should call callback on state change', async () => {
      const stateChanges: AuthState[] = [];

      const storage = new MemoryStorageAdapter();
      await storage.set({
        user: {
          id: 'user-123',
          username: 'Test User',
          provider: 'google',
        },
        token: 'valid-token',
        expiresAt: Date.now() + 3600000,
        provider: 'google',
      });

      const manager = new AuthManager({
        provider: 'google',
        google: mockGoogleConfig,
        storage,
        onAuthStateChange: (state) => {
          stateChanges.push({ ...state });
        },
      });

      await manager.checkSession();

      expect(stateChanges.length).toBeGreaterThan(0);
      const lastState = stateChanges[stateChanges.length - 1];
      expect(lastState).toBeDefined();
      expect(lastState!.isAuthenticated).toBe(true);
    });
  });

  describe('getLoginUrl', () => {
    it('should return login URL', () => {
      const manager = new AuthManager({
        provider: 'google',
        google: mockGoogleConfig,
        storage: new MemoryStorageAdapter(),
      });

      const url = manager.getLoginUrl();
      expect(url).toContain('https://accounts.google.com');
    });
  });
});

// ============================================
// MemoryStorageAdapter Tests
// ============================================

describe('MemoryStorageAdapter', () => {
  it('should store and retrieve data', async () => {
    const storage = new MemoryStorageAdapter();
    const data = {
      user: { id: '123', provider: 'google' },
      token: 'test-token',
      provider: 'google',
    };

    await storage.set(data);
    const retrieved = await storage.get();

    expect(retrieved).toEqual(data);
  });

  it('should return null when empty', async () => {
    const storage = new MemoryStorageAdapter();
    const data = await storage.get();
    expect(data).toBeNull();
  });

  it('should clear data', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set({
      user: { id: '123', provider: 'google' },
      token: 'test-token',
      provider: 'google',
    });

    await storage.clear();
    const data = await storage.get();

    expect(data).toBeNull();
  });
});
