import type { StateReader, StateWriter } from './StateIO.js';

/**
 * Growable little-endian implementation of {@link StateWriter}.
 *
 * Capacity doubles as the buffer fills. `finish()` returns an exact-length
 * copy, so two writers that receive the same calls produce the same bytes
 * regardless of their initial capacity. There is deliberately no `f32` or
 * `f64` method: simulation values are integers or raw fixed-point `i64`s.
 */
export class BinaryStateWriter implements StateWriter {
  private buf: Uint8Array;
  private view: DataView;
  private length = 0;

  public constructor(initialCapacity = 64) {
    if (!Number.isInteger(initialCapacity) || initialCapacity < 0) {
      throw new Error(
        `BinaryStateWriter: initialCapacity must be an integer >= 0, got ${String(initialCapacity)}`
      );
    }
    this.buf = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buf.buffer);
  }

  /** Unsigned 8-bit integer, `0..255`. */
  public u8(v: number): void {
    assertIntegerInRange('StateWriter.u8', v, 0, 0xff);
    this.ensure(1);
    this.view.setUint8(this.length, v);
    this.length += 1;
  }

  /** Unsigned 32-bit integer, `0..2^32-1`. */
  public u32(v: number): void {
    assertIntegerInRange('StateWriter.u32', v, 0, 0xffffffff);
    this.ensure(4);
    this.view.setUint32(this.length, v, true);
    this.length += 4;
  }

  /** Signed 32-bit integer. */
  public i32(v: number): void {
    assertIntegerInRange('StateWriter.i32', v, -0x80000000, 0x7fffffff);
    this.ensure(4);
    this.view.setInt32(this.length, v, true);
    this.length += 4;
  }

  /** Unsigned LEB128, integer `0..2^53-1`. */
  public varint(v: number): void {
    assertIntegerInRange('StateWriter.varint', v, 0, Number.MAX_SAFE_INTEGER);
    let n = v;
    for (;;) {
      const bits = n % 128;
      n = Math.floor(n / 128);
      if (n === 0) {
        this.u8(bits);
        return;
      }
      this.u8(bits | 0x80);
    }
  }

  /** Signed 64-bit integer, little-endian. Throws outside int64. */
  public i64(v: bigint): void {
    if (typeof v !== 'bigint') {
      throw new Error(`StateWriter.i64: expected a bigint, got ${typeof v}`);
    }
    if (v < I64_MIN || v > I64_MAX) {
      throw new Error(
        `StateWriter.i64: value is outside int64 range, got ${String(v)}`
      );
    }
    this.ensure(8);
    this.view.setBigInt64(this.length, v, true);
    this.length += 8;
  }

  public bool(v: boolean): void {
    if (typeof v !== 'boolean') {
      throw new Error('StateWriter.bool: expected a boolean');
    }
    this.u8(v ? 1 : 0);
  }

  /**
   * UTF-8 bytes prefixed by `varint(byteLength)`.
   * Unpaired UTF-16 surrogates throw before any byte is written.
   * Strings of at most 128 characters reuse a bounded UTF-8 cache.
   * The well-formed check runs once, on the miss. Longer strings are
   * checked and encoded on every call and are not cached.
   */
  public str(v: string): void {
    if (typeof v !== 'string') {
      throw new Error('StateWriter.str: expected a string');
    }
    this.writeLengthPrefixed(encodeUtf8(v));
  }

  /** Raw bytes prefixed by `varint(byteLength)`. */
  public bytes(v: Uint8Array): void {
    if (!(v instanceof Uint8Array)) {
      throw new Error('StateWriter.bytes: expected a Uint8Array');
    }
    this.writeLengthPrefixed(v);
  }

  /**
   * `str(key)`, `varint(version)`, `varint(bodyLength)`, body.
   * The body is written in place. A throw inside `body` rolls `length`
   * back, so `finish()` is unchanged. The length varint is canonical
   * (no padding bytes).
   */
  public section(
    key: string,
    version: number,
    body: (w: StateWriter) => void
  ): void {
    const mark = this.length;
    try {
      this.str(key);
      this.varint(version);
      const slot = this.length;
      this.ensure(SECTION_LEN_SLOT);
      this.length += SECTION_LEN_SLOT;
      const bodyStart = this.length;
      body(this);
      const bodyLength = this.length - bodyStart;
      const width = varintWidth(bodyLength);
      if (width > SECTION_LEN_SLOT) {
        throw new Error('StateWriter.section: body length exceeds varint slot');
      }
      writeVarintAt(this.buf, slot, bodyLength);
      const extra = SECTION_LEN_SLOT - width;
      if (extra > 0) {
        this.buf.copyWithin(bodyStart - extra, bodyStart, this.length);
        this.length -= extra;
      }
    } catch (error) {
      this.length = mark;
      throw error;
    }
  }

  /** `varint(count)` then each item in the given order. */
  public list<T>(
    items: readonly T[],
    each: (item: T, w: StateWriter) => void
  ): void {
    this.varint(items.length);
    for (const item of items) {
      each(item, this);
    }
  }

  /**
   * `varint(count)` then each item sorted ascending by an integer key.
   * Keys are checked, and duplicates rejected, before any byte is written.
   */
  public sortedBy<T>(
    items: Iterable<T>,
    key: (item: T) => number,
    each: (item: T, w: StateWriter) => void
  ): void {
    const keyed: { item: T; itemKey: number }[] = [];
    for (const item of items) {
      const itemKey = key(item);
      if (!Number.isInteger(itemKey)) {
        throw new Error(
          `StateWriter.sortedBy: key must be an integer, got ${String(itemKey)}`
        );
      }
      keyed.push({ item, itemKey });
    }
    keyed.sort((a, b) => {
      if (a.itemKey < b.itemKey) return -1;
      if (a.itemKey > b.itemKey) return 1;
      return 0;
    });
    let previous: number | null = null;
    for (const entry of keyed) {
      if (previous === entry.itemKey) {
        throw new Error(
          `StateWriter.sortedBy: duplicate key ${String(entry.itemKey)}`
        );
      }
      previous = entry.itemKey;
    }
    this.varint(keyed.length);
    for (const entry of keyed) {
      each(entry.item, this);
    }
  }

  /** Exact-length copy of everything written so far. */
  public finish(): Uint8Array {
    return this.buf.slice(0, this.length);
  }

  /**
   * Drop written bytes and keep the buffer. The next `finish()` is empty
   * until new bytes are written. Used to reuse one writer across captures.
   */
  public reset(): void {
    this.length = 0;
  }

  /** `u8` without a range check. The caller guarantees `0..255`. */
  public u8Unchecked(v: number): void {
    this.ensure(1);
    this.buf[this.length] = v;
    this.length += 1;
  }

  /** `u32` without a range check. Little-endian. */
  public u32Unchecked(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.length, v, true);
    this.length += 4;
  }

  /** `i32` without a range check. Little-endian. */
  public i32Unchecked(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.length, v, true);
    this.length += 4;
  }

  /** `i64` without a range check. Little-endian. */
  public i64Unchecked(v: bigint): void {
    this.ensure(8);
    this.view.setBigInt64(this.length, v, true);
    this.length += 8;
  }

  private ensure(extra: number): void {
    const needed = this.length + extra;
    if (needed <= this.buf.length) return;
    // One allocation to the final power of two, not one doubling per call.
    let cap = Math.max(this.buf.length, 64);
    if (cap < needed) {
      cap = Math.max(needed, cap * 2);
    } else {
      cap *= 2;
    }
    let rounded = 64;
    while (rounded < cap) rounded *= 2;
    const next = new Uint8Array(rounded);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  private writeRaw(payload: Uint8Array): void {
    this.ensure(payload.byteLength);
    this.buf.set(payload, this.length);
    this.length += payload.byteLength;
  }

  private writeLengthPrefixed(payload: Uint8Array): void {
    this.varint(payload.byteLength);
    this.writeRaw(payload);
  }
}

