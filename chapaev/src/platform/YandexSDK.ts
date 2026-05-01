declare const YaGames: any;
import type { Language } from '../i18n/i18n.ts';

/** Room code in Yandex Games launch `payload` (matches server private-room format). */
const YANDEX_ROOM_PAYLOAD = /^[a-z0-9]{4,12}$/i;

export function defaultPrivateRoomShareUrl(roomCode: string): string {
  const normalized = roomCode.trim().toUpperCase();
  return `${window.location.origin}${window.location.pathname}?ROOM=${encodeURIComponent(normalized)}`;
}

export interface IPlatformAds {
  showFullscreenAd(): Promise<void>;
  /** Invite link for private rooms — Yandex portal URL when running inside Games SDK. */
  getPrivateRoomShareUrl(roomCode: string): string;
  /** Deep link from Yandex Games `environment.payload` when opening a shared invite. */
  getYandexLaunchRoomCode(): string | null;
}

export class NoopPlatformAds implements IPlatformAds {
  async showFullscreenAd(): Promise<void> {}

  getPrivateRoomShareUrl(roomCode: string): string {
    return defaultPrivateRoomShareUrl(roomCode);
  }

  getYandexLaunchRoomCode(): string | null {
    return null;
  }
}

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

export class YandexSDK implements IPlatformAds {
  private ysdk: YandexSDKInstance | null = null;
  private detectedLanguage: Language | null = null;

  async init(): Promise<void> {
    const sdk = (await YaGames.init()) as YandexSDKInstance;
    this.ysdk = sdk;
    this.ysdk.features?.LoadingAPI?.ready?.();
    this.detectedLanguage = this.mapLanguageCode(this.ysdk.environment?.i18n?.lang);
  }

  isAvailable(): boolean {
    return this.ysdk !== null;
  }

  getLanguage(): Language | null {
    return this.detectedLanguage;
  }

  getPrivateRoomShareUrl(roomCode: string): string {
    const normalized = roomCode.trim().toUpperCase();
    if (!this.ysdk) {
      return defaultPrivateRoomShareUrl(normalized);
    }
    const appId = this.ysdk.environment?.app?.id;
    if (typeof appId !== 'string' || appId.length === 0) {
      return defaultPrivateRoomShareUrl(normalized);
    }
    const tld = this.ysdk.environment?.i18n?.tld ?? 'ru';
    return `https://yandex.${tld}/games/app/${appId}?payload=${encodeURIComponent(normalized)}`;
  }

  getYandexLaunchRoomCode(): string | null {
    if (!this.ysdk) return null;
    const payload = this.ysdk.environment?.payload;
    if (typeof payload !== 'string' || payload.length === 0) return null;
    if (!YANDEX_ROOM_PAYLOAD.test(payload)) return null;
    return payload.toUpperCase();
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
            onClose: () => resolve(),
            onError: () => resolve(),
          },
        });
      } catch {
        resolve();
      }
    });
  }

  private mapLanguageCode(code: string | undefined): Language | null {
    if (!code) return null;
    const normalized = code.toLowerCase();
    if (normalized.startsWith('ru')) return 'ru';
    if (normalized.startsWith('en')) return 'en';
    return 'en';
  }
}

