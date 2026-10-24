import {
  defaultKeyValueStorage,
  type KeyValueStorage,
} from './KeyValueStorage.js';

/**
 * What the client keeps after `session-token`, so a killed tab can
 * call `resumeMatch` without reading the token.
 * `buildId` is the client's own id (the server does not put it in
 * the token event). An unset client `buildId` is stored as `''`.
 */
export interface MatchSession {
  token: string;
  matchId: string;
  slot: number;
  buildId: string;
  /** Server-sim `game-start` config, so a reloaded tab can rebuild the runner. */
  matchConfig?: { readonly [key: string]: unknown };
}

/**
 * `localStorage` record for one game, keyed by `phalanx.session.<gameId>`.
 * `localStorage` (not `sessionStorage`) because iOS drops session storage
 * when it kills the tab. The token is opaque; this store does not parse it.
 */
export class MatchSessionStore {
  private readonly storage: KeyValueStorage;
  private readonly storageKey: string;

  constructor(
    gameId: string,
    storage: KeyValueStorage = defaultKeyValueStorage()
  ) {
    this.storage = storage;
    this.storageKey = `phalanx.session.${gameId}`;
  }

  save(session: MatchSession): void {
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(session));
    } catch (err) {
      console.warn('[MatchSessionStore] save failed:', err);
    }
  }

  /**
   * The stored session, or `null` when nothing is stored or the value
   * is corrupt. A corrupt value is removed.
   */
  load(): MatchSession | null {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.storageKey);
    } catch (err) {
      console.warn('[MatchSessionStore] load failed:', err);
      this.clear();
      return null;
    }
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isMatchSession(parsed)) {
        this.clear();
        return null;
      }
      return parsed;
    } catch (err) {
      console.warn('[MatchSessionStore] load failed:', err);
      this.clear();
      return null;
    }
  }

  clear(): void {
    try {
      this.storage.removeItem(this.storageKey);
    } catch (err) {
      console.warn('[MatchSessionStore] clear failed:', err);
    }
  }
}

function isMatchSession(value: unknown): value is MatchSession {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.token === 'string' &&
    record.token.length > 0 &&
    typeof record.matchId === 'string' &&
    record.matchId.length > 0 &&
    typeof record.slot === 'number' &&
    Number.isSafeInteger(record.slot) &&
    record.slot >= 0 &&
    typeof record.buildId === 'string' &&
    (record.matchConfig === undefined ||
      (typeof record.matchConfig === 'object' &&
        record.matchConfig !== null &&
        !Array.isArray(record.matchConfig)))
  );
}
