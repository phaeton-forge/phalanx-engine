import { StandaloneAdapter } from './StandaloneAdapter.ts';
import type { Platform } from './PlatformAdapter.ts';

/**
 * CapacitorAdapter — extends Standalone with Capacitor-specific integrations:
 * - Hardware back-button (Android) via `@capacitor/app`.
 * - Safe-area from Capacitor plugins if available.
 *
 * Detected when `window.Capacitor.isNativePlatform()` returns true.
 */
export class CapacitorAdapter extends StandaloneAdapter {
  override readonly platform: Platform = 'capacitor';

  private backButtonListeners: Array<() => void> = [];

  override async init(): Promise<void> {
    await super.init();

    // Dynamically import Capacitor App plugin to avoid bundling it on web.
    try {
      const { App } = await import('@capacitor/app');
      await (
        App as {
          addListener: (event: string, handler: () => void) => Promise<unknown>;
        }
      ).addListener('backButton', () => {
        if (this.backButtonListeners.length > 0) {
          const last =
            this.backButtonListeners[this.backButtonListeners.length - 1];
          last?.();
        }
      });
    } catch {
      // Plugin unavailable (e.g. running in browser with Capacitor mock).
    }
  }

  override onBackButton(handler: () => void): () => void {
    this.backButtonListeners.push(handler);
    return () => {
      this.backButtonListeners = this.backButtonListeners.filter(
        (l) => l !== handler
      );
    };
  }
}
