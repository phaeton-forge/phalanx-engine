import type { StateReader, StateWriter } from './StateIO.js';

/**
 * The whole simulation state of a match, sufficient to continue bit-for-bit
 * from the tick it was saved at. Implemented by the game with its own
 * classes; the engine calls it without knowing the format.
 *
 * Determinism requirements (normative, docs/design/runtime-api.md § GameState):
 * canonical bytes, deterministic order, no floats, completeness, round-trip
 * identity and continuation equality.
 */
export interface GameState {
  /** Write the full simulation state. Only through the writer. */
  save(w: StateWriter): void;
  /**
   * Restore into the world this object is bound to. The engine always binds
   * to a world freshly created by `createWorld(config, { purpose: 'restore' })`
   * and calls `restore` before the first tick of that world.
   */
  restore(r: StateReader): void;
}

/**
 * Converts the bytes of format `v` into format `v + 1`. Pure: bytes in,
 * bytes out, no simulation. The engine chains migrations up to the current
 * {@link GameStateSpec.formatVersion}.
 */
export type StateMigration = (old: StateReader, out: StateWriter) => void;

export interface GameStateSpec<Sim = unknown> {
  /** Version of the game's byte layout. Bump on any order/field change. */
  readonly formatVersion: number;
  /** Create the state object bound to a live simulation. */
  bind(sim: Sim): GameState;
  /** `migrate[v]` upgrades format `v` to `v + 1`. Missing step → reject. */
  readonly migrate?: Readonly<Record<number, StateMigration>>;
}
