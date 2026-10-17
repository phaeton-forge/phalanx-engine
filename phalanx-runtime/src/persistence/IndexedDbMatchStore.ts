import type { LogEntry } from '../runner/CommandLog.js';
import {
  RETAINED_SNAPSHOTS,
  applyHeader,
  assertMatchId,
  assertSnapshotInput,
  chunkBounds,
  collectNewEntries,
  commandBatchOverlaps,
  emptyMatch,
  entriesAfter,
  lowestEntryTick,
  planSnapshotTicks,
  rememberEntries,
} from './matchRecord.js';
import type { LoadedMatch, MatchConfig, MatchStore } from './MatchStore.js';

const LEGACY_STORE = 'matches';
const META_STORE = 'meta';
const COMMANDS_STORE = 'commands';
const SNAPSHOTS_STORE = 'snapshots';

/**
 * Schema v2. Version 1 kept one `matches` row per match (the whole command
 * log and both snapshots). Opening v2 deletes that store. Pre-0.3.0 local
 * matches are dropped on purpose: nothing published has user data to
 * migrate. Every later version must migrate.
 */
const DB_VERSION = 2;

const READWRITE = 'readwrite';
const READONLY = 'readonly';

export interface IndexedDbMatchStoreOptions {
  /** Defaults to `phalanx-matches`. Tests pass a private name. */
  readonly databaseName?: string;
}

interface MatchMeta {
  config: MatchConfig | null;
  cursor: number;
  nextSeq: number;
  maxEntryTick: number;
  snapshotTicks: number[];
}

interface CommandChunk {
  firstTick: number;
  lastTick: number;
  entries: LogEntry[];
}

