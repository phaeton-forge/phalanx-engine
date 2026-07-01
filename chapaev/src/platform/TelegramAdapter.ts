/**
 * TelegramAdapter — wraps @telegram-apps/sdk v2.
 *
 * Design rules:
 * - All SDK calls are async-safe and wrapped in try/catch.
 * - No SDK call is ever made from ECS Simulation.step() / System.update().
 * - `ready()` is called externally after the first game frame is rendered.
 */
import {
  init,
  // viewport
  mountViewport,
  expandViewport,
  requestFullscreen,
  viewportSafeAreaInsets,
  viewportContentSafeAreaInsets,
  // swipe behavior
  mountSwipeBehavior,
  disableVerticalSwipes,
  // mini-app
  mountMiniApp,
  miniAppReady,
  // closing behavior
  mountClosingBehavior,
  enableClosingConfirmation,
  disableClosingConfirmation,
  // back button
  mountBackButton,
  showBackButton,
  hideBackButton,
  onBackButtonClick,
  // haptic feedback
  hapticFeedbackImpactOccurred,
  isHapticFeedbackSupported,
  // init data
  restoreInitData,
  initDataUser,
  initDataRaw,
  initDataStartParam,
  // boot
  retrieveLaunchParams,
} from '@telegram-apps/sdk';
import type { PlatformAdapter, SafeAreaInsets, AuthScheme } from './PlatformAdapter.ts';
import type { Language } from '../i18n/i18n.ts';
import { ROOM_CODE_PATTERN, mapLanguageCode } from './platformUtils.ts';
import { FullscreenAdGate } from './FullscreenAdGate.ts';
import {
  loadMonetagSDK,
  preloadMonetagInterstitial,
  showMonetagInterstitial,
} from './MonetagSDK.ts';

/** Telegram Desktop platform identifiers that lack fullscreen support. */
const DESKTOP_PLATFORMS = new Set(['tdesktop', 'macos', 'weba', 'webk', 'web']);

/**
 * Combine Telegram's safe-area and content-safe-area insets by taking
 * the larger value on each side (e.g. notch vs bottom bar).
 */
function mergeInsets(
  sai: { top: number; right: number; bottom: number; left: number },
  csai: { top: number; right: number; bottom: number; left: number }
): SafeAreaInsets {
  return {
    top: Math.max(sai.top, csai.top),
    right: Math.max(sai.right, csai.right),
    bottom: Math.max(sai.bottom, csai.bottom),
    left: Math.max(sai.left, csai.left),
  };
}

export class TelegramAdapter implements PlatformAdapter {
  readonly platform = 'telegram' as const;

  /** Refcount for back-button show/hide — supports nested screens. */
  private backButtonRefCount = 0;
  private safeAreaListeners: Array<(insets: SafeAreaInsets) => void> = [];
  private resumeListeners: Array<() => void> = [];
  private visibilityHandler: (() => void) | null = null;

  // ── Monetag ads ────────────────────────────────────────────────────
  private readonly fullscreenAdGate = new FullscreenAdGate();
  private monetagReady = false;
  private monetagZoneId: string | null = null;
  private monetagLoadPromise: Promise<void> | null = null;
  // Unsub functions are retained so GC doesn't collect the signals.
  // They would be used in a dispose() path if added in the future.
  private readonly _unsubSafeArea: (() => void)[] = [];

  async init(): Promise<void> {
    // Step 1: Boot the SDK.
    init();

    // Step 2: Mount viewport and request fullscreen.
    await mountViewport();
    expandViewport();

    const lp = retrieveLaunchParams();
    const isDesktop = DESKTOP_PLATFORMS.has(lp.platform ?? '');

    if (!isDesktop && requestFullscreen.isAvailable()) {
      try {
        await requestFullscreen();
      } catch {
        // requestFullscreen rejected (old client / Bot API < 8.0) — continue
        // with expand() only. Non-fatal.
      }
    }

    // Step 3: Disable vertical swipe — mandatory to prevent accidental app close.
    if (mountSwipeBehavior.isAvailable()) {
      mountSwipeBehavior();
      disableVerticalSwipes();
    }

    // Step 4: Mount components.
    if (mountMiniApp.isAvailable()) mountMiniApp();
    if (mountBackButton.isAvailable()) mountBackButton();
    if (mountClosingBehavior.isAvailable()) mountClosingBehavior();

    // Step 5: Restore cached init data.
    restoreInitData();

    // Step 6: Subscribe to safe-area signal changes.
    this._unsubSafeArea.push(
      viewportSafeAreaInsets.sub(() => { this.emitSafeAreaChange(); }),
      viewportContentSafeAreaInsets.sub(() => { this.emitSafeAreaChange(); })
    );

    // Step 7: Re-request fullscreen on resume (network reconnect, tab switch).
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        if (!isDesktop && requestFullscreen.isAvailable()) {
          requestFullscreen().catch(() => {});
        }
        for (const cb of this.resumeListeners) cb();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    // Step 8: Kick off Monetag SDK load in the background — ads are
    // best-effort and must not delay app startup. The first tryShowFullscreenAd()
    // call awaits this promise before invoking the SDK.
    // Zone must be a Rewarded Interstitial zone in Monetag's dashboard — we
    // invoke it via `type: 'start'`, which shows a full-screen ad but resolves
    // as soon as the ad appears, without waiting for a reward-CTA click.
    const zoneId = (
      (import.meta.env['VITE_MONETAG_ZONE_ID'] as string | undefined) ?? ''
    ).trim();

    if (zoneId.length > 0) {
      this.monetagZoneId = zoneId;
      this.monetagLoadPromise = loadMonetagSDK(zoneId)
        .then(() => {
          this.monetagReady = true;
          console.log('[MonetagAds] SDK loaded', { zoneId });
          // Warm the cache so the first ad shows instantly.
          preloadMonetagInterstitial(zoneId);
        })
        .catch((e: unknown) => {
          console.warn('[MonetagAds] SDK load failed — ads disabled', e);
        });
    } else {
      console.log('[MonetagAds] no zone id configured, ads disabled');
    }
  }

