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
import { readAbilities, writeAbilities } from './abilities.js';

/**
 * Optional engine helpers a game MAY call inside its own
 * `GameState.save`/`restore`. They are not the contract: the engine never
 * calls them by itself.
 *
 * Restore order inside `GameState.restore` (normative):
 *  1. `spawnWithId` for dynamic entities that are not in a pool,
 *  2. `readPools` (constructs pooled entities itself, discarding prewarmed
 *     free entities first),
 *  3. `readSoAStores`,
 *  4. `readAbilities` (recreates lazy GAS components, then overwrites them),
 *  5. `readEntityIds` sets the counter to the saved high-water mark,
 *  6. `readRandom` and game singletons,
 *  7. `readBroadphase`.
 *     `rebuildPhysics` (from the saved transforms) is not that last step:
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
  writeAbilities,
  readAbilities,
} as const;
