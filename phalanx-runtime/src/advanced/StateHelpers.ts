import {
  readSoAStore,
  readSoAStores,
  writeSoAStore,
  writeSoAStores,
} from '../state/sections/soa.js';
import {
  readEntityIds,
  readPools,
  spawnWithId,
  writeEntityIds,
  writePools,
} from '../state/sections/entities.js';
import { readRandom, writeRandom } from '../state/sections/random.js';

/**
 * Optional engine helpers a game MAY call inside its own
 * `GameState.save`/`restore`. They are not the contract: the engine never
 * calls them by itself. Ability and physics bytes are save sections those
 * packages register; they are not helpers.
 *
 * Restore order for these helpers (normative):
 *  1. `spawnWithId` for dynamic entities that are not in a pool,
 *  2. `readPools` (constructs pooled entities itself, discarding prewarmed
 *     free entities first),
 *  3. `readSoAStores`,
 *  4. `readEntityIds` sets the counter to the saved high-water mark,
 *  5. `readRandom`.
 * A world snapshot then reads the `modules` container (registered sections
 * in ascending key order: `abilities`, `physics.broadphase`, and any game
 * sections) and finally game singletons.
 * `save` writes the same sections in the same order.
 *
 * `f32` / `f64` SoA fields are presentation caches and are not written.
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
} as const;