  /** Call after the first game frame is rendered to hide Telegram's loading splash. */
  ready(): void {
    try {
      if (miniAppReady.isAvailable()) miniAppReady();
    } catch {
      // ignore
    }
  }

  getUserId(): string | null {
    try {
      return initDataUser()?.id?.toString() ?? null;
    } catch {
      return null;
    }
  }

  getAuthScheme(): AuthScheme {
    try {
      const raw = initDataRaw();
      return raw && raw.length > 0 ? 'telegram' : 'guest';
    } catch {
      return 'guest';
    }
  }

  getAuthPayload(): string | null {
    try {
      return initDataRaw() ?? null;
    } catch {
      return null;
    }
  }

  getLanguage(): Language | null {
    try {
      return mapLanguageCode(initDataUser()?.languageCode);
    } catch {
      return null;
    }
  }

  getLaunchRoomCode(): string | null {
    try {
      const param = initDataStartParam();
      if (typeof param !== 'string' || param.length === 0) return null;
      if (!ROOM_CODE_PATTERN.test(param)) return null;
      return param.toUpperCase();
    } catch {
      return null;
    }
  }

  getInviteShareUrl(roomCode: string): string {
    const code = roomCode.trim().toUpperCase();
    const bot = import.meta.env['VITE_TELEGRAM_BOT'] as string | undefined;
    const app = import.meta.env['VITE_TELEGRAM_APP'] as string | undefined;
    if (bot && app) {
      return `https://t.me/${bot}/${app}?startapp=${encodeURIComponent(code)}`;
    }
    // Fallback: deep link without app path.
    return `https://t.me/${bot ?? 'your_bot'}?start=${encodeURIComponent(code)}`;
  }

  async tryShowFullscreenAd(options: { blocking?: boolean } = {}): Promise<boolean> {
    if (!this.monetagZoneId) return false;
    // Wait for the background SDK load kicked off in init() — the first ad
    // call may land before load completes.
    if (!this.monetagReady && this.monetagLoadPromise) {
      await this.monetagLoadPromise;
    }
    if (!this.monetagReady) return false;
    if (!this.fullscreenAdGate.canShow()) return false;

    console.log('[MonetagAds] tryShowFullscreenAd', options);
    const shown = await showMonetagInterstitial(this.monetagZoneId, options);
    if (shown) {
      this.fullscreenAdGate.recordShown();
      // Preload the next creative so subsequent calls stay instant.
      preloadMonetagInterstitial(this.monetagZoneId);
    }
    return shown;
  }

  hapticImpact(style: 'light' | 'medium' | 'heavy'): void {
    try {
      if (isHapticFeedbackSupported() && hapticFeedbackImpactOccurred.isAvailable()) {
        hapticFeedbackImpactOccurred(style);
      }
    } catch {
      // Older clients may throw ERR_UNKNOWN_ENV or ERR_NOT_SUPPORTED.
    }
  }

  onBackButton(handler: () => void): () => void {
    this.backButtonRefCount++;
    if (this.backButtonRefCount === 1 && showBackButton.isAvailable()) {
      showBackButton();
    }

    let off: (() => void) | null = null;
    if (onBackButtonClick.isAvailable()) {
      off = onBackButtonClick(handler);
    }

    return () => {
      off?.();
      this.backButtonRefCount = Math.max(0, this.backButtonRefCount - 1);
      if (this.backButtonRefCount === 0 && hideBackButton.isAvailable()) {
        hideBackButton();
      }
    };
  }

  getSafeAreaInsets(): SafeAreaInsets {
    try {
      return mergeInsets(viewportSafeAreaInsets(), viewportContentSafeAreaInsets());
    } catch {
      return { top: 0, right: 0, bottom: 0, left: 0 };
    }
  }

  onSafeAreaChange(cb: (insets: SafeAreaInsets) => void): () => void {
    this.safeAreaListeners.push(cb);
    return () => {
      this.safeAreaListeners = this.safeAreaListeners.filter((l) => l !== cb);
    };
  }

  onResume(cb: () => void): () => void {
    this.resumeListeners.push(cb);
    return () => {
      this.resumeListeners = this.resumeListeners.filter((l) => l !== cb);
    };
  }

  setClosingConfirmation(enabled: boolean): void {
    try {
      if (enabled && enableClosingConfirmation.isAvailable()) {
        enableClosingConfirmation();
      } else if (!enabled && disableClosingConfirmation.isAvailable()) {
        disableClosingConfirmation();
      }
    } catch {
      // ignore
    }
  }

  // ── Private ────────────────────────────────────────────────────────

  private emitSafeAreaChange(): void {
    const insets = this.getSafeAreaInsets();
    for (const cb of this.safeAreaListeners) cb(insets);
  }
}