/**
 * IndexedDB {@link MatchStore}. One small `meta` row per match, one
 * `commands` chunk per {@link MatchStore.appendCommands} batch, and one
 * `snapshots` row per retained tick. The runtime does not reference the DOM
 * lib: `indexedDB` is read from `globalThis` when a method runs (Node tests
 * install `fake-indexeddb` first).
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
    const header = cloneConfig(config);
    return this.enqueue(() =>
      this.write([META_STORE], (tx, fail) => {
        const store = tx.objectStore(META_STORE);
        const get = store.get(matchId);
        get.onsuccess = () => {
          try {
            const meta = coerceMeta(get.result);
            meta.config = header;
            store.put(meta, matchId);
          } catch (error) {
            fail(error);
          }
        };
        get.onerror = () => {
          fail(errorOf(get.error, 'IndexedDbMatchStore: failed to read'));
        };
      })
    );
  }

  public appendCommands(
    matchId: string,
    entries: readonly LogEntry[],
    cursorTick?: number
  ): Promise<void> {
    assertMatchId(matchId);
    return this.enqueue(() =>
      this.write([META_STORE, COMMANDS_STORE], (tx, fail) => {
        const metaStore = tx.objectStore(META_STORE);
        const commandStore = tx.objectStore(COMMANDS_STORE);
        const get = metaStore.get(matchId);
        get.onsuccess = () => {
          try {
            const meta = coerceMeta(get.result);
            const oldest = meta.snapshotTicks[0];
            const finish = (seen: Set<string>): void => {
              try {
                writeCommandBatch(
                  metaStore,
                  commandStore,
                  matchId,
                  meta,
                  entries,
                  cursorTick,
                  oldest,
                  seen
                );
              } catch (error) {
                fail(error);
              }
            };
            if (
              !commandBatchOverlaps(entries, meta.maxEntryTick) ||
              meta.nextSeq === 0
            ) {
              finish(new Set());
              return;
            }
            const minTick = lowestEntryTick(entries);
            if (minTick === null) {
              finish(new Set());
              return;
            }
            readOverlappingKeys(
              commandStore,
              matchId,
              meta.nextSeq,
              minTick,
              finish,
              fail
            );
          } catch (error) {
            fail(error);
          }
        };
        get.onerror = () => {
          fail(errorOf(get.error, 'IndexedDbMatchStore: failed to read'));
        };
      })
    );
  }

  public saveSnapshot(
    matchId: string,
    tick: number,
    bytes: Uint8Array
  ): Promise<void> {
    assertMatchId(matchId);
    assertSnapshotInput(tick, bytes);
    return this.enqueue(() =>
      this.write([META_STORE, COMMANDS_STORE, SNAPSHOTS_STORE], (tx, fail) => {
        const metaStore = tx.objectStore(META_STORE);
        const commandStore = tx.objectStore(COMMANDS_STORE);
        const snapshotStore = tx.objectStore(SNAPSHOTS_STORE);
        const get = metaStore.get(matchId);
        get.onsuccess = () => {
          try {
            const meta = coerceMeta(get.result);
            const planned = planSnapshotTicks(meta.snapshotTicks, tick);
            snapshotStore.put(copyBytes(bytes), [matchId, tick]);
            for (const dropped of planned.dropped) {
              snapshotStore.delete([matchId, dropped]);
            }
            const cursor = tick > meta.cursor ? tick : meta.cursor;
            const commitMeta = (): void => {
              metaStore.put(
                {
                  config: meta.config,
                  cursor,
                  nextSeq: meta.nextSeq,
                  maxEntryTick: meta.maxEntryTick,
                  snapshotTicks: planned.ticks,
                },
                matchId
              );
            };
            const oldest = planned.ticks[0];
            if (oldest === undefined) {
              commitMeta();
              return;
            }
            deleteCoveredChunks(
              commandStore,
              matchId,
              oldest,
              commitMeta,
              fail
            );
          } catch (error) {
            fail(error);
          }
        };
        get.onerror = () => {
          fail(errorOf(get.error, 'IndexedDbMatchStore: failed to read'));
        };
      })
    );
  }

  public load(matchId: string): Promise<LoadedMatch | null> {
    assertMatchId(matchId);
    return this.enqueue(() => this.readMatch(matchId));
  }

  public clear(matchId: string): Promise<void> {
    assertMatchId(matchId);
    return this.enqueue(() =>
      this.write([META_STORE, COMMANDS_STORE, SNAPSHOTS_STORE], (tx, fail) => {
        const range = matchRange(matchId);
        const meta = tx.objectStore(META_STORE).delete(matchId);
        const commands = tx.objectStore(COMMANDS_STORE).delete(range);
        const snapshots = tx.objectStore(SNAPSHOTS_STORE).delete(range);
        meta.onerror = () => {
          fail(errorOf(meta.error, 'IndexedDbMatchStore: failed to clear'));
        };
        commands.onerror = () => {
          fail(errorOf(commands.error, 'IndexedDbMatchStore: failed to clear'));
        };
        snapshots.onerror = () => {
          fail(
            errorOf(snapshots.error, 'IndexedDbMatchStore: failed to clear')
          );
        };
      })
    );
  }

  public deleteSnapshot(matchId: string, tick: number): Promise<void> {
    assertMatchId(matchId);
    return this.enqueue(() =>
      this.write([META_STORE, SNAPSHOTS_STORE], (tx, fail) => {
        const metaStore = tx.objectStore(META_STORE);
        const get = metaStore.get(matchId);
        get.onsuccess = () => {
          try {
            if (get.result === undefined) return;
            const meta = coerceMeta(get.result);
            if (!meta.snapshotTicks.includes(tick)) return;
            tx.objectStore(SNAPSHOTS_STORE).delete([matchId, tick]);
            metaStore.put(
              {
                config: meta.config,
                cursor: meta.cursor,
                nextSeq: meta.nextSeq,
                maxEntryTick: meta.maxEntryTick,
                snapshotTicks: meta.snapshotTicks.filter(
                  (stored) => stored !== tick
                ),
              },
              matchId
            );
          } catch (error) {
            fail(error);
          }
        };
        get.onerror = () => {
          fail(errorOf(get.error, 'IndexedDbMatchStore: failed to read'));
        };
      })
    );
  }

  /** Ticks of the snapshots still stored, oldest first. At most two. */
  public snapshotTicks(matchId: string): Promise<readonly number[]> {
    assertMatchId(matchId);
    return this.enqueue(() =>
      this.read([META_STORE], (tx, done, fail) => {
        const get = tx.objectStore(META_STORE).get(matchId);
        get.onsuccess = () => {
          try {
            if (get.result === undefined) {
              done([]);
              return;
            }
            done([...coerceMeta(get.result).snapshotTicks]);
          } catch (error) {
            fail(error);
          }
        };
        get.onerror = () => {
          fail(errorOf(get.error, 'IndexedDbMatchStore: failed to read'));
        };
      })
    );
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
      this.opening = openDatabase(this.databaseName, () => {
        this.opening = null;
      }).catch((error: unknown) => {
        this.opening = null;
        throw error;
      });
    }
    return this.opening;
  }

  private async write(
    stores: readonly string[],
    run: (tx: TxLike, fail: (error: unknown) => void) => void
  ): Promise<void> {
    const db = await this.database();
    await withTransaction(db, stores, READWRITE, (tx, done, fail) => {
      run(tx, fail);
      // `done` resolves from the transaction's oncomplete.
      void done;
    });
  }

  private async read<T>(
    stores: readonly string[],
    run: (
      tx: TxLike,
      done: (value: T) => void,
      fail: (error: unknown) => void
    ) => void
  ): Promise<T> {
    const db = await this.database();
    return withTransaction(db, stores, READONLY, run);
  }

  private readMatch(matchId: string): Promise<LoadedMatch | null> {
    return this.read(
      [META_STORE, COMMANDS_STORE, SNAPSHOTS_STORE],
      (tx, done, fail) => {
        const get = tx.objectStore(META_STORE).get(matchId);
        get.onsuccess = () => {
          try {
            if (get.result === undefined) {
              done(null);
              return;
            }
            const meta = coerceMeta(get.result);
            if (meta.config === null) {
              done(null);
              return;
            }
            readSnapshots(
              tx,
              matchId,
              meta,
              (snapshots) => {
                readCommandEntries(
                  tx.objectStore(COMMANDS_STORE),
                  matchId,
                  (entries) => {
                    done(loadedFrom(meta, snapshots, entries));
                  },
                  fail
                );
              },
              fail
            );
          } catch (error) {
            fail(error);
          }
        };
        get.onerror = () => {
          fail(errorOf(get.error, 'IndexedDbMatchStore: failed to read'));
        };
      }
    );
  }
}

