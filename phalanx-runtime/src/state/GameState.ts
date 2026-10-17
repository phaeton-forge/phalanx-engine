import type { StateReader, StateWriter } from './StateIO.js';

/**
 * The whole simulation state of a match, sufficient to continue bit-for-bit
 * from the tick it was saved at. Games that do not pass `save` use the
 * world modules. A custom handler lives on `defineGame({ save })`.
 *
 * Determinism requirements: canonical bytes, deterministic order, no
 * floats, completeness, round-trip identity and continuation equality.
 */
export interface SaveHandler {
  /** Write the full simulation state. Only through the writer. */
  save(w: StateWriter): void;
  /**
   * Restore into the world this object is bound to. The engine binds it
   * to a world from `onStart` with `purpose: 'restore'` and calls
   * `restore` before the first tick of that world.
   */
  restore(r: StateReader): void;
}

/**
 * Converts the bytes of format `v` into format `v + 1`. Pure: bytes in,
 * bytes out, no simulation. The engine chains migrations up to the current
 * {@link SaveSpec.formatVersion}.
 */
export type StateMigration = (old: StateReader, out: StateWriter) => void;

export interface SaveSpec<Sim = unknown> {
  /** Version of the game's byte layout. Bump on any order/field change. */
  readonly formatVersion: number;
  /** Create the handler bound to a live simulation. */
  handler(sim: Sim): SaveHandler;
  /** `migrate[v]` upgrades format `v` to `v + 1`. Missing step → reject. */
  readonly migrate?: Readonly<Record<number, StateMigration>>;
}
