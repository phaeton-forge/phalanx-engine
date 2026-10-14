import type { LogEntry } from './CommandLog.js';

/**
 * Commands this runner has submitted for a future tick and not yet seen in
 * a delivered batch, in `(slot, seq)` order. `seq` is monotonic per slot
 * for the whole match.
 */
export interface PendingCommandBatch {
  readonly tick: number;
  readonly entries: readonly LogEntry[];
}

/** Next `seq` a slot will assign. */
export interface SlotSequence {
  readonly slot: number;
  readonly nextSeq: number;
}

/**
 * Input already submitted by this runner and not yet executed, plus the
 * per-slot sequence counters. Not simulation state and not part of the
 * digest: a peer that did not submit these commands ignores the section.
 *
 * Taken with the snapshot, after the tick's hosted `decide` calls. Task 6
 * serializes it with `BinaryStateWriter` (Task 2 only carries the bytes):
 * `sortedBy` batch by tick, each entry `str playerId`, `str type`,
 * `varint q`, then `canonicalConfigBytes` of the envelope payload; then
 * `sortedBy` `nextSeq` by slot.
 */
export interface InputCheckpoint {
  readonly pending: readonly PendingCommandBatch[];
  readonly nextSeq: readonly SlotSequence[];
}
