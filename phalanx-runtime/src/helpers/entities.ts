import {
  isPoolableComponent,
  type Entity,
  type GameWorld,
} from '@phalanx-engine/ecs';
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
 * Bind pools with `PoolManager.restore`.
 *
 * Does not construct entities. `PoolManager` does not expose its factory,
 * and `restore` only adopts instances the caller already holds. Recreate
 * every owned id with {@link spawnWithId} before this call, on a world
 * that registered the same type keys and has not spawned or prewarmed
 * those pools.
 *
 * Free-list entities are then taken out of the entity manager (the same
 * membership a `despawn` leaves) without pushing them onto the free list
 * a second time. Checked-out entities stay registered.
 *
 * @throws If the type-key list differs, a pool is not empty, or an owned
 * id is not in the entity manager.
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
    if (pools.ownedIds(record.typeKey).length !== 0) {
      throw new Error(
        `readPools: pool '${record.typeKey}' is not empty. Restore into a world that has not spawned or prewarmed this pool.`
      );
    }
    const entities: Entity[] = [];
    for (const id of record.ownedIds) {
      const entity = world.entityManager.getEntity(id);
      if (entity === undefined) {
        throw new Error(
          `readPools: missing entity ${String(id)} for pool '${record.typeKey}'`
        );
      }
      entities.push(entity);
    }
    pools.restore(record.typeKey, entities, record.freeListIds);
    const free = new Set(record.freeListIds);
    for (const entity of entities) {
      if (!free.has(entity.id)) continue;
      parkFreeEntity(world, entity);
    }
  }
}

/**
 * Match despawn membership for a free-list entity that was recreated with
 * `spawnWithId`: drop it from the manager and run the dormant hooks.
 * `PoolManager.restore` already recorded the free-list order, so this does
 * not call `release`.
 */
function parkFreeEntity(world: GameWorld, entity: Entity): void {
  if (world.entityManager.getEntity(entity.id) !== undefined) {
    world.entityManager.removeEntity(entity);
  }
  const hooks = entity as Entity & { onDespawn?: () => void };
  if (typeof hooks.onDespawn === 'function') {
    hooks.onDespawn();
  }
  for (const component of entity.getComponents().values()) {
    if (isPoolableComponent(component)) {
      component.onDespawn();
    }
  }
}
