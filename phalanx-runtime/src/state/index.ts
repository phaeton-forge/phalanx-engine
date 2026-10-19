export type { StateWriter, StateReader } from '@phalanx-engine/ecs';
export { BinaryStateWriter, BinaryStateReader } from '@phalanx-engine/ecs';
export {
  encodeSnapshot,
  decodeSnapshot,
  digestBytes,
  canonicalConfigBytes,
  configHash,
  checkSnapshotCompatibility,
} from './snapshot.js';
export type {
  SnapshotBytes,
  Digest,
  SnapshotHeader,
  DecodedSnapshot,
  SnapshotExtras,
  ComponentSchemaHash,
  VersionDecision,
  CompatibilityResult,
  ExpectedSnapshotIdentity,
} from './snapshot.js';
export { SnapshotRejectedError, SnapshotRoundTripError } from './errors.js';
export { initDigest, onDigestFallback } from './digest.js';
export type { DigestFallbackHandler } from './digest.js';
