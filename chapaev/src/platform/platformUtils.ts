import type { Language } from '../i18n/i18n.ts';

/**
 * Regex for valid private-room codes (shared between adapters).
 * Matches 4–12 alphanumeric characters.
 */
export const ROOM_CODE_PATTERN = /^[a-z0-9]{4,12}$/i;

/**
 * Map a raw language code string to the supported Language union.
 * Falls back to English for unknown locales.
 */
export function mapLanguageCode(code: string | null | undefined): Language | null {
  if (!code) return null;
  const n = code.toLowerCase();
  if (n.startsWith('ru')) return 'ru';
  if (n.startsWith('en')) return 'en';
  return 'en';
}

/**
 * Build a plain `window.location`-based share URL.
 * Used as a fallback by Standalone and Capacitor adapters.
 */
export function defaultInviteShareUrl(roomCode: string): string {
  const code = roomCode.trim().toUpperCase();
  return `${window.location.origin}${window.location.pathname}?ROOM=${encodeURIComponent(code)}`;
}

/**
 * When the game runs on Yandex Games CDN, `window.location` points at S3
 * (`app-{id}.games.s3.yandex.net`). If `ysdk.environment.app.id` is missing,
 * we can still recover the catalog id from the host (or path) for share links.
 */
export function inferYandexGamesAppIdFromLocation(): string | null {
  try {
    const { hostname, pathname } = window.location;
    const fromHost = hostname.match(/^app-(\d+)\.games\.s3\.yandex\./);
    if (fromHost?.[1]) return fromHost[1];
    if (/\.games\.s3\.yandex\./.test(hostname)) {
      const fromPath = pathname.match(/^\/(\d+)(?:\/|$)/);
      if (fromPath?.[1]) return fromPath[1];
    }
  } catch {
    // ignore (SSR / opaque origins)
  }
  return null;
}

/** Prefer SDK `environment.app.id`, then infer from Yandex Games CDN URL. */
export function resolveYandexGamesAppId(
  environment: { app?: { id?: string | number } } | undefined
): string | null {
  const raw = environment?.app?.id;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return String(Math.trunc(raw));
  }
  return inferYandexGamesAppIdFromLocation();
}

/**
 * Read the `?ROOM=` query parameter from the current URL and optionally
 * strip it from browser history so it doesn't persist across page reloads.
 */
export function consumeUrlRoomCode(): string | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('ROOM') ?? params.get('room');
  if (!code) return null;
  if (!ROOM_CODE_PATTERN.test(code)) return null;
  window.history.replaceState({}, '', window.location.pathname);
  return code.toUpperCase();
}

