import type {
  PlatformAdapter,
  SafeAreaInsets,
  AuthScheme,
  Platform,
} from './PlatformAdapter.ts';
import type { Language } from '../i18n/i18n.ts';
import {
  mapLanguageCode,
  defaultInviteShareUrl,
  consumeUrlRoomCode,
} from './platformUtils.ts';

const ZERO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const GUEST_ID_KEY = 'chapaev_guest_id';

function createGuestUserId(): string {
  const cryptoApi = globalThis.crypto;

  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
  }

  return `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * StandaloneAdapter — no-op implementation for local browser dev.
 *
 * getUserId() returns a persistent random UUID stored in localStorage
 * (with an in-memory fallback for private/restricted contexts).
 */
export class StandaloneAdapter implements PlatformAdapter {
  readonly platform: Platform = 'standalone';

  private userId: string | null = null;
  private resumeListeners: Array<() => void> = [];
  private visibilityHandler: (() => void) | null = null;

  async init(): Promise<void> {
    this.userId = this.loadOrCreateUserId();

    // Forward visibility changes to onResume subscribers.
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        for (const cb of this.resumeListeners) cb();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  ready(): void {
    // Nothing to dismiss.
  }

  getUserId(): string | null {
    return this.userId;
  }

  getAuthScheme(): AuthScheme {
    return 'guest';
  }

  getAuthPayload(): string | null {
    return null;
  }

  getLanguage(): Language | null {
    return mapLanguageCode(navigator.language);
  }

  getLaunchRoomCode(): string | null {
    return consumeUrlRoomCode();
  }

  getInviteShareUrl(roomCode: string): string {
    return defaultInviteShareUrl(roomCode);
  }

  async tryShowFullscreenAd(_options: { blocking?: boolean } = {}): Promise<boolean> {
    return false;
  }

  hapticImpact(_style: 'light' | 'medium' | 'heavy'): void {
    // Vibration API as a best-effort fallback.
    try {
      navigator.vibrate?.(30);
    } catch {
      // ignore
    }
  }

  onBackButton(_handler: () => void): () => void {
    // No platform back-button; browser history handles navigation.
    return () => {};
  }

  getSafeAreaInsets(): SafeAreaInsets {
    return ZERO_INSETS;
  }

  onSafeAreaChange(_cb: (insets: SafeAreaInsets) => void): () => void {
    return () => {};
  }

  onResume(cb: () => void): () => void {
    this.resumeListeners.push(cb);
    return () => {
      this.resumeListeners = this.resumeListeners.filter((l) => l !== cb);
    };
  }

  setClosingConfirmation(_enabled: boolean): void {
    // Not applicable.
  }

  // ── Private ──────────────────────────────────────────────────────────

  private loadOrCreateUserId(): string {
    try {
      const stored = localStorage.getItem(GUEST_ID_KEY);
      if (stored) return stored;
      const id = createGuestUserId();
      localStorage.setItem(GUEST_ID_KEY, id);
      return id;
    } catch {
      // Private mode / storage blocked — fall back to in-memory id.
      return createGuestUserId();
    }
  }
}