function writeCommandBatch(
  metaStore: StoreLike,
  commandStore: StoreLike,
  matchId: string,
  meta: MatchMeta,
  entries: readonly LogEntry[],
  cursorTick: number | undefined,
  oldest: number | undefined,
  seen: Set<string>
): void {
  const applied = collectNewEntries(
    entries,
    meta.cursor,
    cursorTick,
    oldest,
    seen
  );
  let nextSeq = meta.nextSeq;
  let maxEntryTick = meta.maxEntryTick;
  if (applied.kept.length > 0) {
    const bounds = chunkBounds(applied.kept);
    const chunk: CommandChunk = {
      firstTick: bounds.firstTick,
      lastTick: bounds.lastTick,
      entries: applied.kept,
    };
    commandStore.put(chunk, [matchId, nextSeq]);
    nextSeq += 1;
    for (const entry of applied.kept) {
      if (entry.tick > maxEntryTick) maxEntryTick = entry.tick;
    }
  }
  if (
    applied.kept.length === 0 &&
    applied.cursor === meta.cursor &&
    nextSeq === meta.nextSeq &&
    maxEntryTick === meta.maxEntryTick
  ) {
    return;
  }
  metaStore.put(
    {
      config: meta.config,
      cursor: applied.cursor,
      nextSeq,
      maxEntryTick,
      snapshotTicks: meta.snapshotTicks,
    },
    matchId
  );
}

