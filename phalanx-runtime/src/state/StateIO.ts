/**
 * Canonical byte writer handed to {@link GameState.save}.
 *
 * Only deterministic primitives exist: there is deliberately no `f32`/`f64`
 * method. All multi-byte values are little-endian and fixed width; lengths
 * and counts are unsigned LEB128 varints. The byte stream is exactly the
 * sequence of calls, so the same calls always produce the same bytes.
 */
export interface StateWriter {
  /** Unsigned 8-bit integer, `0..255`. Throws otherwise. */
  u8(v: number): void;
  /** Unsigned 32-bit integer, `0..2^32-1`. Throws otherwise. */
  u32(v: number): void;
  /** Signed 32-bit integer. Throws otherwise. */
  i32(v: number): void;
  /** Unsigned LEB128 for lengths and counters, integer `0..2^53-1`. */
  varint(v: number): void;
  /** Signed 64-bit integer, e.g. `FP.ToRaw(fp)` from phalanx-math. */
  i64(v: bigint): void;
  bool(v: boolean): void;
  /** UTF-8 bytes prefixed by `varint(byteLength)`. */
  str(v: string): void;
  /** Raw bytes prefixed by `varint(byteLength)`. */
  bytes(v: Uint8Array): void;
  /**
   * Keyed, versioned, length-prefixed block. Lets readers verify the layout
   * section by section and lets tooling diff two snapshots per section.
   */
  section(key: string, version: number, body: (w: StateWriter) => void): void;
  /**
   * Writes `varint(count)` and then each item **in the given order**. Use
   * for arrays whose order is observable by simulation code (effect queues,
   * pool free lists, insertion-ordered `Set`s): restoring in the same order
   * keeps future iteration identical.
   */
  list<T>(items: readonly T[], each: (item: T, w: StateWriter) => void): void;
  /**
   * Writes `varint(count)` and then each item sorted ascending by an integer
   * key. Throws on non-integer or duplicate keys. Use only for containers
   * whose iteration order is NOT observable by simulation code.
   */
  sortedBy<T>(
    items: Iterable<T>,
    key: (item: T) => number,
    each: (item: T, w: StateWriter) => void
  ): void;
}

/** Mirror of {@link StateWriter}. Every method throws on malformed input. */
export interface StateReader {
  u8(): number;
  u32(): number;
  i32(): number;
  varint(): number;
  i64(): bigint;
  bool(): boolean;
  str(): string;
  bytes(): Uint8Array;
  /**
   * Reads a section written by {@link StateWriter.section}. Throws if the
   * stored key differs from `key` or if `read` does not consume exactly the
   * section body. `version` is the stored section version.
   */
  section<T>(key: string, read: (r: StateReader, version: number) => T): T;
  /** Reads what {@link StateWriter.list} or {@link StateWriter.sortedBy} wrote. */
  list<T>(read: (r: StateReader, index: number) => T): T[];
}
