/**
 * MonetagSDK — thin loader/wrapper for the Monetag SDK.
 *
 * Monetag exposes a global function `show_<zoneId>()` after the loader script
 * `//libtl.com/sdk.js` is injected. That function accepts different `type`
 * values which control both ad presentation AND promise semantics:
 *
 *  - 'end'   (default) — Rewarded Interstitial; resolves AFTER the ad closes.
 *                        Shows a CTA "click to get reward" that redirects the
 *                        user out of the app on click. Bad match-start UX.
 *  - 'start' — Same Rewarded Interstitial visual, but the Promise resolves
 *              when the ad STARTS (game keeps running while the ad plays and
 *              auto-closes). Reward-CTA still visible in the creative.
 *  - 'preload' — Fetch creative in background, no display.
 *  - 'inApp' — Non-rewarded interstitial with different creative styling.
 *              Does NOT return a usable Promise; SDK's own timer controls
 *              close. Best UX match for "show ad before match" without any
 *              reward semantics.
 *  - 'pop'   — Rewarded Popup; immediate external redirect. Not used.
 *
 * We use `inApp` for the interstitial call (cleanest UX) and `preload` at
 * boot / after each show to keep the creative warm.
 *
 * Docs: https://docs.monetag.com/docs/sdk-reference/
 *       https://docs.monetag.com/docs/ad-integration/inapp-interstitial/
 */

const MONETAG_LOADER_SRC = '//libtl.com/sdk.js';
const MONETAG_SCRIPT_ID = 'monetag-sdk';

let loaderPromise: Promise<void> | null = null;

/**
 * Inject the Monetag loader script exactly once. The script defines the
 * global `show_<zoneId>` function for every zone attached to the publisher.
 */
export function loadMonetagSDK(zoneId: string): Promise<void> {
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<void>((resolve, reject) => {
    // Already injected (hot reload / repeated init).
    const existing = document.getElementById(MONETAG_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (isShowFnAvailable(zoneId)) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => rejectLoad(reject), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = MONETAG_SCRIPT_ID;
    script.async = true;
    script.src = MONETAG_LOADER_SRC;
    script.setAttribute('data-zone', zoneId);
    script.setAttribute('data-sdk', `show_${zoneId}`);
    script.onload = () => resolve();
    script.onerror = () => rejectLoad(reject);
    document.head.appendChild(script);
  });

  return loaderPromise;
}

function rejectLoad(reject: (reason?: unknown) => void): void {
  loaderPromise = null;
  reject(new Error('Failed to load Monetag SDK script'));
}

function isShowFnAvailable(zoneId: string): boolean {
  const fnName = `show_${zoneId}`;
  return typeof (window as unknown as Record<string, unknown>)[fnName] === 'function';
}

type MonetagShowType = 'end' | 'start' | 'preload' | 'pop' | 'inApp';

interface MonetagInAppSettings {
  frequency: number;
  capping: number;
  interval: number;
  timeout?: number;
  everyPage?: boolean;
}

interface MonetagShowOptions {
  type?: MonetagShowType;
  inAppSettings?: MonetagInAppSettings;
}

type MonetagShowFn = ((options?: MonetagShowOptions) => Promise<void>) | undefined;

function getShowFn(zoneId: string): MonetagShowFn {
  return (window as unknown as Record<string, unknown>)[`show_${zoneId}`] as MonetagShowFn;
}

/**
 * Preload a creative in the background so the next display is instant.
 * Fire-and-forget: errors are logged, never thrown.
 */
export function preloadMonetagInterstitial(zoneId: string): void {
  const show = getShowFn(zoneId);
  if (!show) return;
  try {
    void show({ type: 'preload' }).catch((e: unknown) => {
      console.warn('[MonetagAds] preload rejected', e);
    });
  } catch (e) {
    console.warn('[MonetagAds] preload threw', e);
  }
}

/**
 * Trigger a single In-App Interstitial *now* using Monetag's own auto-display
 * pipeline with a one-shot config:
 *  - frequency: 1 → at most one ad per pipeline invocation
 *  - capping: 0.001 → session length ≈ 3.6 seconds (only the immediate ad)
 *  - interval: 1 → doesn't matter (we only want the first ad)
 *  - timeout: 0 → show as soon as the SDK is ready
 *  - everyPage: false → don't reset on navigation
 *
 * Monetag's docs say `type: 'inApp'` does NOT return a usable Promise, so we
 * resolve `true` immediately after invoking. Downstream code treats this as
 * "ad start requested"; the ad may or may not actually appear depending on
 * no-fill / capping / network — we can't observe that from here.
 *
 * We rely on the caller (`FullscreenAdGate` in `TelegramAdapter`) to prevent
 * calling this too frequently, even if the underlying ad didn't render.
 */
export async function showMonetagInterstitial(zoneId: string): Promise<boolean> {
  const show = getShowFn(zoneId);
  if (!show) {
    console.warn('[MonetagAds] show function not available', zoneId);
    return false;
  }
  try {
    // Fire the pipeline. Do NOT await — Monetag doesn't guarantee a resolve
    // for the in-app pipeline; awaiting could hang the caller forever.
    void show({
      type: 'inApp',
      inAppSettings: {
        frequency: 1,
        capping: 0.001,
        interval: 1,
        timeout: 0,
        everyPage: false,
      },
    }).catch((e: unknown) => {
      console.warn('[MonetagAds] inApp pipeline rejected', e);
    });
    return true;
  } catch (e) {
    console.warn('[MonetagAds] show threw', e);
    return false;
  }
}