function readOverlappingKeys(
  store: StoreLike,
  matchId: string,
  nextSeq: number,
  minTick: number,
  done: (seen: Set<string>) => void,
  fail: (error: unknown) => void
): void {
  const range = keyRange().bound([matchId, 0], [matchId, nextSeq - 1]);
  const request = store.openCursor(range, 'prev');
  const seen = new Set<string>();
  request.onsuccess = () => {
    try {
      const cursor = request.result;
      if (cursor == null) {
        done(seen);
        return;
      }
      const chunk = coerceChunk(cursor.value);
      if (chunk.lastTick < minTick) {
        done(seen);
        return;
      }
      rememberEntries(chunk.entries, seen);
      cursor.continue();
    } catch (error) {
      fail(error);
    }
  };
  request.onerror = () => {
    fail(errorOf(request.error, 'IndexedDbMatchStore: failed to read'));
  };
}

function deleteCoveredChunks(
  store: StoreLike,
  matchId: string,
  oldestTick: number,
  done: () => void,
  fail: (error: unknown) => void
): void {
  const request = store.openCursor(matchRange(matchId));
  request.onsuccess = () => {
    try {
      const cursor = request.result;
      if (cursor == null) {
        done();
        return;
      }
      const chunk = coerceChunk(cursor.value);
      if (chunk.lastTick > oldestTick) {
        done();
        return;
      }
      cursor.delete();
      cursor.continue();
    } catch (error) {
      fail(error);
    }
  };
  request.onerror = () => {
    fail(errorOf(request.error, 'IndexedDbMatchStore: failed to read'));
  };
}

function readSnapshots(
  tx: TxLike,
  matchId: string,
  meta: MatchMeta,
  done: (snapshots: Map<number, Uint8Array>) => void,
  fail: (error: unknown) => void
): void {
  const ticks = meta.snapshotTicks;
  if (ticks.length === 0) {
    done(new Map());
    return;
  }
  const store = tx.objectStore(SNAPSHOTS_STORE);
  const snapshots = new Map<number, Uint8Array>();
  let pending = ticks.length;
  for (const tick of ticks) {
    const get = store.get([matchId, tick]);
    get.onsuccess = () => {
      try {
        snapshots.set(tick, asSnapshotBytes(get.result));
        pending -= 1;
        if (pending === 0) done(snapshots);
      } catch (error) {
        fail(error);
      }
    };
    get.onerror = () => {
      fail(errorOf(get.error, 'IndexedDbMatchStore: failed to read'));
    };
  }
}

function readCommandEntries(
  store: StoreLike,
  matchId: string,
  done: (entries: LogEntry[]) => void,
  fail: (error: unknown) => void
): void {
  const request = store.openCursor(matchRange(matchId));
  const entries: LogEntry[] = [];
  request.onsuccess = () => {
    try {
      const cursor = request.result;
      if (cursor == null) {
        done(entries);
        return;
      }
      const chunk = coerceChunk(cursor.value);
      for (const entry of chunk.entries) entries.push(entry);
      cursor.continue();
    } catch (error) {
      fail(error);
    }
  };
  request.onerror = () => {
    fail(errorOf(request.error, 'IndexedDbMatchStore: failed to read'));
  };
}

function loadedFrom(
  meta: MatchMeta,
  snapshots: ReadonlyMap<number, Uint8Array>,
  entries: readonly LogEntry[]
): LoadedMatch {
  const config = meta.config;
  if (config === null) {
    throw new Error('IndexedDbMatchStore: corrupt meta');
  }
  const ticks = meta.snapshotTicks;
  const newestTick = ticks[ticks.length - 1];
  const olderTick = ticks.length >= 2 ? ticks[ticks.length - 2] : undefined;
  const loaded: LoadedMatch = {
    config,
    tail: entriesAfter(entries, newestTick),
    tick: meta.cursor,
  };
  if (newestTick === undefined) return loaded;
  const newestBytes = snapshots.get(newestTick);
  if (newestBytes === undefined) {
    throw new Error('IndexedDbMatchStore: corrupt snapshot');
  }
  const withNewest: LoadedMatch = {
    ...loaded,
    snapshot: { tick: newestTick, bytes: newestBytes },
  };
  if (olderTick === undefined) return withNewest;
  const olderBytes = snapshots.get(olderTick);
  if (olderBytes === undefined) {
    throw new Error('IndexedDbMatchStore: corrupt snapshot');
  }
  return {
    ...withNewest,
    previous: {
      snapshot: { tick: olderTick, bytes: olderBytes },
      tail: entriesAfter(entries, olderTick),
    },
  };
}

