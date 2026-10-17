import type { LogEntry } from '../runner/CommandLog.js';
import {
  applyCommands,
  applyHeader,
  applySnapshot,
  assertMatchId,
  deleteStoredSnapshot,
  emptyMatch,
  snapshotTicksOf,
  toLoaded,
  type StoredMatch,
} from './matchRecord.js';
import type { LoadedMatch, MatchConfig, MatchStore } from './MatchStore.js';

/** In-memory {@link MatchStore}. Same retention rules as IndexedDB. */
export class MemoryMatchStore implements MatchStore {
  private readonly rows = new Map<string, StoredMatch>();

  public saveHeader(matchId: string, config: MatchConfig): Promise<void> {
    assertMatchId(matchId);
    applyHeader(this.row(matchId), config);
    return Promise.resolve();
  }

  public appendCommands(
    matchId: string,
    entries: readonly LogEntry[],
    cursorTick?: number
  ): Promise<void> {
    assertMatchId(matchId);
    applyCommands(this.row(matchId), entries, cursorTick);
    return Promise.resolve();
  }

  public saveSnapshot(
    matchId: string,
    tick: number,
    bytes: Uint8Array
  ): Promise<void> {
    assertMatchId(matchId);
    applySnapshot(this.row(matchId), tick, bytes);
    return Promise.resolve();
  }

  public load(matchId: string): Promise<LoadedMatch | null> {
    assertMatchId(matchId);
    const row = this.rows.get(matchId);
    if (row === undefined) return Promise.resolve(null);
    return Promise.resolve(toLoaded(row));
  }

  public clear(matchId: string): Promise<void> {
    assertMatchId(matchId);
    this.rows.delete(matchId);
    return Promise.resolve();
  }

  public deleteSnapshot(matchId: string, tick: number): Promise<void> {
    assertMatchId(matchId);
    const row = this.rows.get(matchId);
    if (row === undefined) return Promise.resolve();
    try {
      deleteStoredSnapshot(row, tick);
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new Error('MatchStore: deleteSnapshot failed')
      );
    }
    return Promise.resolve();
  }

  /** Ticks of the snapshots still stored, oldest first. At most two. */
  public snapshotTicks(matchId: string): Promise<readonly number[]> {
    assertMatchId(matchId);
    const row = this.rows.get(matchId);
    if (row === undefined) return Promise.resolve([]);
    return Promise.resolve(snapshotTicksOf(row));
  }

  private row(matchId: string): StoredMatch {
    let row = this.rows.get(matchId);
    if (row === undefined) {
      row = emptyMatch();
      this.rows.set(matchId, row);
    }
    return row;
  }
}
