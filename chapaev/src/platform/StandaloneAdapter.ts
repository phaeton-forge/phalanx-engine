import type { PlatformAdapter, SafeAreaInsets, AuthScheme, Platform } from './PlatformAdapter.ts';
import type { Language } from '../i18n/i18n.ts';
import {
  mapLanguageCode,
  defaultInviteShareUrl,
  consumeUrlRoomCode,
} from './platformUtils.ts';

const ZERO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

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

  async showFullscreenAd(): Promise<void> {
    // No ads in standalone.
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
    const KEY = 'chapaev_guest_id';
    try {
      const stored = localStorage.getItem(KEY);
      if (stored) return stored;
      const id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
      return id;
    } catch {
      // Private mode / storage blocked — fall back to in-memory id.
      return crypto.randomUUID();
    }
  }
}


