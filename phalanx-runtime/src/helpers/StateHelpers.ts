import type { GameWorld } from '@phalanx-engine/ecs';
import type { StateReader, StateWriter } from '../state/StateIO.js';
import {
  readSoAStore,
  readSoAStores,
  writeSoAStore,
  writeSoAStores,
} from './soa.js';
import {
  readEntityIds,
  readPools,
  spawnWithId,
  writeEntityIds,
  writePools,
} from './entities.js';
import { readRandom, writeRandom } from './random.js';
import { readBroadphase, rebuildPhysics, writeBroadphase } from './physics.js';
import { notImplemented } from '../notImplemented.js';

/**
 * Optional engine helpers a game MAY call inside its own
 * `GameState.save`/`restore`. They are not the contract: the engine never
 * calls them by itself.
 *
 * Restore order inside `GameState.restore` (normative):
 *  1. `spawnWithId` for dynamic entities that are not in a pool, then
 *     `readPools` (it constructs pooled entities itself, discarding
 *     prewarmed free entities first),
 *  2. overwrite row and component values (`readSoAStores`, `readAbilities`),
 *  3. `readEntityIds` sets the counter to the saved high-water mark,
 *  4. `readRandom` and game singletons, then `readBroadphase`.
 *     `rebuildPhysics` (from the saved transforms) is not the last step:
 *     after a collision the live grid still holds the pre-separation
 *     centers.
 * `save` writes the same sections in the same order.
 *
 * `f32` / `f64` SoA fields are presentation caches and are not written.
 * Broadphase centers keep each fixed-point value's own precision.
 * `rebuildPhysics` is only correct for a world that has not resolved a
 * collision since the grid was built.
 */
export const StateHelpers = {
  writeSoAStore,
  readSoAStore,
  writeSoAStores,
  readSoAStores,
  writeEntityIds,
  readEntityIds,
  spawnWithId,
  writePools,
  readPools,
  writeRandom,
  readRandom,
  writeBroadphase,
  readBroadphase,
  rebuildPhysics,
  /** GAS state. Implemented in Task 5. */
  writeAbilities(_w: StateWriter, _world: GameWorld): void {
    notImplemented('StateHelpers.writeAbilities', 5);
  },
  /** GAS state. Implemented in Task 5. */
  readAbilities(_r: StateReader, _world: GameWorld): void {
    notImplemented('StateHelpers.readAbilities', 5);
  },
} as const;
