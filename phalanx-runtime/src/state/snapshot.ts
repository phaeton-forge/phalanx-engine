import { SNAPSHOT_MAGIC } from '../constants.js';
import { BinaryStateReader, BinaryStateWriter } from '@phalanx-engine/ecs';
import { digestBytes } from './digest.js';
import { SnapshotRejectedError } from './errors.js';

export { digestBytes };

const MAGIC_BYTES = Uint8Array.from(SNAPSHOT_MAGIC, (char) =>
  char.charCodeAt(0)
);

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
  /**
   * Registered component schemas of the writer, or `null` when the writer
   * registered none. Outside the digest. Restore compares this with the
   * booted world and names the field that changed.
   */
  readonly componentSchemas: string | null;
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
  /**
   * {@link componentSchemaKey} of the writer's registered components.
   * `null` and omission both store the flag clear. Outside the digest.
   */
  readonly componentSchemas?: string | null;
}

/**
 * One registered component, in `registerComponent` order.
 * `fields` is declaration order, not sorted.
 */
export interface ComponentSchemaHash {
  readonly name: string;
  readonly fields: readonly (readonly [string, string])[];
}

/**
 * Byte layout (all through {@link BinaryStateWriter}, little-endian):
 *
 * 1. 4 bytes ASCII `PHXS`;
 * 2. `varint engineFormat`, `str gameId`, `str simVersion`,
 *    `varint formatVersion`, `str configHash`, `varint tick`, `str digest`;
 * 3. `bytes body` (GameState bytes; this is the only input to `digest`);
 * 4. `bool hasBotState`, then `bytes botState` when the flag is set;
 * 5. `bool hasInputCheckpoint`, then `bytes inputCheckpoint` when set;
 * 6. `bool hasComponentSchemas`, then `str componentSchemas` when set.
 *    The string is outside the digest. It names each registered component
 *    and its fields so restore can report a schema change. The game body
 *    (SoA sections) is unchanged.
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
  const componentSchemas = optionalSchema(extras?.componentSchemas);
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
  w.bool(componentSchemas !== null);
  if (componentSchemas !== null) w.str(componentSchemas);
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
  const hasComponentSchemas = r.bool();
  const componentSchemas = hasComponentSchemas ? r.str() : null;
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
    componentSchemas,
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
 * One command in declaration order. `fields` is declaration order, not
 * sorted. A string field's type token is `string` or `string(maxLength)`.
 */
export interface CommandSchemaHash {
  readonly name: string;
  readonly fields: readonly (readonly [string, string])[];
}

/**
 * `digestBytes` of the canonical config, then component records, then
 * command records.
 *
 * Component records are appended only when the list is non-empty, in
 * registration order. Each record is the component name plus its field
 * names and types in declaration order. Command records are appended
 * only when that list is non-empty, in declaration order. An empty list
 * does not change the digest. Swapping two fields, or changing `u32` to
 * `i32`, changes the digest. A command schema change does too.
 */
export function configHash(
  config: unknown,
  components?: readonly ComponentSchemaHash[],
  commands?: readonly CommandSchemaHash[]
): Digest {
  const parts: Uint8Array[] = [canonicalConfigBytes(config)];
  if (components !== undefined && components.length > 0) {
    parts.push(canonicalConfigBytes(components));
  }
  if (commands !== undefined && commands.length > 0) {
    parts.push(canonicalConfigBytes(commands));
  }
  return digestBytes(concatBytes(parts));
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.byteLength;
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.byteLength;
  }
  return combined;
}

/**
 * Stable text of {@link configHash}'s component records. `null` when the
 * list is empty. Restore stores this outside the body digest.
 */
export function componentSchemaKey(
  components: readonly ComponentSchemaHash[]
): string | null {
  if (components.length === 0) return null;
  const plain = components.map((component) => ({
    name: component.name,
    fields: component.fields.map((field) => [field[0], field[1]]),
  }));
  return JSON.stringify(plain);
}

/**
 * `null` when the two keys describe the same schemas. Otherwise the first
 * difference, in the writer's registration order.
 */
export function schemaMismatchMessage(
  expectedKey: string,
  actualKey: string | null
): string | null {
  if (expectedKey === actualKey) return null;
  const expected = parseComponentSchemaKey(expectedKey);
  const actual = actualKey === null ? [] : parseComponentSchemaKey(actualKey);
  const actualByName = new Map(
    actual.map((component) => [component.name, component])
  );
  for (const component of expected) {
    const got = actualByName.get(component.name);
    if (got === undefined) {
      return `component '${component.name}' schema changed: expected ${component.fields}, got (missing)`;
    }
    if (got.fields !== component.fields) {
      return `component '${component.name}' schema changed: expected ${component.fields}, got ${got.fields}`;
    }
  }
  for (const component of actual) {
    if (!expected.some((item) => item.name === component.name)) {
      return `component '${component.name}' schema changed: expected (missing), got ${component.fields}`;
    }
  }
  return `component order changed: expected ${expected.map((component) => component.name).join(',')}, got ${actual.map((component) => component.name).join(',')}`;
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
    return {
      decision: 'reject',
      reason: `unsupported engine snapshot format ${String(header.engineFormat)}; expected ${String(expected.engineFormat)}`,
    };
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

function optionalSchema(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.length === 0) return null;
  return value;
}

interface ParsedComponentSchema {
  readonly name: string;
  readonly fields: string;
}

function parseComponentSchemaKey(key: string): ParsedComponentSchema[] {
  let value: unknown;
  try {
    value = JSON.parse(key);
  } catch (error) {
    throw new Error('component schema record is malformed', { cause: error });
  }
  if (!Array.isArray(value)) {
    throw new Error('component schema record is malformed');
  }
  const parsed: ParsedComponentSchema[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) {
      throw new Error('component schema record is malformed');
    }
    const record = item as Record<string, unknown>;
    const name = record['name'];
    const fields = record['fields'];
    if (typeof name !== 'string' || !Array.isArray(fields)) {
      throw new Error('component schema record is malformed');
    }
    const parts: string[] = [];
    for (const field of fields) {
      if (!Array.isArray(field) || field.length !== 2) {
        throw new Error('component schema record is malformed');
      }
      const fieldName: unknown = field[0];
      const fieldType: unknown = field[1];
      if (typeof fieldName !== 'string' || typeof fieldType !== 'string') {
        throw new Error('component schema record is malformed');
      }
      parts.push(`${fieldName}:${fieldType}`);
    }
    parsed.push({ name, fields: parts.join(',') });
  }
  return parsed;
}
