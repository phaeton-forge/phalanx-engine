export type { StateWriter, StateReader } from './StateIO.js';
export type { GameState, GameStateSpec, StateMigration } from './GameState.js';
export { BinaryStateWriter, BinaryStateReader } from './BinaryState.js';
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
