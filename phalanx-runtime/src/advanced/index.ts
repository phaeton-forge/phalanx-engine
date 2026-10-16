/**
 * Low-level snapshot helpers. Games use `world.save` / `world.restore`.
 * These functions keep the historical section bytes for a hand-written
 * `GameState`.
 *
 * @packageDocumentation
 */

export { StateHelpers } from '../helpers/StateHelpers.js';
export { spawnWithId } from '../helpers/entities.js';
export { rebuildBroadphaseFromTransforms } from '../helpers/physics.js';
export { WorldScope } from '../runner/WorldScope.js';
export type { CommandSchema } from '../game/commands.js';
export type {
  SaveHandler,
  SaveSpec,
  StateMigration,
} from '../state/GameState.js';
