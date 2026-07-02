export type Platform =
  | 'telegram'
  | 'yandex'
  | 'crazygames'
  | 'capacitor'
  | 'standalone';

let cached: Platform | null = null;

/**
 * Detect the host platform at runtime.
 * Called once at boot — result is memoised.
 *
 * Order matters:
 * 1. Capacitor native shell (Android / iOS app).
 * 2. Telegram Mini App (WebApp global injected by Telegram client).
 * 3. Yandex Games — CDN host (`*.games.s3.yandex.*`), optional `?yandex_games=`,
 *    or `YaGames` already on `window` (e.g. host injected the script before our bundle).
 *    The SDK is loaded in `YandexAdapter.init()`, so `YaGames` is usually absent at
 *    detection time; do not rely on it alone.
 * 4. CrazyGames — the portal embeds our build in an iframe served from a
 *    `crazygames.com` host, so the referrer/ancestor origin points there.
 *    On desktop the referrer/ancestorOrigins expose the parent origin; inside
 *    the CrazyGames mobile app the iframe is cross-origin with an empty
 *    referrer and no ancestorOrigins, so we additionally treat "embedded in
 *    any iframe" as a CrazyGames signal (Telegram/Yandex are matched earlier,
 *    so reaching this branch inside an iframe means the portal embed).
 *    The SDK is loaded in `CrazyGamesAdapter.init()`, and `getEnvironment()`
 *    is the authoritative check for whether ads run — detection here only
 *    needs to route to the adapter. `?useLocalSdk=true` forces this branch
 *    for local SDK testing.
 * 5. Standalone browser / local dev.
 */
export function detectPlatform(): Platform {
  if (cached !== null) return cached;
  cached = resolve();
  return cached;
}

function resolve(): Platform {
  if (typeof window === 'undefined') return 'standalone';

  // 1. Capacitor native shell
  const cap = (window as unknown as Record<string, unknown>)['Capacitor'] as
    | { isNativePlatform?: () => boolean }
    | undefined;
  if (cap?.isNativePlatform?.()) return 'capacitor';

  // 2. Telegram Mini App
  //    Telegram injects window.Telegram.WebApp; initData is a non-empty string
  //    when the app is opened from a real Telegram client.
  //    Falls back to URL hash when the global isn't injected yet (edge case).
  const tgWebApp = (window as unknown as Record<string, unknown>)[
    'Telegram'
  ] as { WebApp?: { initData?: string } } | undefined;
  if (
    (typeof tgWebApp?.WebApp?.initData === 'string' &&
      tgWebApp.WebApp.initData.length > 0) ||
    window.location.hash.includes('tgWebAppData=')
  ) {
    return 'telegram';
  }

  // 3. Yandex Games
  const hasYaGames =
    (window as unknown as Record<string, unknown>)['YaGames'] !== undefined;
  const hasYandexParam = new URLSearchParams(window.location.search).has(
    'yandex_games'
  );
  if (hasYaGames || hasYandexParam || isYandexGamesCdnHost()) return 'yandex';

  // 4. CrazyGames — embedded in a crazygames.com iframe, or forced locally.
  if (isCrazyGamesHost() || hasUseLocalSdkParam()) return 'crazygames';

  return 'standalone';
}

/**
 * True when our document is embedded by the CrazyGames portal. The build runs
 * inside an iframe whose parent/ancestor origin is a `crazygames.com` host.
 * We check the referrer and, when accessible, the ancestor origins — both are
 * cheap best-effort signals. `getEnvironment()` in the adapter is the real
 * authority for enabling ads, so a false positive here is harmless (it just
 * loads the SDK, which then reports `disabled`).
 */
function isCrazyGamesHost(): boolean {
  try {
    const crazyRe = /(^|\.)crazygames\.com$/i;

    // Own hostname (covers direct hosting on a crazygames subdomain).
    if (crazyRe.test(window.location.hostname)) return true;

    // Referrer of the embedding page.
    if (document.referrer) {
      const refHost = new URL(document.referrer).hostname;
      if (crazyRe.test(refHost)) return true;
    }

    // Ancestor origins (Safari/Chromium expose this on the location object).
    const ancestors = (
      window.location as unknown as {
        ancestorOrigins?: { length: number; item(i: number): string | null };
      }
    ).ancestorOrigins;
    if (ancestors) {
      for (let i = 0; i < ancestors.length; i++) {
        const origin = ancestors.item(i);
        if (origin && crazyRe.test(new URL(origin).hostname)) return true;
      }
    }

    // Embedded in an iframe with no usable origin signal. On the CrazyGames
    // mobile app the parent frame is cross-origin: `document.referrer` is empty
    // and `ancestorOrigins` is unavailable, so the checks above all miss. By
    // this point Capacitor/Telegram/Yandex have already been ruled out, so an
    // iframe embed here is the CrazyGames portal. A false positive is harmless
    // — the adapter's `getEnvironment()` still gates ads and reports `disabled`
    // when the SDK isn't actually present. Genuine standalone web runs
    // top-level (`self === top`), so direct visits stay `standalone`.
    if (isEmbeddedInIframe()) return true;
  } catch {
    // Cross-origin access can throw; treat as "not detected".
  }
  return false;
}

/**
 * True when our document runs inside an iframe. Accessing `window.top` across
 * origins can throw in some engines, so guard it; a thrown SecurityError itself
 * implies a cross-origin parent (i.e. we are embedded).
 */
function isEmbeddedInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/** `?useLocalSdk=true` forces the CrazyGames local SDK harness. */
function hasUseLocalSdkParam(): boolean {
  try {
    return (
      new URLSearchParams(window.location.search).get('useLocalSdk') === 'true'
    );
  } catch {
    return false;
  }
}

/** True when the game document is served from Yandex Games object storage (production iframe). */
function isYandexGamesCdnHost(): boolean {
  try {
    return /\.games\.s3\.yandex\./i.test(window.location.hostname);
  } catch {
    return false;
  }
}
