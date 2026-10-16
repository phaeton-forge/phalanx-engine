import { defaultKeyValueStorage, type KeyValueStorage } from './KeyValueStorage.js';

/**
 * Generate a fresh anonymous player id. Format mirrors the legacy
 * `player-${ts}-${slug}` shape so server logs stay easy to read.
 */
function generateGuestPlayerId(): string {
  return `player-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Load (or generate-and-persist) a stable guest player id.
 *
 * `PhalanxClient` generates a fresh id in its constructor when none is
 * supplied — that id changes on every page reload, which silently
 * breaks any server-side state keyed by playerId, most importantly the
 * host record inside a private room. Persisting the guest id in
 * localStorage lets cold-start recovery succeed for unauthenticated
 * users.
 *
 * Falls back to an in-memory id when storage is unavailable (Safari
 * private mode etc.) — recovery won't work in that environment, but
 * regular play still does.
 */
export function loadOrCreateGuestPlayerId(
  storageKey: string,
  storage: KeyValueStorage = defaultKeyValueStorage()
): string {
  const existing = storage.getItem(storageKey);
  if (existing && existing.length > 0) return existing;
  const fresh = generateGuestPlayerId();
  storage.setItem(storageKey, fresh);
  return fresh;
}

