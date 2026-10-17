import type { LogEntry } from '../runner/CommandLog.js';
import {
  applyCommands,
  applyHeader,
  applySnapshot,
  assertMatchId,
  emptyMatch,
  snapshotTicksOf,
  toLoaded,
  type StoredMatch,
} from './matchRecord.js';
import type { LoadedMatch, MatchConfig, MatchStore } from './MatchStore.js';

const STORE_NAME = 'matches';
const DB_VERSION = 1;

export interface IndexedDbMatchStoreOptions {
  /** Defaults to `phalanx-matches`. Tests pass a private name. */
  readonly databaseName?: string;
}

/**
 * IndexedDB {@link MatchStore}. One row per match. The runtime does not
 * reference the DOM lib: `indexedDB` is read from `globalThis` when a
 * method runs (Node tests install `fake-indexeddb` first).
 */
export class IndexedDbMatchStore implements MatchStore {
  private readonly databaseName: string;
  private opening: Promise<IdbDatabaseLike> | null = null;
  private tail: Promise<void> = Promise.resolve();

  public constructor(options: IndexedDbMatchStoreOptions = {}) {
    const name = options.databaseName ?? 'phalanx-matches';
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(
        'IndexedDbMatchStore: databaseName must be a non-empty string'
      );
    }
    this.databaseName = name;
  }

  public saveHeader(matchId: string, config: MatchConfig): Promise<void> {
    assertMatchId(matchId);
    return this.mutate(matchId, (row) => {
      applyHeader(row, config);
    });
  }

  public appendCommands(
    matchId: string,
    entries: readonly LogEntry[],
    cursorTick?: number
  ): Promise<void> {
    assertMatchId(matchId);
    return this.mutate(matchId, (row) => {
      applyCommands(row, entries, cursorTick);
    });
  }

  public saveSnapshot(
    matchId: string,
    tick: number,
    bytes: Uint8Array
  ): Promise<void> {
    assertMatchId(matchId);
    return this.mutate(matchId, (row) => {
      applySnapshot(row, tick, bytes);
    });
  }

  public load(matchId: string): Promise<LoadedMatch | null> {
    assertMatchId(matchId);
    return this.enqueue(() => this.read(matchId));
  }

  public clear(matchId: string): Promise<void> {
    assertMatchId(matchId);
    return this.enqueue(async () => {
      const db = await this.database();
      await deleteRow(db, matchId);
    });
  }

  /** Ticks of the snapshots still stored, oldest first. At most two. */
  public snapshotTicks(matchId: string): Promise<readonly number[]> {
    assertMatchId(matchId);
    return this.enqueue(async () => {
      const row = await this.readRow(matchId);
      if (row === null) return [];
      return snapshotTicksOf(row);
    });
  }

  private mutate(
    matchId: string,
    update: (row: StoredMatch) => void
  ): Promise<void> {
    return this.enqueue(async () => {
      const db = await this.database();
      await updateRow(db, matchId, update);
    });
  }

  private async read(matchId: string): Promise<LoadedMatch | null> {
    const row = await this.readRow(matchId);
    if (row === null) return null;
    return toLoaded(row);
  }

  private async readRow(matchId: string): Promise<StoredMatch | null> {
    const db = await this.database();
    return getRow(db, matchId);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private database(): Promise<IdbDatabaseLike> {
    if (this.opening === null) {
      this.opening = openDatabase(this.databaseName).catch((error: unknown) => {
        this.opening = null;
        throw error;
      });
    }
    return this.opening;
  }
}

function openDatabase(name: string): Promise<IdbDatabaseLike> {
  const factory = indexedDbFactory();
  return new Promise((resolve, reject) => {
    const request = factory.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(errorOf(request.error, 'IndexedDbMatchStore: failed to open'));
    };
  });
}

