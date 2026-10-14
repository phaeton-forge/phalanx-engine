import type {
  Entity,
  GameWorld,
  IRandom,
  SoAComponentStore,
  SoASchema,
  SoASchemaDefinition,
} from '@phalanx-engine/ecs';
import { notImplemented } from '../notImplemented.js';
import type { StateReader, StateWriter } from '../state/StateIO.js';

/**
 * Optional engine helpers a game MAY call inside its own
 * `GameState.save`/`restore`. They are not the contract: the engine never
 * calls them by itself.
 *
 * Restore order inside `GameState.restore` (normative):
 *  1. recreate dynamic entities by id (`spawnWithId`, `readPools`); their
 *     constructors create the SoA rows,
 *  2. overwrite row and component values (`readSoAStores`, `readAbilities`),
 *  3. `readEntityIds` sets the counter to the saved high-water mark,
 *  4. `readRandom` and game singletons, finally `rebuildPhysics`.
 * `save` writes the same sections in the same order.
 */
export const StateHelpers = {
  /**
   * `section(<schema symbol description>, 1)`, `varint(rows)`, then per
   * entity id ascending: `u32 id` and every non-float field in schema
   * declaration order. `f32`/`f64` fields are skipped (presentation caches,
   * e.g. `PhysicsBody.lastX`). Throws if the schema has no explicit,
   * unique name (`defineSoASchema(def, 'Name')`).
   */
  writeSoAStore<S extends SoASchemaDefinition>(
    _w: StateWriter,
    _store: SoAComponentStore<S>
  ): void {
    notImplemented('StateHelpers.writeSoAStore', 4);
  },
  /** Overwrites existing rows by id; throws on a missing row. */
  readSoAStore<S extends SoASchemaDefinition>(
    _r: StateReader,
    _store: SoAComponentStore<S>
  ): void {
    notImplemented('StateHelpers.readSoAStore', 4);
  },
  /** `writeSoAStore` for each schema in the given order. */
  writeSoAStores(
    _w: StateWriter,
    _world: GameWorld,
    _schemas: readonly SoASchema[]
  ): void {
    notImplemented('StateHelpers.writeSoAStores', 4);
  },
  readSoAStores(
    _r: StateReader,
    _world: GameWorld,
    _schemas: readonly SoASchema[]
  ): void {
    notImplemented('StateHelpers.readSoAStores', 4);
  },
  /** Entity id counter high-water mark (Task 3 accessor). */
  writeEntityIds(_w: StateWriter, _world: GameWorld): void {
    notImplemented('StateHelpers.writeEntityIds', 4);
  },
  readEntityIds(_r: StateReader, _world: GameWorld): void {
    notImplemented('StateHelpers.readEntityIds', 4);
  },
  /**
   * Construct an entity whose id is exactly `id` (sets the counter to
   * `id - 1` around `create`, which must construct one `Entity` and attach
   * its components in the constructor), then `entityManager.addEntity`.
   * Throws if the id is taken or `create` allocated a different id.
   */
  spawnWithId<E extends Entity>(
    _world: GameWorld,
    _id: number,
    _create: () => E
  ): E {
    return notImplemented('StateHelpers.spawnWithId', 4);
  },
  /**
   * Per pool type key ascending: every entity id the pool owns and the
   * free-list order (LIFO, so it decides which id the next spawn reuses).
   */
  writePools(_w: StateWriter, _world: GameWorld): void {
    notImplemented('StateHelpers.writePools', 4);
  },
  readPools(_r: StateReader, _world: GameWorld): void {
    notImplemented('StateHelpers.readPools', 4);
  },
  /** `DeterministicRandom` state; throws if `rng` cannot export state. */
  writeRandom(_w: StateWriter, _rng: IRandom): void {
    notImplemented('StateHelpers.writeRandom', 4);
  },
  readRandom(_r: StateReader, _rng: IRandom): void {
    notImplemented('StateHelpers.readRandom', 4);
  },
  /** `PhysicsWorld.rebuildBroadphase()` on `world.context.physics`, if any. */
  rebuildPhysics(_world: GameWorld): void {
    notImplemented('StateHelpers.rebuildPhysics', 4);
  },
  /**
   * GAS state: per entity id ascending — component layout, attributes
   * (base, current, dirty), effect queue and `pendingAdd` in array order,
   * tags / ad-hoc tags / grant counts and granted abilities in insertion
   * order — plus the per-world runtime (instance id counter, pending
   * activation requests, current tick).
   */
  writeAbilities(_w: StateWriter, _world: GameWorld): void {
    notImplemented('StateHelpers.writeAbilities', 5);
  },
  readAbilities(_r: StateReader, _world: GameWorld): void {
    notImplemented('StateHelpers.readAbilities', 5);
  },
} as const;
