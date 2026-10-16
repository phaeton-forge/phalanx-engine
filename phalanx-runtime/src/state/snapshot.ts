import { SNAPSHOT_MAGIC } from '../constants.js';
import { BinaryStateReader, BinaryStateWriter } from './BinaryState.js';
import { digestBytes } from './digest.js';
import { SnapshotRejectedError } from './errors.js';

export { digestBytes };

const MAGIC_BYTES = new Uint8Array(SNAPSHOT_MAGIC.length);
for (let i = 0; i < SNAPSHOT_MAGIC.length; i += 1) {
  MAGIC_BYTES[i] = SNAPSHOT_MAGIC.charCodeAt(i);
}

/** A complete engine snapshot: header, game body, optional bot and input state. */
export type SnapshotBytes = Uint8Array;

/** Lowercase hex xxhash64 of a byte string (16 characters). */
export type Digest = string;

/** Header written and checked by the ENGINE; the game never touches it. */
export interface SnapshotHeader {
  readonly magic: 'PHXS';
  /** {@link ENGINE_SNAPSHOT_FORMAT} of the writer. */
  readonly engineFormat: number;
  readonly gameId: string;
  /** `GameDefinition.simVersion`. */
  readonly simVersion: string;
  /** `GameStateSpec.formatVersion`. */
  readonly formatVersion: number;
  /** {@link configHash} of the match config. */
  readonly configHash: Digest;
  /** Last completed tick. The restored runner continues with `tick + 1`. */
  readonly tick: number;
  /** {@link digestBytes} of the body (GameState bytes only). */
  readonly digest: Digest;
}

export interface DecodedSnapshot {
  readonly header: SnapshotHeader;
  /** Bytes written by `GameState.save`. Covered by `header.digest`. */
  readonly body: Uint8Array;
  /**
   * State of the bot policies hosted by the runner that took the snapshot,
   * or `null`. Not part of the digest. A runner restores it only for slots
   * it hosts; a client ignores a server snapshot's bot state.
   */
  readonly botState: Uint8Array | null;
  /**
   * InputCheckpoint bytes of the runner that took the snapshot, or
   * `null`. Not part of the digest. Holds commands submitted but not yet
   * delivered, so a local resume does not lose the input-delay queue.
   * Applied only for slots this runner submits; ignored on a snapshot
   * received from the network.
   */
  readonly inputCheckpoint: Uint8Array | null;
}

export type VersionDecision = 'accept' | 'migrate' | 'reject';

export interface CompatibilityResult {
  readonly decision: VersionDecision;
  readonly reason?: string;
}

export interface ExpectedSnapshotIdentity {
  readonly engineFormat: number;
  readonly gameId: string;
  readonly simVersion: string;
  readonly formatVersion: number;
  readonly configHash: Digest;
}

/** Sections outside the digest. Both are optional. */
export interface SnapshotExtras {
  readonly botState?: Uint8Array | null;
  readonly inputCheckpoint?: Uint8Array | null;
}

/**
 * Byte layout (all through {@link BinaryStateWriter}, little-endian):
 *
 * 1. 4 bytes ASCII `PHXS`;
 * 2. `varint engineFormat`, `str gameId`, `str simVersion`,
 *    `varint formatVersion`, `str configHash`, `varint tick`, `str digest`;
 * 3. `bytes body` (GameState bytes; this is the only input to `digest`);
 * 4. `bool hasBotState`, then `bytes botState` when the flag is set;
 * 5. `bool hasInputCheckpoint`, then `bytes inputCheckpoint` when set.
 *
 * `engineFormat`, `formatVersion` and `tick` are varints, not fixed `u32`s.
 * An empty `Uint8Array` extra is stored (flag set, length 0). `null` and
 * omission both store the flag clear and decode back to `null`.
 */
export function encodeSnapshot(
  header: Omit<SnapshotHeader, 'magic' | 'digest'>,
  body: Uint8Array,
  extras?: SnapshotExtras
): SnapshotBytes {
  if (header === null || typeof header !== 'object') {
    throw new Error('encodeSnapshot: header must be an object');
  }
  requireVarintField('engineFormat', header.engineFormat);
  requireStringField('gameId', header.gameId);
  requireStringField('simVersion', header.simVersion);
  requireVarintField('formatVersion', header.formatVersion);
  requireStringField('configHash', header.configHash);
  requireVarintField('tick', header.tick);
  if (!(body instanceof Uint8Array)) {
    throw new Error('encodeSnapshot: body must be a Uint8Array');
  }
  const botState = optionalBytes(extras?.botState, 'botState');
  const inputCheckpoint = optionalBytes(
    extras?.inputCheckpoint,
    'inputCheckpoint'
  );
  const digest = digestBytes(body);

  const w = new BinaryStateWriter();
  for (const byte of MAGIC_BYTES) {
    w.u8(byte);
  }
  w.varint(header.engineFormat);
  w.str(header.gameId);
  w.str(header.simVersion);
  w.varint(header.formatVersion);
  w.str(header.configHash);
  w.varint(header.tick);
  w.str(digest);
  w.bytes(body);
  w.bool(botState !== null);
  if (botState !== null) w.bytes(botState);
  w.bool(inputCheckpoint !== null);
  if (inputCheckpoint !== null) w.bytes(inputCheckpoint);
  return w.finish();
}

