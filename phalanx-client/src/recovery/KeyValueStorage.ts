/**
 * Minimal sync key/value storage abstraction. `localStorage` is the
 * default implementation; React Native / Capacitor / Electron host
 * apps can plug in their own adapter (e.g. wrapping `Preferences`)
 * without dragging in an async API surface.
 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * `localStorage`-backed adapter that swallows access errors (Safari
 * private mode throws on `setItem`, some embedded WebViews disable
 * storage entirely). Returns null when storage is unavailable so the
 * caller can fall back gracefully.
 */
export class LocalStorageAdapter implements KeyValueStorage {
  getItem(key: string): string | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  setItem(key: string, value: string): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(key, value);
    } catch {
      // ignore — persistence is best-effort
    }
  }

  removeItem(key: string): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}

/** In-memory fallback used in non-DOM environments and tests. */
export class MemoryKeyValueStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** Pick the best default storage for the current environment. */
export function defaultKeyValueStorage(): KeyValueStorage {
  if (typeof localStorage !== 'undefined') return new LocalStorageAdapter();
  return new MemoryKeyValueStorage();
}

