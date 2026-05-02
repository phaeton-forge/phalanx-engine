import type { PlatformAdapter, SafeAreaInsets, AuthScheme } from './PlatformAdapter.ts';
import type { Language } from '../i18n/i18n.ts';
import {
  ROOM_CODE_PATTERN,
  mapLanguageCode,
  defaultInviteShareUrl,
  consumeUrlRoomCode,
} from './platformUtils.ts';

const ZERO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

type YandexSDKInstance = {
  adv?: {
    showFullscreenAdv?: (options: {
      callbacks?: {
        onOpen?: () => void;
        onClose?: () => void;
        onError?: (e?: unknown) => void;
        onOffline?: () => void;
      };
    }) => void;
  };
  features?: {
    LoadingAPI?: {
      ready?: () => void;
    };
  };
  environment?: {
    app?: { id?: string };
    payload?: string;
    i18n?: {
      lang?: string;
      tld?: string;
    };
  };
};

declare const YaGames: { init(): Promise<YandexSDKInstance> };

/**
 * YandexAdapter — wraps the Yandex Games SDK.
 *
 * The SDK script tag has been removed from index.html.
 * Instead, `init()` injects it dynamically so the ~80 KB SDK script is
 * NEVER downloaded when the game runs under Telegram or in standalone mode.
 */
export class YandexAdapter implements PlatformAdapter {
  readonly platform = 'yandex' as const;

  private ysdk: YandexSDKInstance | null = null;
  private detectedLanguage: Language | null = null;
  private resumeListeners: Array<() => void> = [];
  private visibilityHandler: (() => void) | null = null;

  async init(): Promise<void> {
    await this.injectSDKScript();

    this.ysdk = await YaGames.init();
    this.ysdk.features?.LoadingAPI?.ready?.();
    this.detectedLanguage = mapLanguageCode(this.ysdk.environment?.i18n?.lang);

    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        for (const cb of this.resumeListeners) cb();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  ready(): void {
    // Yandex uses LoadingAPI.ready() (called in init); nothing extra here.
  }

  getUserId(): string | null {
    return null; // Yandex player auth is a separate flow not yet integrated.
  }

  getAuthScheme(): AuthScheme {
    return 'yandex';
  }

  getAuthPayload(): string | null {
    return null;
  }

  getLanguage(): Language | null {
    return this.detectedLanguage;
  }

  getLaunchRoomCode(): string | null {
    if (!this.ysdk) return consumeUrlRoomCode();
    const payload = this.ysdk.environment?.payload;
    if (typeof payload !== 'string' || payload.length === 0) return null;
    if (!ROOM_CODE_PATTERN.test(payload)) return null;
    return payload.toUpperCase();
  }

  getInviteShareUrl(roomCode: string): string {
    const normalized = roomCode.trim().toUpperCase();
    if (!this.ysdk) return defaultInviteShareUrl(normalized);

    const appId = this.ysdk.environment?.app?.id;
    if (typeof appId !== 'string' || appId.length === 0) {
      return defaultInviteShareUrl(normalized);
    }
    const tld = this.ysdk.environment?.i18n?.tld ?? 'ru';
    return `https://yandex.${tld}/games/app/${appId}?payload=${encodeURIComponent(normalized)}`;
  }

  async showFullscreenAd(): Promise<void> {
    if (!this.ysdk) return;

    await new Promise<void>((resolve) => {
      try {
        const show = this.ysdk!.adv?.showFullscreenAdv;
        if (!show) {
          resolve();
          return;
        }
        show({
          callbacks: {
            onClose: resolve,
            onError: () => resolve(),
          },
        });
      } catch {
        resolve();
      }
    });
  }

  hapticImpact(_style: 'light' | 'medium' | 'heavy'): void {
    try {
      navigator.vibrate?.(30);
    } catch {
      // ignore
    }
  }

  onBackButton(_handler: () => void): () => void {
    // Yandex Games has no back-button concept.
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
    // Not applicable on Yandex.
  }

  // ── Private ────────────────────────────────────────────────────────

  private injectSDKScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Already loaded (e.g. hot-reload in dev).
      if (typeof YaGames !== 'undefined') {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://yandex.ru/games/sdk/v2';
      script.onload = () => resolve();
      script.onerror = () =>
        reject(new Error('Failed to load Yandex Games SDK script'));
      document.head.appendChild(script);
    });
  }
}