/**
 * Inverse of {@link encodeSnapshot}. Throws {@link SnapshotRejectedError}
 * when the magic is wrong, the buffer is truncated, trailing bytes remain,
 * or `header.digest` is not `digestBytes(body)`. A reader failure (truncated
 * tail, trailing bytes, malformed varint) is rethrown as
 * {@link SnapshotRejectedError} with the original error as `cause`.
 */
export function decodeSnapshot(bytes: SnapshotBytes): DecodedSnapshot {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('decodeSnapshot: expected a Uint8Array');
  }
  if (bytes.byteLength < MAGIC_BYTES.length) {
    throw new SnapshotRejectedError('truncated snapshot');
  }
  if (!hasMagic(bytes)) {
    throw new SnapshotRejectedError('magic mismatch');
  }

  try {
    return parseSnapshot(bytes.subarray(MAGIC_BYTES.length));
  } catch (error) {
    if (error instanceof SnapshotRejectedError) throw error;
    const reason =
      error instanceof Error ? error.message : 'malformed snapshot';
    throw new SnapshotRejectedError(reason, { cause: error });
  }
}

function parseSnapshot(payload: Uint8Array): DecodedSnapshot {
  const r = new BinaryStateReader(payload);
  const engineFormat = r.varint();
  const gameId = r.str();
  const simVersion = r.str();
  const formatVersion = r.varint();
  const configHash = r.str();
  const tick = r.varint();
  const digest = r.str();
  const body = r.bytes();
  const hasBotState = r.bool();
  const botState = hasBotState ? r.bytes() : null;
  const hasInputCheckpoint = r.bool();
  const inputCheckpoint = hasInputCheckpoint ? r.bytes() : null;
  r.done();

  const actual = digestBytes(body);
  if (digest !== actual) {
    throw new SnapshotRejectedError('digest mismatch');
  }

  return {
    header: {
      magic: SNAPSHOT_MAGIC,
      engineFormat,
      gameId,
      simVersion,
      formatVersion,
      configHash,
      tick,
      digest,
    },
    body,
    botState,
    inputCheckpoint,
  };
}

/**
 * Canonical bytes of a JSON-safe match config.
 *
 * Type tag (`u8`) then payload, written with {@link BinaryStateWriter}:
 * `0` null, `1` bool, `2` safe integer (`i64`), `3` string, `4` array
 * (`varint` length, elements in order), `5` object (`varint` count, then
 * `str` key + value). Object keys are sorted by UTF-16 code unit
 * (`Array.prototype.sort()` with no comparator). Only own enumerable string
 * keys are visited.
 *
 * Throws on non-integer numbers, `bigint`, `undefined`, functions, symbols,
 * unpaired UTF-16 surrogates (string values and object keys, via
 * {@link BinaryStateWriter.str}), and class instances (anything whose
 * prototype is not `Object.prototype`, `null`, or `Array.prototype`).
 */
export function canonicalConfigBytes(config: unknown): Uint8Array {
  const w = new BinaryStateWriter();
  writeCanonical(w, config, new Set());
  return w.finish();
}

/**
 * `digestBytes(canonicalConfigBytes(config))`.
 *
 * When `componentNames` is non-empty, those names are appended in
 * registration order (array order, not sorted) before the digest. An
 * empty list matches the one-argument hash.
 */
export function configHash(
  config: unknown,
  componentNames?: readonly string[]
): Digest {
  const configBytes = canonicalConfigBytes(config);
  if (componentNames === undefined || componentNames.length === 0) {
    return digestBytes(configBytes);
  }
  const nameBytes = canonicalConfigBytes(componentNames);
  const combined = new Uint8Array(
    configBytes.byteLength + nameBytes.byteLength
  );
  combined.set(configBytes, 0);
  combined.set(nameBytes, configBytes.byteLength);
  return digestBytes(combined);
}

/**
 * Version policy for an already-decoded header.
 *
 * Rejects a bad `magic`, or any `engineFormat`, `gameId`, `configHash` or
 * `simVersion` mismatch, or a newer `formatVersion`. Returns `migrate` when
 * the stored format is older and every step `migrations[v]` exists for
 * `v` from the stored format up to (but not including) the expected format.
 * `migrations[v]` is the step from version `v` to `v + 1`.
 * Otherwise accepts.
 *
 * The digest is not an input here: {@link decodeSnapshot} rejects a body
 * whose xxhash64 does not match `header.digest`.
 */
