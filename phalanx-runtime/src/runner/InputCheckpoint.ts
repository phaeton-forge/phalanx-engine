import type { JsonValue } from '../game/commands.js';
import { BinaryStateReader, BinaryStateWriter } from '../state/BinaryState.js';
import { canonicalConfigBytes } from '../state/snapshot.js';
import type { StateReader } from '../state/StateIO.js';
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

const TAG_NULL = 0;
const TAG_BOOL = 1;
const TAG_INT = 2;
const TAG_STR = 3;
const TAG_ARRAY = 4;
const TAG_OBJECT = 5;

/**
 * Bytes of an {@link InputCheckpoint}.
 *
 * `sortedBy` batch by tick (the tick is written; `sortedBy` only orders),
 * each entry `str playerId`, `str type`, `varint q`, then
 * `canonicalConfigBytes` of the envelope payload; then `sortedBy` `nextSeq`
 * by slot (`varint slot`, `varint nextSeq`).
 */
export function encodeInputCheckpoint(checkpoint: InputCheckpoint): Uint8Array {
  const writer = new BinaryStateWriter();
  writer.sortedBy(
    checkpoint.pending,
    (batch) => batch.tick,
    (batch, batchWriter) => {
      batchWriter.varint(batch.tick);
      batchWriter.list(batch.entries, (entry, entryWriter) => {
        entryWriter.str(entry.playerId);
        entryWriter.str(entry.type);
        entryWriter.varint(entry.data.q);
        entryWriter.bytes(
          canonicalConfigBytes(canonicalJsonValue(entry.data.p))
        );
      });
    }
  );
  writer.sortedBy(
    checkpoint.nextSeq,
    (seq) => seq.slot,
    (seq, seqWriter) => {
      seqWriter.varint(seq.slot);
      seqWriter.varint(seq.nextSeq);
    }
  );
  return writer.finish();
}

/**
 * Payload with object keys in the canonical UTF-16 order.
 * `encodeInputCheckpoint` stores this form, so a live log entry must use
 * it too or a restored command log is not byte-identical.
 */
export function canonicalJsonValue(value: JsonValue): JsonValue {
  return decodeCanonical(canonicalConfigBytes(value));
}

/** Inverse of {@link encodeInputCheckpoint}. */
export function decodeInputCheckpoint(bytes: Uint8Array): InputCheckpoint {
  const reader = new BinaryStateReader(bytes);
  const pending = reader.list((batchReader) => {
    const tick = batchReader.varint();
    const entries = batchReader.list((entryReader) => {
      const playerId = entryReader.str();
      const type = entryReader.str();
      const q = entryReader.varint();
      const payload = decodeCanonical(entryReader.bytes());
      const entry: LogEntry = {
        tick,
        playerId,
        type,
        data: { q, p: payload },
      };
      return entry;
    });
    const batch: PendingCommandBatch = { tick, entries };
    return batch;
  });
  const nextSeq = reader.list((seqReader) => {
    const slot = seqReader.varint();
    const seq = seqReader.varint();
    return { slot, nextSeq: seq };
  });
  reader.done();
  return { pending, nextSeq };
}

function decodeCanonical(bytes: Uint8Array): JsonValue {
  const reader = new BinaryStateReader(bytes);
  const value = readCanonical(reader);
  reader.done();
  return value;
}

/** Mirrors `canonicalConfigBytes` in `snapshot.ts`. */
function readCanonical(reader: StateReader): JsonValue {
  const tag = reader.u8();
  switch (tag) {
    case TAG_NULL:
      return null;
    case TAG_BOOL:
      return reader.bool();
    case TAG_INT: {
      const raw = reader.i64();
      const max = BigInt(Number.MAX_SAFE_INTEGER);
      const min = BigInt(Number.MIN_SAFE_INTEGER);
      if (raw > max || raw < min) {
        throw new Error(
          'input checkpoint: canonical integer does not fit a JSON number'
        );
      }
      return Number(raw);
    }
    case TAG_STR:
      return reader.str();
    case TAG_ARRAY: {
      const count = reader.varint();
      const items: JsonValue[] = [];
      for (let index = 0; index < count; index += 1) {
        items.push(readCanonical(reader));
      }
      return items;
    }
    case TAG_OBJECT: {
      const count = reader.varint();
      const value: { [key: string]: JsonValue } = {};
      for (let index = 0; index < count; index += 1) {
        const key = reader.str();
        value[key] = readCanonical(reader);
      }
      return value;
    }
    default:
      throw new Error(`input checkpoint: bad canonical tag ${String(tag)}`);
  }
}
