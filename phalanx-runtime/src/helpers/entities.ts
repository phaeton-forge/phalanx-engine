import type { Entity, GameWorld } from '@phalanx-engine/ecs';
import type { StateReader, StateWriter } from '../state/StateIO.js';
import {
  assertSectionVersion,
  HELPER_SECTION_VERSION,
} from './sectionVersion.js';

/** Entity id counter high-water mark. The next allocation returns this + 1. */
export function writeEntityIds(w: StateWriter, world: GameWorld): void {
  w.section('entityIds', HELPER_SECTION_VERSION, (section) => {
    section.varint(world.getEntityIdCounter());
  });
}

/** Restores the counter saved by {@link writeEntityIds}. */
export function readEntityIds(r: StateReader, world: GameWorld): void {
  r.section('entityIds', (section, version) => {
    assertSectionVersion('readEntityIds', version);
    world.setEntityIdCounter(section.varint());
  });
}

/**
 * Construct an entity whose id is exactly `id`.
 *
 * Sets the counter to `id - 1` around `create`. `create` must construct
 * exactly one `Entity` (and attach its components in that constructor) and
 * must not register it. This function then calls `entityManager.addEntity`.
 *
 * The counter is left at `max(previous, id)` so a hole below the high-water
 * mark does not rewind later allocations. `readEntityIds` still runs later
 * and installs the saved high-water mark.
 *
 * @throws If `id` is not an integer >= 1, the id is already registered, or
 * `create` allocated a different id or more than one entity.
 */
export function spawnWithId<E extends Entity>(
  world: GameWorld,
  id: number,
  create: () => E
): E {
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error(
      `spawnWithId: id must be an integer >= 1, got ${String(id)}`
    );
  }
  if (world.entityManager.getEntity(id) !== undefined) {
    throw new Error(`spawnWithId: entity ${String(id)} already exists`);
  }

  const saved = world.getEntityIdCounter();
  world.setEntityIdCounter(id - 1);
  let entity: E;
  try {
    entity = create();
  } catch (error) {
    world.setEntityIdCounter(saved);
    throw error;
  }

  const allocated = world.getEntityIdCounter();
  if (entity.id !== id || allocated !== id) {
    world.setEntityIdCounter(saved);
    throw new Error(
      `spawnWithId: create() must construct exactly one entity with id ${String(id)}`
    );
  }
  if (world.entityManager.getEntity(id) !== undefined) {
    world.setEntityIdCounter(saved);
    throw new Error(
      `spawnWithId: create() already registered entity ${String(id)}`
    );
  }

  world.setEntityIdCounter(Math.max(saved, id));
  world.entityManager.addEntity(entity);
  return entity;
}

interface PoolRecord {
  readonly typeKey: string;
  readonly ownedIds: readonly number[];
  readonly freeListIds: readonly number[];
}

/**
 * Pool membership, not component values.
 *
 * Type keys stay in registration order (`PoolManager.typeKeys`); that order
 * is part of the snapshot and is not sorted. Each pool then writes owned
 * ids in creation order and free-list ids from oldest release to newest.
 * The next `spawn` pops the last free id.
 *
 * An unconfigured world (`world.pools === null`) writes an empty list.
 */
export function writePools(w: StateWriter, world: GameWorld): void {
  const pools = world.pools;
  w.section('pools', HELPER_SECTION_VERSION, (section) => {
    const typeKeys = pools === null ? [] : pools.typeKeys();
    section.list(typeKeys, (typeKey, item) => {
      if (pools === null) {
        throw new Error('writePools: world has no pools');
      }
      item.str(typeKey);
      item.list(pools.ownedIds(typeKey), (id, idWriter) => {
        idWriter.u32(id);
      });
      item.list(pools.freeListIds(typeKey), (id, idWriter) => {
        idWriter.u32(id);
      });
    });
  });
}

function readPoolRecords(r: StateReader): PoolRecord[] {
  return r.section('pools', (section, version) => {
    assertSectionVersion('readPools', version);
    return section.list((item) => ({
      typeKey: item.str(),
      ownedIds: item.list((idReader) => idReader.u32()),
      freeListIds: item.list((idReader) => idReader.u32()),
    }));
  });
}

