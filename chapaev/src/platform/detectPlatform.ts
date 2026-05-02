export type Platform = 'telegram' | 'yandex' | 'capacitor' | 'standalone';

let cached: Platform | null = null;

/**
 * Detect the host platform at runtime.
 * Called once at boot — result is memoised.
 *
 * Order matters:
 * 1. Capacitor native shell (Android / iOS app).
 * 2. Telegram Mini App (WebApp global injected by Telegram client).
 * 3. Yandex Games (YaGames global injected by the SDK script).
 * 4. Standalone browser / local dev.
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
  const tgWebApp = (window as unknown as Record<string, unknown>)['Telegram'] as
    | { WebApp?: { initData?: string } }
    | undefined;
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
  if (hasYaGames || hasYandexParam) return 'yandex';

  return 'standalone';
}