function cloneConfig(config: MatchConfig): MatchConfig {
  const row = emptyMatch();
  applyHeader(row, config);
  if (row.config === null) {
    throw new Error('MatchStore: config must be a match config');
  }
  return row.config;
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  return bytes.slice();
}

function emptyMeta(): MatchMeta {
  return {
    config: null,
    cursor: -1,
    nextSeq: 0,
    maxEntryTick: -1,
    snapshotTicks: [],
  };
}

function coerceMeta(value: unknown): MatchMeta {
  if (value === undefined) return emptyMeta();
  if (!isRecord(value)) {
    throw new Error('IndexedDbMatchStore: corrupt meta');
  }
  const cursor = value['cursor'];
  const nextSeq = value['nextSeq'];
  const maxEntryTick = value['maxEntryTick'];
  const snapshotTicks = value['snapshotTicks'];
  const config = value['config'];
  if (typeof cursor !== 'number' || !Number.isInteger(cursor)) {
    throw new Error('IndexedDbMatchStore: corrupt meta');
  }
  if (
    typeof nextSeq !== 'number' ||
    !Number.isInteger(nextSeq) ||
    nextSeq < 0
  ) {
    throw new Error('IndexedDbMatchStore: corrupt meta');
  }
  if (typeof maxEntryTick !== 'number' || !Number.isInteger(maxEntryTick)) {
    throw new Error('IndexedDbMatchStore: corrupt meta');
  }
  if (
    !Array.isArray(snapshotTicks) ||
    snapshotTicks.length > RETAINED_SNAPSHOTS
  ) {
    throw new Error('IndexedDbMatchStore: corrupt meta');
  }
  const ticks: number[] = [];
  for (const tick of snapshotTicks) {
    if (typeof tick !== 'number' || !Number.isInteger(tick) || tick < 0) {
      throw new Error('IndexedDbMatchStore: corrupt meta');
    }
    ticks.push(tick);
  }
  if (config !== null && !isRecord(config)) {
    throw new Error('IndexedDbMatchStore: corrupt meta');
  }
  return {
    config: config as MatchConfig | null,
    cursor,
    nextSeq,
    maxEntryTick,
    snapshotTicks: ticks,
  };
}

function coerceChunk(value: unknown): CommandChunk {
  if (!isRecord(value)) {
    throw new Error('IndexedDbMatchStore: corrupt command chunk');
  }
  const firstTick = value['firstTick'];
  const lastTick = value['lastTick'];
  const entries = value['entries'];
  if (typeof firstTick !== 'number' || !Number.isInteger(firstTick)) {
    throw new Error('IndexedDbMatchStore: corrupt command chunk');
  }
  if (typeof lastTick !== 'number' || !Number.isInteger(lastTick)) {
    throw new Error('IndexedDbMatchStore: corrupt command chunk');
  }
  if (!Array.isArray(entries)) {
    throw new Error('IndexedDbMatchStore: corrupt command chunk');
  }
  return {
    firstTick,
    lastTick,
    entries: entries as LogEntry[],
  };
}

function asSnapshotBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  throw new Error('IndexedDbMatchStore: corrupt snapshot');
}

function matchRange(matchId: string): unknown {
  return keyRange().bound([matchId, -Infinity], [matchId, Infinity]);
}

function openDatabase(
  name: string,
  onVersionChange: () => void
): Promise<IdbDatabaseLike> {
  const factory = indexedDbFactory();
  return new Promise((resolve, reject) => {
    let settled = false;
    const rejectOnce = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(
        error instanceof Error
          ? error
          : errorOf(error, 'IndexedDbMatchStore: failed to open')
      );
    };
    const request = factory.open(name, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const oldVersion = upgradeVersion(event);
      upgradeDatabase(request.result, oldVersion);
    };
    request.onsuccess = () => {
      if (settled) return;
      settled = true;
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        onVersionChange();
      };
      resolve(db);
    };
    request.onerror = () => {
      rejectOnce(errorOf(request.error, 'IndexedDbMatchStore: failed to open'));
    };
    request.onblocked = () => {
      rejectOnce(
        new Error('IndexedDbMatchStore: upgrade blocked by another connection')
      );
    };
  });
}

