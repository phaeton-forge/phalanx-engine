/**
 * RoomPersistence — survives an active private-room session across:
 *   - mobile browser backgrounding (where the WebSocket dies but JS
 *     state is usually preserved by bfcache)
 *   - hard reloads (only useful for authenticated users whose
 *     `playerId` is stable across reloads — guests get a fresh
 *     `playerId` from PhalanxClient and cannot recover after reload)
 *
 * Stored in `localStorage` (NOT `sessionStorage`) so that iOS Safari,
 * which discards `sessionStorage` when the tab is killed, still has
 * the entry available the next time the app is opened.
 *
 * The local TTL mirrors the server-side `PrivateRoomService.ROOM_TTL_MS`
 * (5 minutes) — there's no point trying to recover a room the server
 * has certainly already evicted, and it lets us short-circuit a
 * pointless `room-recover` round-trip on cold start.
 */

const STORAGE_KEY = 'chapaev:activeRoom:v1';
/** Mirrors PrivateRoomService.ROOM_TTL_MS on the server. */
const ROOM_TTL_MS = 5 * 60 * 1000;

export type RoomRole = 'host' | 'guest';

export interface PersistedRoom {
  readonly code: string;
  readonly role: RoomRole;
  readonly playerId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/**
 * Best-effort save. Swallows storage errors (e.g. Safari private
 * mode throws on `setItem`) — losing the persistence layer should
 * never break room creation itself.
 */
export function saveRoom(input: {
  code: string;
  role: RoomRole;
  playerId: string;
}): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const now = Date.now();
    const record: PersistedRoom = {
      code: input.code,
      role: input.role,
      playerId: input.playerId,
      createdAt: now,
      expiresAt: now + ROOM_TTL_MS,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch (err) {
    console.warn('[RoomPersistence] save failed:', err);
  }
}

/**
 * Returns the stored room if it exists and is still within its TTL.
 * Auto-evicts an expired entry so subsequent calls don't keep trying
 * to recover something the server has long since destroyed.
 */
export function loadRoom(): PersistedRoom | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedRoom>;
    if (
      typeof parsed.code !== 'string' ||
      (parsed.role !== 'host' && parsed.role !== 'guest') ||
      typeof parsed.playerId !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      typeof parsed.createdAt !== 'number'
    ) {
      clearRoom();
      return null;
    }
    if (Date.now() > parsed.expiresAt) {
      clearRoom();
      return null;
    }
    return parsed as PersistedRoom;
  } catch (err) {
    console.warn('[RoomPersistence] load failed:', err);
    return null;
  }
}

export function clearRoom(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('[RoomPersistence] clear failed:', err);
  }
}

