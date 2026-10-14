/** A snapshot failed the version policy, its digest check, or decoding. */
export class SnapshotRejectedError extends Error {
  public constructor(reason: string, options?: ErrorOptions) {
    super(`snapshot rejected: ${reason}`, options);
    this.name = 'SnapshotRejectedError';
  }
}

/**
 * `GameState.save()` after `GameState.restore()` did not reproduce the
 * snapshot body byte for byte, i.e. the game's save/restore pair is lossy.
 */
export class SnapshotRoundTripError extends Error {
  /** Name of the first section whose bytes differ, when known. */
  public readonly section: string | undefined;

  public constructor(section?: string) {
    super(
      section === undefined
        ? 'snapshot round-trip mismatch'
        : `snapshot round-trip mismatch in section '${section}'`
    );
    this.name = 'SnapshotRoundTripError';
    this.section = section;
  }
}
