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
    // Fast path: show fn already installed (hot reload, second init).
    if (isShowFnAvailable(zoneId)) {
      resolve();
      return;
    }

    // Script tag already in DOM but show fn not yet installed.
    // We cannot rely on a fresh 'load' event — the tag may already be
    // fully loaded (event long since fired) and Monetag installs the
    // global `show_<zoneId>` synchronously on load. Poll a short window
    // instead of waiting on an event that will never fire.
    const existing = document.getElementById(MONETAG_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      waitForShowFn(zoneId, resolve, reject);
      return;
    }

    const script = document.createElement('script');
    script.id = MONETAG_SCRIPT_ID;
    script.async = true;
    script.src = MONETAG_LOADER_SRC;
    script.setAttribute('data-zone', zoneId);
    script.setAttribute('data-sdk', `show_${zoneId}`);
    script.onload = () => {
      // In practice `show_<zoneId>` is defined by the time onload fires,
      // but poll briefly to handle any async install path.
      waitForShowFn(zoneId, resolve, reject);
    };
    script.onerror = () => rejectLoad(reject);
    document.head.appendChild(script);
  });

  return loaderPromise;
}

function rejectLoad(reject: (reason?: unknown) => void): void {
  loaderPromise = null;
  reject(new Error('Failed to load Monetag SDK script'));
}

/**
 * Poll for the `show_<zoneId>` global. Monetag installs it synchronously on
 * script load, but we also cover the case where the script tag was already
 * present in the DOM (load event long since fired) or where installation is
 * deferred. Bounded wait — otherwise resolves as "loaded" so we can still
 * gracefully no-op inside showMonetagInterstitial (it checks the fn again).
 */
function waitForShowFn(
  zoneId: string,
  resolve: () => void,
  _reject: (reason?: unknown) => void,
): void {
  const timeoutMs = 5000;
  const stepMs = 50;
  const start = Date.now();
  const tick = (): void => {
    if (isShowFnAvailable(zoneId)) {
      resolve();
      return;
    }
    if (Date.now() - start >= timeoutMs) {
      // Don't reject — treat as loaded-but-empty; showMonetagInterstitial
      // will detect the missing fn and return false gracefully.
      console.warn('[MonetagAds] show_<zoneId> did not appear within', timeoutMs, 'ms');
      resolve();
      return;
    }
    setTimeout(tick, stepMs);
  };
  tick();
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
