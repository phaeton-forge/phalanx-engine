import {
  Entity,
  SoAComponent,
  type ComponentRegistration,
  type GameWorld,
  type SoAComponentStore,
  type SoAFieldsOf,
  type SoASchema,
  type SoASchemaDefinition,
  type TypedArrayLike,
} from '@phalanx-engine/ecs';
import { BinaryStateReader, BinaryStateWriter } from '../state/BinaryState.js';
import type { StateReader, StateWriter } from '../state/StateIO.js';
import { readAbilities, writeAbilities } from '../helpers/abilities.js';
import { readPools, spawnWithId, writePools } from '../helpers/entities.js';
import { readEntityIds, writeEntityIds } from '../helpers/entities.js';
import {
  hasBroadphase,
  readBroadphase,
  writeBroadphase,
} from '../helpers/physics.js';
import { readRandom, writeRandom } from '../helpers/random.js';
import { readSoAStores, writeSoAStores } from '../helpers/soa.js';
import {
  assertSectionVersion,
  HELPER_SECTION_VERSION,
} from '../helpers/sectionVersion.js';
import { singletonHooks } from './singletons.js';

const ROSTER_SECTION = 'roster';

/**
 * Engine sections in the historical StateHelpers order.
 *
 * Roster is omitted when every live entity is pooled, so a physics
 * fixture that never wrote a roster stays byte-identical. Abilities and
 * broadphase are omitted when those systems are not attached.
 */
export function writeWorld(world: GameWorld, writer: StateWriter): void {
  const roster = nonPooledIds(world);
  if (roster.length > 0) {
    writer.section(ROSTER_SECTION, HELPER_SECTION_VERSION, (section) => {
      section.list(roster, (id, item) => {
        item.u32(id);
      });
    });
  }
  writePools(writer, world);
  writeSoAStores(writer, world, schemasOf(world));
  if (hasAbilities(world)) writeAbilities(writer, world);
  writeEntityIds(writer, world);
  writeRandom(writer, world.random);
  if (hasBroadphase(world)) writeBroadphase(writer, world);
  singletonHooks(world)?.onSave?.(writer);
}

/** Inverse of {@link writeWorld}. Enables components after the bytes land. */
export function readWorld(world: GameWorld, reader: StateReader): void {
  const previous = SoAComponent.currentEntityManager();
  SoAComponent.useEntityManager(world.entityManager);
  try {
    if (leadingSectionKey(reader) === ROSTER_SECTION) {
      const ids = reader.section(ROSTER_SECTION, (section, version) => {
        assertSectionVersion('readRoster', version);
        return section.list((item) => item.u32());
      });
      spawnMissing(world, ids);
    }
    readPools(reader, world);
    readSoAStores(reader, world, schemasOf(world));
    if (hasAbilities(world)) readAbilities(reader, world);
    readEntityIds(reader, world);
    readRandom(reader, world.random);
    if (hasBroadphase(world)) readBroadphase(reader, world);
    singletonHooks(world)?.onRestore?.(reader);
    enableLive(world);
  } finally {
    SoAComponent.useEntityManager(previous);
  }
}

export function saveWorld(world: GameWorld): Uint8Array {
  const writer = new BinaryStateWriter();
  writeWorld(world, writer);
  return writer.finish();
}

export function restoreWorld(world: GameWorld, bytes: Uint8Array): void {
  const reader = new BinaryStateReader(bytes);
  readWorld(world, reader);
  reader.done();
}

function leadingSectionKey(reader: StateReader): string | null {
  if (!(reader instanceof BinaryStateReader)) return null;
  const bytes = reader.remainingBytes();
  if (bytes.byteLength === 0) return null;
  return new BinaryStateReader(bytes).str();
}

function nonPooledIds(world: GameWorld): number[] {
  const pooled = new Set<number>();
  const pools = world.pools;
  if (pools !== null) {
    for (const typeKey of pools.typeKeys()) {
      for (const id of pools.ownedIds(typeKey)) pooled.add(id);
    }
  }
  const ids: number[] = [];
  for (const entity of world.entityManager.getAllEntities()) {
    if (!pooled.has(entity.id)) ids.push(entity.id);
  }
  ids.sort((left, right) => left - right);
  return ids;
}

function schemasOf(world: GameWorld): SoASchema<SoASchemaDefinition>[] {
  const schemas: SoASchema<SoASchemaDefinition>[] = [];
  for (const store of world.entityManager.getAllSoAStores().values()) {
    // getAllSoAStores types every store as SoAComponentStore<any>.
    // The schema object is the one the store was created with.
    schemas.push(
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      store.schema as unknown as SoASchema<SoASchemaDefinition>
    );
  }
  return schemas;
}

function hasAbilities(world: GameWorld): boolean {
  const abilities: unknown = world.context.abilities;
  if (typeof abilities !== 'object' || abilities === null) return false;
  const record = abilities as Record<string, unknown>;
  return (
    typeof record['exportRuntimeState'] === 'function' &&
    typeof record['importRuntimeState'] === 'function'
  );
}

