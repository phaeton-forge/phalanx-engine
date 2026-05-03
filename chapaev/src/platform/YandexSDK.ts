/**
 * @deprecated Use PlatformAdapter / YandexAdapter instead.
 * This file is kept only for backwards-compatibility and will be removed.
 */

import type { Language } from '../i18n/i18n.ts';
import {
  ROOM_CODE_PATTERN,
  mapLanguageCode,
  defaultInviteShareUrl,
  resolveYandexGamesAppId,
} from './platformUtils.ts';

export function defaultPrivateRoomShareUrl(roomCode: string): string {
  return defaultInviteShareUrl(roomCode);
}

export interface IPlatformAds {
  showFullscreenAd(): Promise<void>;
  /** @deprecated Use getInviteShareUrl */
  getPrivateRoomShareUrl(roomCode: string): string;
  getInviteShareUrl(roomCode: string): string;
  /** @deprecated Use getLaunchRoomCode */
  getYandexLaunchRoomCode(): string | null;
  getLaunchRoomCode(): string | null;
}

export class NoopPlatformAds implements IPlatformAds {
  async showFullscreenAd(): Promise<void> {}

  getPrivateRoomShareUrl(roomCode: string): string {
    return defaultInviteShareUrl(roomCode);
  }

  getInviteShareUrl(roomCode: string): string {
    return defaultInviteShareUrl(roomCode);
  }

  getYandexLaunchRoomCode(): string | null {
    return null;
  }

  getLaunchRoomCode(): string | null {
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
    app?: { id?: string | number };
    payload?: string;
    i18n?: {
      lang?: string;
      tld?: string;
    };
  };
};

declare const YaGames: { init(): Promise<YandexSDKInstance> };

export class YandexSDK implements IPlatformAds {
  private ysdk: YandexSDKInstance | null = null;
  private detectedLanguage: Language | null = null;

  async init(): Promise<void> {
    const sdk = await YaGames.init();
    this.ysdk = sdk;
    this.ysdk.features?.LoadingAPI?.ready?.();
    this.detectedLanguage = mapLanguageCode(this.ysdk.environment?.i18n?.lang);
  }

  isAvailable(): boolean {
    return this.ysdk !== null;
  }

  getLanguage(): Language | null {
    return this.detectedLanguage;
  }

  getPrivateRoomShareUrl(roomCode: string): string {
    return this.getInviteShareUrl(roomCode);
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

  getYandexLaunchRoomCode(): string | null {
    return this.getLaunchRoomCode();
  }

  getLaunchRoomCode(): string | null {
    if (!this.ysdk) return null;
    const payload = this.ysdk.environment?.payload;
    if (typeof payload !== 'string' || payload.length === 0) return null;
    if (!ROOM_CODE_PATTERN.test(payload)) return null;
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
}