function updateRow(
  db: IdbDatabaseLike,
  matchId: string,
  update: (row: StoredMatch) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const get = store.get(matchId);
    get.onsuccess = () => {
      const row = coerceRow(get.result);
      update(row);
      store.put(row, matchId);
    };
    get.onerror = () => {
      reject(errorOf(get.error, 'IndexedDbMatchStore: failed to read'));
    };
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(errorOf(tx.error, 'IndexedDbMatchStore: transaction failed'));
    };
    tx.onabort = () => {
      reject(errorOf(tx.error, 'IndexedDbMatchStore: transaction aborted'));
    };
  });
}

function getRow(
  db: IdbDatabaseLike,
  matchId: string
): Promise<StoredMatch | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const get = tx.objectStore(STORE_NAME).get(matchId);
    get.onsuccess = () => {
      if (get.result === undefined) {
        resolve(null);
        return;
      }
      resolve(coerceRow(get.result));
    };
    get.onerror = () => {
      reject(errorOf(get.error, 'IndexedDbMatchStore: failed to read'));
    };
  });
}

function deleteRow(db: IdbDatabaseLike, matchId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const request = tx.objectStore(STORE_NAME).delete(matchId);
    request.onerror = () => {
      reject(errorOf(request.error, 'IndexedDbMatchStore: failed to clear'));
    };
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(errorOf(tx.error, 'IndexedDbMatchStore: transaction failed'));
    };
    tx.onabort = () => {
      reject(errorOf(tx.error, 'IndexedDbMatchStore: transaction aborted'));
    };
  });
}

function coerceRow(value: unknown): StoredMatch {
  if (value === undefined || value === null) return emptyMatch();
  if (!isRecord(value)) {
    throw new Error('IndexedDbMatchStore: corrupt match record');
  }
  const cursor = value['cursor'];
  const commands = value['commands'];
  const snapshots = value['snapshots'];
  const config = value['config'];
  if (typeof cursor !== 'number' || !Number.isInteger(cursor)) {
    throw new Error('IndexedDbMatchStore: corrupt match record');
  }
  if (!Array.isArray(commands) || !Array.isArray(snapshots)) {
    throw new Error('IndexedDbMatchStore: corrupt match record');
  }
  if (config !== null && !isRecord(config)) {
    throw new Error('IndexedDbMatchStore: corrupt match record');
  }
  const row = emptyMatch();
  row.cursor = cursor;
  row.commands = commands as LogEntry[];
  row.snapshots = snapshots as StoredMatch['snapshots'];
  row.config = config as MatchConfig | null;
  return row;
}

function indexedDbFactory(): IdbFactoryLike {
  const host: unknown = globalThis;
  if (!isRecord(host)) {
    throw new Error('IndexedDbMatchStore: indexedDB is not available');
  }
  const candidate = host['indexedDB'];
  if (!isFactory(candidate)) {
    throw new Error('IndexedDbMatchStore: indexedDB is not available');
  }
  return candidate;
}

function errorOf(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  return new Error(fallback);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFactory(value: unknown): value is IdbFactoryLike {
  return isRecord(value) && typeof value['open'] === 'function';
}

interface RequestLike<T> {
  readonly result: T;
  readonly error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

interface OpenRequestLike<T> extends RequestLike<T> {
  onupgradeneeded: (() => void) | null;
}

interface StoreLike {
  get(key: string): RequestLike<unknown>;
  put(value: StoredMatch, key: string): RequestLike<unknown>;
  delete(key: string): RequestLike<unknown>;
}

interface TxLike {
  readonly error: unknown;
  objectStore(name: string): StoreLike;
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
}

interface IdbDatabaseLike {
  readonly objectStoreNames: { contains(name: string): boolean };
  transaction(name: string, mode: 'readonly' | 'readwrite'): TxLike;
  createObjectStore(name: string): unknown;
}

interface IdbFactoryLike {
  open(name: string, version: number): OpenRequestLike<IdbDatabaseLike>;
}
