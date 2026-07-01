import type { PlatformAdapter, SafeAreaInsets, AuthScheme } from './PlatformAdapter.ts';
import type { Language } from '../i18n/i18n.ts';
import type { SDK as YandexSDKInstance } from 'ysdk';
import {
  ROOM_CODE_PATTERN,
  mapLanguageCode,
  defaultInviteShareUrl,
  consumeUrlRoomCode,
  resolveYandexGamesAppId,
} from './platformUtils.ts';
import { FullscreenAdGate } from './FullscreenAdGate.ts';

const ZERO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const YANDEX_SDK_SCRIPT_ID = 'yandex-games-sdk';
const YANDEX_SDK_SRC = '/sdk.js';

let yandexSDKScriptPromise: Promise<void> | null = null;

/**
 * YandexAdapter — wraps the Yandex Games SDK.
 *
 * The SDK is loaded from the documented `/sdk.js` loader endpoint only when
 * the game runs under Yandex Games.
 */
export class YandexAdapter implements PlatformAdapter {
  readonly platform = 'yandex' as const;

  private ysdk: YandexSDKInstance | null = null;
  private readonly fullscreenAdGate = new FullscreenAdGate();
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
    const appId = resolveYandexGamesAppId(this.ysdk?.environment);
    if (!appId) {
      return defaultInviteShareUrl(normalized);
    }
    const tld = this.ysdk?.environment?.i18n?.tld ?? 'ru';
    return `https://yandex.${tld}/games/app/${appId}?payload=${encodeURIComponent(normalized)}`;
  }

  async tryShowFullscreenAd(_options: { blocking?: boolean } = {}): Promise<boolean> {
    // Yandex's showFullscreenAdv already resolves via onClose — effectively
    // always "blocking". The `blocking` option is ignored here on purpose.
    console.log('[YandexAds] tryShowFullscreenAd');
    if (!this.ysdk) return false;
    if (!this.fullscreenAdGate.canShow()) return false;

    const shown = await new Promise<boolean>((resolve) => {
      try {
        const show = this.ysdk!.adv?.showFullscreenAdv;
        if (!show) {
          console.warn('[YandexAds] fullscreen showFullscreenAdv not available');
          resolve(false);
          return;
        }
        console.log('[YandexAds] fullscreen showFullscreenAdv');
        this.ysdk!.adv?.showFullscreenAdv?.({
          callbacks: {
            onOpen: () => {
              console.log('[YandexAds] fullscreen onOpen');
            },
            onClose: (wasShown?: boolean) => {
              console.log('[YandexAds] fullscreen onClose', { wasShown });
              resolve(wasShown === true);
            },
            onError: (e?: unknown) => {
              console.warn('[YandexAds] fullscreen onError', e);
              resolve(false);
            },
            onOffline: () => {
              console.warn('[YandexAds] fullscreen onOffline');
              resolve(false);
            },
          },
        });
      } catch (e) {
        console.warn('[YandexAds] fullscreen showFullscreenAdv threw', e);
        resolve(false);
      }
    });
    if (shown) this.fullscreenAdGate.recordShown();
    return shown;
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
    // Already loaded (e.g. hot-reload in dev).
    if (typeof YaGames !== 'undefined') {
      return Promise.resolve();
    }

    if (yandexSDKScriptPromise) {
      return yandexSDKScriptPromise;
    }

    yandexSDKScriptPromise = new Promise((resolve, reject) => {
      const existing = document.getElementById(YANDEX_SDK_SCRIPT_ID);
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => rejectSDKLoad(reject), {
          once: true,
        });
        return;
      }

      const script = document.createElement('script');
      script.id = YANDEX_SDK_SCRIPT_ID;
      script.async = true;
      script.src = YANDEX_SDK_SRC;
      script.onload = () => resolve();
      script.onerror = () => rejectSDKLoad(reject);
      document.head.appendChild(script);
    });

    return yandexSDKScriptPromise;
  }
}

function rejectSDKLoad(reject: (reason?: unknown) => void): void {
  yandexSDKScriptPromise = null;
  reject(new Error('Failed to load Yandex Games SDK script'));
}


