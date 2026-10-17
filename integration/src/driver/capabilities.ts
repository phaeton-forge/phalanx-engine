/**
 * Feature flags a scenario can require. A missing flag skips the
 * scenario (or the single event) with a reason. Nothing is dropped quietly.
 */
export interface Capabilities {
  /** Slot hand-off (`replaceWithBot` / `returnFromBot`) via `setController`. */
  readonly setController: boolean;
  /**
   * Replay a finished log without calling bot `decide`.
   * The v65 adapter does this with `ReplayPlayer`.
   */
  readonly replayPlayer: boolean;
  /** Two OS processes can run the same match (det-continuous). */
  readonly multiProcess: boolean;
  /** Stage B: restart the relay / SimHost. */
  readonly restartServer: boolean;
}

export const V65_CAPABILITIES: Capabilities = {
  setController: true,
  replayPlayer: true,
  multiProcess: true,
  restartServer: false,
};