export function checkSnapshotCompatibility(
  header: SnapshotHeader,
  expected: ExpectedSnapshotIdentity,
  migrations?: Readonly<Record<number, unknown>>
): CompatibilityResult {
  if (header.magic !== SNAPSHOT_MAGIC) {
    return { decision: 'reject', reason: 'magic mismatch' };
  }
  if (header.engineFormat !== expected.engineFormat) {
    return { decision: 'reject', reason: 'engineFormat mismatch' };
  }
  if (header.gameId !== expected.gameId) {
    return { decision: 'reject', reason: 'gameId mismatch' };
  }
  if (header.configHash !== expected.configHash) {
    return { decision: 'reject', reason: 'configHash mismatch' };
  }
  if (header.simVersion !== expected.simVersion) {
    return { decision: 'reject', reason: 'simVersion mismatch' };
  }
  if (header.formatVersion > expected.formatVersion) {
    return { decision: 'reject', reason: 'formatVersion is newer' };
  }
  if (header.formatVersion < expected.formatVersion) {
    for (let v = header.formatVersion; v < expected.formatVersion; v += 1) {
      if (migrations === undefined || migrations[v] === undefined) {
        return {
          decision: 'reject',
          reason: `missing migration from format ${String(v)}`,
        };
      }
    }
    return { decision: 'migrate' };
  }
  return { decision: 'accept' };
}

const TAG_NULL = 0;
const TAG_BOOL = 1;
const TAG_INT = 2;
const TAG_STR = 3;
const TAG_ARRAY = 4;
const TAG_OBJECT = 5;

function writeCanonical(
  w: BinaryStateWriter,
  value: unknown,
  stack: Set<object>
): void {
  if (value === null) {
    w.u8(TAG_NULL);
    return;
  }
  switch (typeof value) {
    case 'boolean':
      w.u8(TAG_BOOL);
      w.bool(value);
      return;
    case 'number':
      if (!Number.isSafeInteger(value)) {
        throw new Error(
          `canonicalConfigBytes: number must be a safe integer, got ${String(value)}`
        );
      }
      w.u8(TAG_INT);
      w.i64(BigInt(value));
      return;
    case 'string':
      w.u8(TAG_STR);
      w.str(value);
      return;
    case 'undefined':
      throw new Error('canonicalConfigBytes: undefined is not allowed');
    case 'bigint':
      throw new Error('canonicalConfigBytes: bigint is not allowed');
    case 'function':
      throw new Error('canonicalConfigBytes: functions are not allowed');
    case 'symbol':
      throw new Error('canonicalConfigBytes: symbols are not allowed');
    case 'object':
      break;
    default:
      throw new Error(`canonicalConfigBytes: unsupported type ${typeof value}`);
  }

  if (stack.has(value)) {
    throw new Error('canonicalConfigBytes: circular reference');
  }
  stack.add(value);
  try {
    if (isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new Error(
          'canonicalConfigBytes: class instances are not allowed'
        );
      }
      w.u8(TAG_ARRAY);
      w.varint(value.length);
      for (const element of value) {
        writeCanonical(w, element, stack);
      }
      return;
    }
    if (!isPlainObject(value)) {
      throw new Error('canonicalConfigBytes: class instances are not allowed');
    }
    const keys = Object.keys(value).sort();
    w.u8(TAG_OBJECT);
    w.varint(keys.length);
    for (const key of keys) {
      w.str(key);
      writeCanonical(w, value[key], stack);
    }
  } finally {
    stack.delete(value);
  }
}

function isArray(value: object): value is readonly unknown[] {
  return Array.isArray(value);
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasMagic(bytes: Uint8Array): boolean {
  for (let i = 0; i < MAGIC_BYTES.length; i += 1) {
    if (bytes[i] !== MAGIC_BYTES[i]) return false;
  }
  return true;
}

function requireVarintField(name: string, value: number): void {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error(
      `encodeSnapshot: ${name} must be an integer 0..2^53-1, got ${String(value)}`
    );
  }
}

function requireStringField(name: string, value: string): void {
  if (typeof value !== 'string') {
    throw new Error(`encodeSnapshot: ${name} must be a string`);
  }
}

function optionalBytes(
  value: Uint8Array | null | undefined,
  label: string
): Uint8Array | null {
  if (value === undefined || value === null) return null;
  if (!(value instanceof Uint8Array)) {
    throw new Error(`encodeSnapshot: ${label} must be a Uint8Array or null`);
  }
  return value;
}
