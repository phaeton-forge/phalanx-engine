/**
 * MonetagSDK — thin loader/wrapper for the Monetag SDK.
 *
 * Monetag exposes a global function `show_<zoneId>()` after the loader script
 * `//libtl.com/sdk.js` is injected. That function returns a Promise whose
 * resolution semantics depend on `type`:
 *  - 'end'   (default) — Rewarded Interstitial; resolves AFTER the ad closes.
 *                        User sees a CTA "click to get reward" and clicking
 *                        redirects them out of the app. Not what we want.
 *  - 'start' — Rewarded Interstitial variant; resolves as soon as the ad
 *              STARTS. The ad still plays and auto-closes; we simply don't
 *              wait for it. Perfect for the Yandex-style "show interstitial
 *              before the match" flow.
 *  - 'preload' — fetch creative in background, no display.
 *  - 'inApp' — background scheduler; ads pop up on Monetag's own timer.
 *              We DO NOT use this: we control timing ourselves via 'start'.
 *  - 'pop'   — Rewarded Popup; immediate external redirect. Not used.
 *
 * Docs: https://docs.monetag.com/docs/sdk-reference/
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

interface MonetagShowOptions {
  type?: MonetagShowType;
}

type MonetagShowFn = ((options?: MonetagShowOptions) => Promise<void>) | undefined;

function getShowFn(zoneId: string): MonetagShowFn {
  return (window as unknown as Record<string, unknown>)[`show_${zoneId}`] as MonetagShowFn;
}

/**
 * Preload a Rewarded Interstitial creative in the background.
 * No UI is shown. Call this early (right after the SDK loads, and again after
 * each shown ad) so the next `showMonetagInterstitial()` displays instantly.
 *
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
 * Show an interstitial ad NOW.
 *
 * `blocking = false` (default): use `type: 'start'` — Promise resolves the
 *   moment the ad appears. The ad continues to play on top of our app and
 *   auto-closes; the game can proceed with UI transitions immediately.
 *   Suitable for flows where the underlying transition is not visible
 *   behind the ad (e.g. showing a match screen).
 *
 * `blocking = true`: use `type: 'end'` — Promise resolves AFTER the ad is
 *   closed (either by timer or by the user). Suitable for flows where the
 *   next action would visibly race with the ad (e.g. starting matchmaking,
 *   where a running timer under the ad looks broken).
 *
 * Returns true if the SDK confirmed the ad, false on error / no-fill.
 */
export async function showMonetagInterstitial(
  zoneId: string,
  options: { blocking?: boolean } = {}
): Promise<boolean> {
  const show = getShowFn(zoneId);
  if (!show) {
    console.warn('[MonetagAds] show function not available', zoneId);
    return false;
  }
  try {
    await show({ type: options.blocking ? 'end' : 'start' });
    return true;
  } catch (e) {
    console.warn('[MonetagAds] show rejected', e);
    return false;
  }
}
