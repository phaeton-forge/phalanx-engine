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