/**
 * Version 1 stored the whole match in `matches`. That data is discarded.
 * Later versions must migrate inside `oldVersion < N` instead of deleting.
 */
function upgradeDatabase(db: IdbDatabaseLike, oldVersion: number): void {
  if (oldVersion >= DB_VERSION) return;
  if (db.objectStoreNames.contains(LEGACY_STORE)) {
    db.deleteObjectStore(LEGACY_STORE);
  }
  if (!db.objectStoreNames.contains(META_STORE)) {
    db.createObjectStore(META_STORE);
  }
  if (!db.objectStoreNames.contains(COMMANDS_STORE)) {
    db.createObjectStore(COMMANDS_STORE);
  }
  if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
    db.createObjectStore(SNAPSHOTS_STORE);
  }
}

function upgradeVersion(event: unknown): number {
  if (!isRecord(event)) return 0;
  const version = event['oldVersion'];
  return typeof version === 'number' ? version : 0;
}

function withTransaction<T>(
  db: IdbDatabaseLike,
  stores: readonly string[],
  mode: 'readonly' | 'readwrite',
  run: (
    tx: TxLike,
    done: (value: T) => void,
    fail: (error: unknown) => void
  ) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let settled = false;
    const finish = (value: T): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(
        error instanceof Error
          ? error
          : errorOf(error, 'IndexedDbMatchStore: transaction failed')
      );
      try {
        tx.abort();
      } catch {
        // The transaction is already finished.
      }
    };
    tx.oncomplete = () => {
      if (mode === READONLY) return;
      finish(undefined as T);
    };
    tx.onerror = () => {
      fail(errorOf(tx.error, 'IndexedDbMatchStore: transaction failed'));
    };
    tx.onabort = () => {
      fail(errorOf(tx.error, 'IndexedDbMatchStore: transaction aborted'));
    };
    try {
      run(tx, finish, fail);
    } catch (error) {
      fail(error);
    }
  });
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

function keyRange(): IdbKeyRangeLike {
  const host: unknown = globalThis;
  if (!isRecord(host)) {
    throw new Error('IndexedDbMatchStore: IDBKeyRange is not available');
  }
  const candidate = host['IDBKeyRange'];
  if (!hasBound(candidate)) {
    throw new Error('IndexedDbMatchStore: IDBKeyRange is not available');
  }
  // `IDBKeyRange` is a function. `bound` was checked above. The DOM type
  // is not in this package's lib.
  return candidate;
}

function hasBound(value: unknown): value is IdbKeyRangeLike {
  if (typeof value !== 'function' && !isRecord(value)) return false;
  return typeof (value as { bound?: unknown }).bound === 'function';
}

function errorOf(error: unknown, fallback: string): Error {
  if (error instanceof Error && error.message.length > 0) return error;
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
  onupgradeneeded: ((event: unknown) => void) | null;
  onblocked: (() => void) | null;
}

interface CursorLike {
  readonly value: unknown;
  continue(): void;
  delete(): void;
}

interface StoreLike {
  get(key: unknown): RequestLike<unknown>;
  put(value: unknown, key: unknown): RequestLike<unknown>;
  delete(key: unknown): RequestLike<unknown>;
  openCursor(
    range?: unknown,
    direction?: string
  ): RequestLike<CursorLike | null>;
}

interface TxLike {
  readonly error: unknown;
  objectStore(name: string): StoreLike;
  abort(): void;
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
}

interface IdbDatabaseLike {
  readonly objectStoreNames: { contains(name: string): boolean };
  transaction(names: readonly string[], mode: 'readonly' | 'readwrite'): TxLike;
  createObjectStore(name: string): unknown;
  deleteObjectStore(name: string): void;
  close(): void;
  onversionchange: (() => void) | null;
}

interface IdbFactoryLike {
  open(name: string, version: number): OpenRequestLike<IdbDatabaseLike>;
}

interface IdbKeyRangeLike {
  bound(lower: unknown, upper: unknown): unknown;
}
