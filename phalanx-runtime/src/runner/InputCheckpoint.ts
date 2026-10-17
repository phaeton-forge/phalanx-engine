import type { JsonValue } from '../game/commands.js';
import { BinaryStateReader, BinaryStateWriter } from '../state/BinaryState.js';
import type { StateReader, StateWriter } from '../state/StateIO.js';
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
 * `varint q`, then the payload codec below; then `sortedBy` `nextSeq` by
 * slot; then `varint systemSeq` (the next `q` for `playerId` `system`).
 *
 * Payloads use their own codec, not `canonicalConfigBytes`. Match configs
 * stay safe integers. A command payload may be any finite JSON number,
 * including fractions. Object keys are still sorted by UTF-16 code unit.
 */
export interface InputCheckpoint {
  readonly pending: readonly PendingCommandBatch[];
  readonly nextSeq: readonly SlotSequence[];
  /**
   * Next `q` for a system command. Outside the digest. A restored runner's
   * log does not contain commands applied before the snapshot, so this
   * counter is what keeps `(system, q)` unique across the match.
   */
  readonly systemSeq: number;
}

const TAG_NULL = 0;
const TAG_BOOL = 1;
const TAG_NUM = 2;
const TAG_STR = 3;
const TAG_ARRAY = 4;
const TAG_OBJECT = 5;

/**
 * Bytes of an {@link InputCheckpoint}.
 *
 * `sortedBy` batch by tick (the tick is written; `sortedBy` only orders),
 * each entry `str playerId`, `str type`, `varint q`, then the canonical
 * payload bytes; then `sortedBy` `nextSeq` by slot (`varint slot`,
 * `varint nextSeq`); then `varint systemSeq`.
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
        entryWriter.bytes(canonicalJsonBytes(entry.data.p));
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
  writer.varint(checkpoint.systemSeq);
  return writer.finish();
}

/**
 * Payload with object keys in the canonical UTF-16 order.
 * `encodeInputCheckpoint` stores this form, so a live log entry must use
 * it too or a restored command log is not byte-identical. Finite numbers,
 * including fractions, round-trip. `canonicalConfigBytes` is unchanged
 * and still rejects non-integers.
 */
export function canonicalJsonValue(value: JsonValue): JsonValue {
  return decodeCanonical(canonicalJsonBytes(value));
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
  const systemSeq = reader.varint();
  reader.done();
  return { pending, nextSeq, systemSeq };
}

function canonicalJsonBytes(value: JsonValue): Uint8Array {
  const writer = new BinaryStateWriter();
  writeCanonical(writer, value, new Set());
  return writer.finish();
}

function decodeCanonical(bytes: Uint8Array): JsonValue {
  const reader = new BinaryStateReader(bytes);
  const value = readCanonical(reader);
  reader.done();
  return value;
}

/**
 * Payload codec. Tag `2` is a decimal string of a finite JSON number
 * (`String(n)`, with `-0` kept distinct), not a safe-integer `i64`.
 */
function writeCanonical(
  writer: StateWriter,
  value: JsonValue,
  stack: Set<object>
): void {
  if (value === null) {
    writer.u8(TAG_NULL);
    return;
  }
  switch (typeof value) {
    case 'boolean':
      writer.u8(TAG_BOOL);
      writer.bool(value);
      return;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error(
          `input checkpoint: number must be finite, got ${String(value)}`
        );
      }
      writer.u8(TAG_NUM);
      writer.str(Object.is(value, -0) ? '-0' : String(value));
      return;
    case 'string':
      writer.u8(TAG_STR);
      writer.str(value);
      return;
    case 'object':
      break;
    default:
      throw new Error(
        `input checkpoint: unsupported payload type ${typeof value}`
      );
  }
  if (stack.has(value)) {
    throw new Error('input checkpoint: circular reference');
  }
  stack.add(value);
  try {
    if (isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new Error('input checkpoint: class instances are not allowed');
      }
      writer.u8(TAG_ARRAY);
      writer.varint(value.length);
      for (const element of value) writeCanonical(writer, element, stack);
      return;
    }
    if (!isPlainObject(value)) {
      throw new Error('input checkpoint: class instances are not allowed');
    }
    const keys = Object.keys(value).sort();
    writer.u8(TAG_OBJECT);
    writer.varint(keys.length);
    for (const key of keys) {
      const child = value[key];
      if (child === undefined) {
        throw new Error('input checkpoint: undefined is not allowed');
      }
      writer.str(key);
      writeCanonical(writer, child, stack);
    }
  } finally {
    stack.delete(value);
  }
}

function readCanonical(reader: StateReader): JsonValue {
  const tag = reader.u8();
  switch (tag) {
    case TAG_NULL:
      return null;
    case TAG_BOOL:
      return reader.bool();
    case TAG_NUM: {
      const text = reader.str();
      const value = Number(text);
      if (!Number.isFinite(value)) {
        throw new Error(`input checkpoint: bad canonical number '${text}'`);
      }
      return value;
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
        // `__proto__` and `constructor` must be own data properties.
        // Assignment would invoke the prototype setter.
        Object.defineProperty(value, key, {
          value: readCanonical(reader),
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      return value;
    }
    default:
      throw new Error(`input checkpoint: bad canonical tag ${String(tag)}`);
  }
}

function isArray(value: object): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function isPlainObject(
  value: object
): value is { [key: string]: JsonValue | undefined } {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