/** Little-endian implementation of {@link StateReader}. */
export class BinaryStateReader implements StateReader {
  private readonly buf: Uint8Array;
  private readonly view: DataView;
  private offset = 0;

  public constructor(bytes: Uint8Array) {
    if (!(bytes instanceof Uint8Array)) {
      throw new Error('BinaryStateReader: expected a Uint8Array');
    }
    this.buf = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  public u8(): number {
    this.require(1);
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  public u32(): number {
    this.require(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  public i32(): number {
    this.require(4);
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  public varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = this.u8();
      result += (byte & 0x7f) * 2 ** shift;
      if (!Number.isSafeInteger(result)) {
        throw new Error('StateReader.varint: value exceeds 2^53-1');
      }
      if ((byte & 0x80) === 0) {
        // A continued group whose payload is 0 is an overlong encoding
        // (for example 0x80 0x00 for 0). The only canonical zero is 0x00.
        if (shift > 0 && (byte & 0x7f) === 0) {
          throw new Error('StateReader.varint: non-canonical encoding');
        }
        return result;
      }
      shift += 7;
      if (shift > 49) {
        throw new Error('StateReader.varint: value exceeds 2^53-1');
      }
    }
  }

  public i64(): bigint {
    this.require(8);
    const v = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return v;
  }

  public bool(): boolean {
    const v = this.u8();
    if (v === 0) return false;
    if (v === 1) return true;
    throw new Error(`StateReader.bool: expected 0 or 1, got ${String(v)}`);
  }

  public str(): string {
    const raw = this.bytes();
    try {
      return textDecoder.decode(raw);
    } catch (error) {
      throw new Error('StateReader.str: invalid UTF-8', { cause: error });
    }
  }

  public bytes(): Uint8Array {
    const length = this.varint();
    this.require(length);
    const out = this.buf.slice(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  public section<T>(
    key: string,
    read: (r: StateReader, version: number) => T
  ): T {
    const stored = this.str();
    if (stored !== key) {
      throw new Error(
        `StateReader.section: expected key '${key}', found '${stored}'`
      );
    }
    const version = this.varint();
    const length = this.varint();
    this.require(length);
    const nested = new BinaryStateReader(
      this.buf.subarray(this.offset, this.offset + length)
    );
    this.offset += length;
    const value = read(nested, version);
    const unread = nested.unreadCount();
    if (unread !== 0) {
      throw new Error(
        `StateReader.section: section '${key}' left ${String(unread)} unread byte(s)`
      );
    }
    return value;
  }

  public list<T>(read: (r: StateReader, index: number) => T): T[] {
    const count = this.varint();
    // `sortedBy` is read through `list`. Every item writes at least one byte,
    // so a count larger than the unread tail cannot be a real list.
    const remaining = this.unreadCount();
    if (count > remaining) {
      throw new Error(
        `StateReader.list: count ${String(count)} exceeds ${String(remaining)} remaining byte(s)`
      );
    }
    const out: T[] = [];
    for (let index = 0; index < count; index += 1) {
      out.push(read(this, index));
    }
    return out;
  }

  /**
   * Bytes not yet read. World restore uses this to see whether the next
   * section is the optional roster without consuming it.
   */
  public remainingBytes(): Uint8Array {
    return this.buf.subarray(this.offset);
  }

  /** Throws if unread bytes remain. */
  public done(): void {
    const unread = this.unreadCount();
    if (unread !== 0) {
      throw new Error(
        `StateReader.done: ${String(unread)} unread byte(s) remain`
      );
    }
  }

  private require(n: number): void {
    if (this.offset + n > this.buf.length) {
      throw new Error('StateReader: unexpected end of buffer');
    }
  }

  private unreadCount(): number {
    return this.buf.length - this.offset;
  }
}

const I64_MIN = -0x8000000000000000n;
const I64_MAX = 0x7fffffffffffffffn;

const textEncoder = new TextEncoder();
/** Max UTF-8 cache entries. Oldest key is dropped past this. */
const UTF8_CACHE_LIMIT = 4096;
/** Longer strings are encoded every call. They are not worth retaining. */
const UTF8_CACHE_MAX_CHARS = 128;
const utf8Cache = new Map<string, Uint8Array>();
/**
 * Reserved bytes for a section length. A safe-integer varint fits in 8.
 * The canonical width is written and the body is shifted left.
 */
const SECTION_LEN_SLOT = 8;

function encodeUtf8(value: string): Uint8Array {
  if (value.length > UTF8_CACHE_MAX_CHARS) {
    assertWellFormedUtf16(value);
    return textEncoder.encode(value);
  }
  const cached = utf8Cache.get(value);
  if (cached !== undefined) {
    utf8Cache.delete(value);
    utf8Cache.set(value, cached);
    return cached;
  }
  assertWellFormedUtf16(value);
  const encoded = textEncoder.encode(value);
  if (utf8Cache.size >= UTF8_CACHE_LIMIT) {
    const oldest = utf8Cache.keys().next().value;
    if (oldest !== undefined) utf8Cache.delete(oldest);
  }
  utf8Cache.set(value, encoded);
  return encoded;
}

function varintWidth(value: number): number {
  let width = 1;
  let n = value;
  while (n >= 128) {
    n = Math.floor(n / 128);
    width += 1;
  }
  return width;
}

function writeVarintAt(buf: Uint8Array, offset: number, value: number): void {
  let n = value;
  let written = 0;
  for (;;) {
    const bits = n % 128;
    n = Math.floor(n / 128);
    const last = n === 0;
    buf[offset + written] = last ? bits : bits | 0x80;
    written += 1;
    if (last) return;
  }
}
// `ignoreBOM` keeps a leading U+FEFF as data. The default strips it.
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const HIGH_SURROGATE_START = 0xd800;
const LOW_SURROGATE_START = 0xdc00;
const SURROGATE_END = 0xdfff;

function assertWellFormedUtf16(value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < HIGH_SURROGATE_START || code > SURROGATE_END) continue;
    const next = i + 1 < value.length ? value.charCodeAt(i + 1) : -1;
    if (
      code < LOW_SURROGATE_START &&
      next >= LOW_SURROGATE_START &&
      next <= SURROGATE_END
    ) {
      i += 1;
      continue;
    }
    throw new Error('StateWriter.str: unpaired surrogate');
  }
}

function assertIntegerInRange(
  method: string,
  value: number,
  min: number,
  max: number
): void {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(
      `${method}: expected an integer ${String(min)}..${String(max)}, got ${String(value)}`
    );
  }
}
