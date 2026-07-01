/**
 * MonetagSDK — thin loader/wrapper for the Monetag in-app SDK.
 *
 * Monetag exposes a global function `show_<zoneId>()` after the loader script
 * `//libtl.com/sdk.js` is injected. The function returns a Promise that:
 *  - resolves when the user watches / closes the ad successfully;
 *  - rejects when the ad is skipped, fails to load, or the user is capped.
 *
 * We wrap it into a `boolean`-returning API to match `PlatformAdapter.tryShowFullscreenAd()`.
 *
 * Docs: https://help.monetag.com/en/articles/8836268 (Rewarded Interstitial)
 *       https://help.monetag.com/en/articles/9268255 (In-App Interstitial)
 *
 * Note on formats:
 *  - `Rewarded Interstitial` / `Rewarded Popup` — called on demand via `show_<id>()`.
 *  - `In-App Interstitial` — auto-triggered by a config passed to `show_<id>({ type: 'inApp', ... })`.
 *    You typically call it ONCE at boot and Monetag decides when to show the ad based on
 *    `frequency` / `capping` / `interval`.
 *
 * We support both modes: on-demand (default) and auto in-app (started at init).
 */

const MONETAG_LOADER_SRC = '//libtl.com/sdk.js';
const MONETAG_SCRIPT_ID = 'monetag-sdk';

let loaderPromise: Promise<void> | null = null;

/**
 * Inject the Monetag loader script exactly once. The script defines the
 * global `show_<zoneId>` function for every zone attached to the publisher.
 *
 * The `data-zone` / `data-sdk` attributes follow Monetag's documented loader
 * contract; `data-sdk` name is derived from the zone id in the format
 * `show_<zoneId>` (this is what Monetag uses on its snippet page).
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

type MonetagShowFn = ((options?: MonetagShowOptions) => Promise<void>) | undefined;

interface MonetagInAppSettings {
  /** How many ads to show in the interval window. */
  frequency: number;
  /** Sliding window size in minutes. */
  capping: number;
  /** Cooldown between ads in seconds. */
  interval: number;
  /** Delay before the FIRST ad, in seconds. */
  timeout?: number;
  /** True = show only after the first interval elapses (skip immediate ad). */
  everyPage?: boolean;
}

interface MonetagShowOptions {
  type?: 'inApp' | 'end';
  inAppSettings?: MonetagInAppSettings;
}

function getShowFn(zoneId: string): MonetagShowFn {
  return (window as unknown as Record<string, unknown>)[`show_${zoneId}`] as MonetagShowFn;
}

/**
 * Show a Rewarded Interstitial / Rewarded Popup on demand.
 * Returns true if the ad completed successfully, false on skip / error / no-fill.
 */
export async function showMonetagOnDemand(zoneId: string): Promise<boolean> {
  const show = getShowFn(zoneId);
  if (!show) {
    console.warn('[MonetagAds] show function not available', zoneId);
    return false;
  }
  try {
    await show();
    return true;
  } catch (e) {
    console.warn('[MonetagAds] show rejected', e);
    return false;
  }
}

/**
 * Start Monetag's autonomous In-App Interstitial pipeline.
 * Call this ONCE (typically during adapter init). Monetag will then show
 * interstitials on its own schedule based on the passed settings.
 *
 * We call this fire-and-forget — the returned promise resolves per-ad, but the
 * pipeline keeps running for the lifetime of the page.
 */
export function startMonetagInApp(
  zoneId: string,
  settings: MonetagInAppSettings
): void {
  const show = getShowFn(zoneId);
  if (!show) {
    console.warn('[MonetagAds] show function not available for in-app', zoneId);
    return;
  }
  try {
    void show({ type: 'inApp', inAppSettings: settings }).catch((e: unknown) => {
      console.warn('[MonetagAds] in-app pipeline error', e);
    });
  } catch (e) {
    console.warn('[MonetagAds] startMonetagInApp threw', e);
  }
}
