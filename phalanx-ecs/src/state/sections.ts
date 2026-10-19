import type { GameWorld } from '../GameWorld.js';
import type { StateReader, StateWriter } from './StateIO.js';

/**
 * A module-owned slice of a world snapshot.
 *
 * The runtime writes every registered section inside one `modules`
 * container, sorted by `key` ascending (UTF-16 code units, `<`).
 */
export interface SaveSection {
  readonly key: string;
  readonly version: number;
  write(writer: StateWriter, world: GameWorld): void;
  read(reader: StateReader, world: GameWorld): void;
}

/** UTF-16 code unit order. `localeCompare` is not deterministic across hosts. */
export function compareSaveSectionKeys(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
