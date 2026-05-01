declare const YaGames: any;
import type { Language } from '../i18n/i18n.ts';

export interface IPlatformAds {
  showFullscreenAd(): Promise<void>;
}

export class NoopPlatformAds implements IPlatformAds {
  async showFullscreenAd(): Promise<void> {}
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

