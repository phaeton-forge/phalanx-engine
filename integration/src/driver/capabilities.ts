/**
 * Feature flags a scenario can require. A missing flag skips the
 * scenario (or the single event) with a reason. Nothing is dropped quietly.
 */
export interface Capabilities {
  /** Slot hand-off (`replaceWithBot` / `returnFromBot`). Not on today's API. */
  readonly setController: boolean;
  /**
   * Replay a finished log without calling bot `decide`.
   * The adapter does this with `MatchRunner.openReplay` + `fastForward`.
   * The future `ReplayPlayer` type is the same flag.
   */
  readonly replayPlayer: boolean;
  /** Two OS processes can run the same match (det-continuous). */
  readonly multiProcess: boolean;
  /** Stage B: restart the relay / SimHost. */
  readonly restartServer: boolean;
}

export const CURRENT_CAPABILITIES: Capabilities = {
  setController: false,
  replayPlayer: true,
  multiProcess: true,
  restartServer: false,
};