function spawnMissing(world: GameWorld, ids: readonly number[]): void {
  for (const id of ids) {
    if (world.entityManager.getEntity(id) !== undefined) continue;
    spawnWithId(world, id, () => createRestoredEntity(world));
  }
}

function createRestoredEntity(world: GameWorld): Entity {
  const entity = new Entity();
  const registered = world.registeredComponents();
  if (registered.length > 0) {
    for (const component of registered) {
      entity.addComponent(component.create(entity.id));
    }
    return entity;
  }
  for (const raw of world.entityManager.getAllSoAStores().values()) {
    // getAllSoAStores types every store as SoAComponentStore<any>.
    const store = raw as unknown as SoAComponentStore<SoASchemaDefinition>;
    store.add(entity.id, zeroValues(store));
  }
  return entity;
}

function zeroValues(
  store: SoAComponentStore<SoASchemaDefinition>
): SoAFieldsOf<SoASchemaDefinition> {
  const values: Record<string, number | bigint> = {};
  for (const fieldName of store.schema.fieldNames) {
    const fieldType = store.schema.fieldTypes[fieldName];
    values[fieldName] = fieldType === 'i64' ? 0n : 0;
  }
  return values;
}

function enableLive(world: GameWorld): void {
  const ids = world.entityManager.getAllEntities().map((entity) => entity.id);
  for (const id of ids) {
    const entity = world.entityManager.getEntity(id);
    if (entity === undefined || entity._inPool) continue;
    invokeAll(entity, 'onEnable');
  }
}

export function spawnOn(
  world: GameWorld,
  spec: Readonly<Record<string, Readonly<Record<string, number | bigint>>>>
): Entity {
  const names = Object.keys(spec);
  if (names.length === 0) {
    throw new Error('world.spawn: spec is empty');
  }
  const entity = new Entity();
  for (const name of names) {
    const component = requireComponent(world, name);
    const values = spec[name];
    if (values === undefined) {
      throw new Error(`world.spawn: missing values for '${name}'`);
    }
    entity.addComponent(component.create(entity.id, values));
  }
  world.entityManager.addEntity(entity);
  invokeAll(entity, 'onEnable');
  return entity;
}

export function despawnOn(world: GameWorld, entity: Entity): void {
  if (entity._poolTypeKey !== undefined && world.pools !== null) {
    world.pools.despawn(entity);
    return;
  }
  invokeAll(entity, 'onDisable');
  world.entityManager.removeEntity(entity);
  entity.dispose();
}

export function eachOn<S extends SoASchemaDefinition>(
  world: GameWorld,
  component: { readonly schema: SoASchema<S> },
  fn: (view: SoAFieldsOf<S>) => void
): void {
  const store = world.entityManager.getSoAStore(component.schema);
  if (store === undefined) return;
  let index = -1;
  // One view for the whole pass. `fn` must not retain it.
  const view = new Proxy({} as SoAFieldsOf<S>, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      return readColumn(store.arrays, prop, index);
    },
    set(_target, prop, value) {
      if (typeof prop !== 'string') return false;
      writeColumn(store.arrays, prop, index, value);
      return true;
    },
  });
  const ids = store.entityIds().slice();
  for (const id of ids) {
    index = store.indexOf(id);
    if (index < 0) continue;
    fn(view);
  }
}

function requireComponent(
  world: GameWorld,
  name: string
): ComponentRegistration {
  for (const component of world.registeredComponents()) {
    if (component.name === name) return component;
  }
  throw new Error(`world.spawn: component '${name}' is not registered`);
}

function invokeAll(entity: Entity, hook: 'onEnable' | 'onDisable'): void {
  for (const component of [...entity.getComponents().values()]) {
    // Lifecycle methods are optional and are not declared on IComponent.
    const record = component as unknown as Record<string, unknown>;
    const fn = record[hook];
    if (typeof fn === 'function') fn.call(component);
  }
}

function readColumn(
  arrays: object,
  field: string,
  index: number
): number | bigint {
  const column = columnOf(arrays, field);
  const value = column[index];
  if (value === undefined) {
    throw new Error(`world.each: missing '${field}'`);
  }
  return value;
}

function writeColumn(
  arrays: object,
  field: string,
  index: number,
  value: unknown
): void {
  const column = columnOf(arrays, field);
  if (column instanceof BigInt64Array) {
    if (typeof value !== 'bigint') {
      throw new Error(`world.each: '${field}' expects a bigint`);
    }
    column[index] = value;
    return;
  }
  if (typeof value !== 'number') {
    throw new Error(`world.each: '${field}' expects a number`);
  }
  column[index] = value;
}

function columnOf(arrays: object, field: string): TypedArrayLike {
  const columns = arrays as Record<string, TypedArrayLike>;
  const column = columns[field];
  if (column === undefined) {
    throw new Error(`world.each: unknown field '${field}'`);
  }
  return column;
}
