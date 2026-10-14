import { notImplemented } from '../notImplemented.js';

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

export function encodeSnapshot(
  _header: Omit<SnapshotHeader, 'magic' | 'digest'>,
  _body: Uint8Array,
  _extras?: SnapshotExtras
): SnapshotBytes {
  return notImplemented('encodeSnapshot', 2);
}

export function decodeSnapshot(_bytes: SnapshotBytes): DecodedSnapshot {
  return notImplemented('decodeSnapshot', 2);
}

/** xxhash64 (seed 0) of `bytes`, pure TypeScript, lowercase hex. */
export function digestBytes(_bytes: Uint8Array): Digest {
  return notImplemented('digestBytes', 2);
}

/**
 * Canonical bytes of a JSON-safe match config: object keys sorted by UTF-16
 * code unit, safe integers, strings, booleans, `null`, arrays and plain
 * objects. Throws on non-integer numbers, `bigint`, `undefined`, functions
 * and class instances.
 */
export function canonicalConfigBytes(_config: unknown): Uint8Array {
  return notImplemented('canonicalConfigBytes', 2);
}

/** `digestBytes(canonicalConfigBytes(config))`. */
export function configHash(_config: unknown): Digest {
  return notImplemented('configHash', 2);
}

/**
 * Version policy: reject on any `engineFormat`, `gameId`, `configHash` or
 * `simVersion` mismatch and on a newer `formatVersion`; `migrate` when the
 * stored format is older and every step `migrate[v]` exists; else accept.
 */
export function checkSnapshotCompatibility(
  _header: SnapshotHeader,
  _expected: ExpectedSnapshotIdentity,
  _migrations?: Readonly<Record<number, unknown>>
): CompatibilityResult {
  return notImplemented('checkSnapshotCompatibility', 2);
}
