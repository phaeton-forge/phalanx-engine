import { defaultKeyValueStorage, type KeyValueStorage } from './KeyValueStorage.js';

/**
 * RoomPersistence — survives an active private-room session across:
 *   - mobile browser backgrounding (where the WebSocket dies but JS
 *     state is usually preserved by bfcache)
 *   - hard reloads, as long as the same `playerId` is still available
 *     after reload (authenticated users always; guests when the
 *     `GuestPlayerIdStore` is used)
 *
 * Stored in `localStorage` by default (NOT `sessionStorage`) so that
 * iOS Safari, which discards `sessionStorage` when the tab is killed,
 * still has the entry available the next time the app is opened.
 *
 * Recovery is best-effort and bounded by the room TTL: if the stored
 * room entry has expired, or a true cold start no longer has access to
 * the previous `playerId`, recovery is not expected to succeed.
 */

export type RoomRole = 'host' | 'guest';

export interface PersistedRoom {
  readonly code: string;
  readonly role: RoomRole;
  readonly playerId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface RoomPersistenceConfig {
  /** localStorage key. */
  storageKey: string;
  /** TTL mirroring the server's RoomService.ROOM_TTL_MS. */
  roomTtlMs: number;
  /** Storage adapter; defaults to localStorage. */
  storage?: KeyValueStorage;
}

export class RoomPersistence {
  private readonly storage: KeyValueStorage;

  constructor(private readonly config: RoomPersistenceConfig) {
    this.storage = config.storage ?? defaultKeyValueStorage();
  }

  /**
   * Best-effort save. Errors are logged and swallowed — losing the
   * persistence layer should never break room creation itself.
   */
  save(input: { code: string; role: RoomRole; playerId: string }): void {
    try {
      const now = Date.now();
      const record: PersistedRoom = {
        code: input.code,
        role: input.role,
        playerId: input.playerId,
        createdAt: now,
        expiresAt: now + this.config.roomTtlMs,
      };
      this.storage.setItem(this.config.storageKey, JSON.stringify(record));
    } catch (err) {
      console.warn('[RoomPersistence] save failed:', err);
    }
  }

  /**
   * Returns the stored room if it exists and is still within its TTL.
   * Auto-evicts an expired entry so subsequent calls don't keep trying
   * to recover something the server has long since destroyed.
   */
  load(): PersistedRoom | null {
    try {
      const raw = this.storage.getItem(this.config.storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<PersistedRoom>;
      if (
        typeof parsed.code !== 'string' ||
        (parsed.role !== 'host' && parsed.role !== 'guest') ||
        typeof parsed.playerId !== 'string' ||
        typeof parsed.expiresAt !== 'number' ||
        typeof parsed.createdAt !== 'number'
      ) {
        this.clear();
        return null;
      }
      if (Date.now() > parsed.expiresAt) {
        this.clear();
        return null;
      }
      return parsed as PersistedRoom;
    } catch (err) {
      console.warn('[RoomPersistence] load failed:', err);
      return null;
    }
  }

  clear(): void {
    try {
      this.storage.removeItem(this.config.storageKey);
    } catch (err) {
      console.warn('[RoomPersistence] clear failed:', err);
    }
  }
}

