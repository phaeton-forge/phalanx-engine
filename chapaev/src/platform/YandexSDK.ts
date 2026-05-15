/**
 * @deprecated Use PlatformAdapter / YandexAdapter instead.
 * This file is kept only for backwards-compatibility and will be removed.
 */

import type { Language } from '../i18n/i18n.ts';
import type { SDK as YandexSDKInstance } from 'ysdk';
import {
  ROOM_CODE_PATTERN,
  mapLanguageCode,
  defaultInviteShareUrl,
  resolveYandexGamesAppId,
} from './platformUtils.ts';
import { FullscreenAdGate } from './FullscreenAdGate.ts';

export function defaultPrivateRoomShareUrl(roomCode: string): string {
  return defaultInviteShareUrl(roomCode);
}

export interface IPlatformAds {
  tryShowFullscreenAd(): Promise<boolean>;
  /** @deprecated Use getInviteShareUrl */
  getPrivateRoomShareUrl(roomCode: string): string;
  getInviteShareUrl(roomCode: string): string;
  /** @deprecated Use getLaunchRoomCode */
  getYandexLaunchRoomCode(): string | null;
  getLaunchRoomCode(): string | null;
}

export class NoopPlatformAds implements IPlatformAds {
  async tryShowFullscreenAd(): Promise<boolean> {
    return false;
  }

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

export class YandexSDK implements IPlatformAds {
  private ysdk: YandexSDKInstance | null = null;
  private readonly fullscreenAdGate = new FullscreenAdGate();
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

  async tryShowFullscreenAd(): Promise<boolean> {
    if (!this.ysdk) return false;
    if (!this.fullscreenAdGate.canShow()) return false;

    const shown = await new Promise<boolean>((resolve) => {
      try {
        const show = this.ysdk!.adv?.showFullscreenAdv;
        if (!show) {
          resolve(false);
          return;
        }

        show({
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
}