/**
 * Rebuild pool membership from the snapshot.
 *
 * `start()` prewarms by default, so a fresh world already holds free
 * entities and has consumed ids. Those dormant entities are discarded
 * (`dispose`, never `addEntity`) before the saved ids are allocated.
 * Each owned id is then constructed with `PoolManager.createForRestore`
 * (the raw factory: no `onSpawn` / `onDespawn`). Checked-out entities are
 * registered. Free-list entities are not. `runDormantHooks` runs for them
 * (`onDespawn`, component hooks, and return-to-pool hooks) so they match
 * a despawned pool entry.
 *
 * Those hooks already ran when the original entity was prewarmed or
 * despawned. They run again on the restored instance. Keep them
 * idempotent. The ability return-to-pool hook clears the effect queue and
 * pending adds, copies the factory attribute, ability-set, and tag shell
 * back, and drops GAS components that were not part of that shell.
 *
 * `readEntityIds` still runs later and installs the saved high-water mark.
 * Prewarm and these allocations both move the counter; the saved mark wins.
 *
 * @throws If the type-key list differs, a pool has a checked-out entity,
 * or the factory does not allocate the saved id.
 */
export function readPools(r: StateReader, world: GameWorld): void {
  const records = readPoolRecords(r);
  const pools = world.pools;
  if (pools === null) {
    if (records.length === 0) return;
    throw new Error('readPools: world has no pools');
  }

  const liveKeys = pools.typeKeys();
  if (
    liveKeys.length !== records.length ||
    records.some((record, index) => liveKeys[index] !== record.typeKey)
  ) {
    throw new Error('readPools: pool type keys do not match the snapshot');
  }

  for (const record of records) {
    pools.discardPrewarmed(record.typeKey);
    const entities: Entity[] = [];
    for (const id of record.ownedIds) {
      entities.push(createPooledEntity(world, pools, record.typeKey, id));
    }
    pools.restore(record.typeKey, entities, record.freeListIds);
    const free = new Set(record.freeListIds);
    for (const entity of entities) {
      if (free.has(entity.id)) {
        parkFreeEntity(world, entity);
      } else if (world.entityManager.getEntity(entity.id) === undefined) {
        world.entityManager.addEntity(entity);
      }
    }
  }
}

/**
 * Allocate `id` from the raw pool factory. Does not register the entity.
 * The counter is left at `max(previous, id)` until `readEntityIds`.
 */
function createPooledEntity(
  world: GameWorld,
  pools: NonNullable<GameWorld['pools']>,
  typeKey: string,
  id: number
): Entity {
  if (world.entityManager.getEntity(id) !== undefined) {
    throw new Error(
      `readPools: entity ${String(id)} already exists for pool '${typeKey}'`
    );
  }
  const saved = world.getEntityIdCounter();
  world.setEntityIdCounter(id - 1);
  let entity: Entity;
  try {
    entity = pools.createForRestore(typeKey);
  } catch (error) {
    world.setEntityIdCounter(saved);
    throw error;
  }
  if (entity.id !== id || world.getEntityIdCounter() !== id) {
    world.setEntityIdCounter(saved);
    throw new Error(
      `readPools: factory for '${typeKey}' must construct exactly one entity with id ${String(id)}`
    );
  }
  world.setEntityIdCounter(Math.max(saved, id));
  return entity;
}

/**
 * Match despawn membership for a restored free-list entity: drop its SoA
 * row and run dormant hooks. `PoolManager.restore` already recorded the
 * free-list order, so this does not call `release`. Hooks run here even
 * though the saved entity was already dormant.
 */
function parkFreeEntity(world: GameWorld, entity: Entity): void {
  if (world.entityManager.getEntity(entity.id) !== undefined) {
    world.entityManager.removeEntity(entity);
  }
  const pools = world.pools;
  if (pools === null) {
    throw new Error('readPools: world has no pools');
  }
  pools.runDormantHooks(entity);
}
