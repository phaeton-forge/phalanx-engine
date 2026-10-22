import {
  BinaryStateReader,
  BinaryStateWriter,
  Entity,
  SoAComponent,
  type ComponentRegistration,
  type GameWorld,
  type SaveSection,
  type SoAComponentStore,
  type SoAFieldType,
  type SoAFieldsOf,
  type SoASchema,
  type SoASchemaDefinition,
  type StateReader,
  type StateWriter,
  type TypedArrayLike,
} from '@phalanx-engine/ecs';
import { readPools, writePools } from '../state/sections/entities.js';
import { readEntityIds, writeEntityIds } from '../state/sections/entities.js';
import { readRandom, writeRandom } from '../state/sections/random.js';
import { readSoAStore, writeSoAStores } from '../state/sections/soa.js';
import {
  assertSectionVersion,
  ENGINE_SECTION_VERSION,
} from '../state/sections/version.js';
import { singletonHooks } from './singletons.js';

const ROSTER_SECTION = 'roster';
const MODULES_SECTION = 'modules';
const MODULES_VERSION = 1;

/**
 * Engine sections, then one `modules` container, then game singletons.
 *
 * Roster is omitted when every live entity is pooled. The modules
 * container is written even when nothing is registered. Inside it, each
 * registered section is `section(key, version, body)`, sorted by key.
 */
export function writeWorld(world: GameWorld, writer: StateWriter): void {
  const roster = nonPooledIds(world);
  if (roster.length > 0) {
    writer.section(ROSTER_SECTION, ENGINE_SECTION_VERSION, (section) => {
      section.list(roster, (id, item) => {
        item.u32(id);
      });
    });
  }
  writePools(writer, world);
  writeSoAStores(writer, world, schemasOf(world));
  writeEntityIds(writer, world);
  writeRandom(writer, world.random);
  writeModuleSections(writer, world);
  singletonHooks(world)?.onSave?.(writer);
}

/**
 * Inverse of {@link writeWorld}. Enables components after the bytes land.
 *
 * The startup world is reconciled before any section is applied: checked-out
 * pool entities go back to their pools, and non-pooled entities whose ids
 * are absent from the roster are removed. Missing roster ids are empty
 * shells. Each SoA section then decides which of those shells (and which
 * kept entities) receive that component. Section bytes are unchanged.
 */
export function readWorld(world: GameWorld, reader: StateReader): void {
  const previous = SoAComponent.currentEntityManager();
  SoAComponent.useEntityManager(world.entityManager);
  try {
    const rosterIds =
      leadingSectionKey(reader) === ROSTER_SECTION
        ? reader.section(ROSTER_SECTION, (section, version) => {
            assertSectionVersion('readRoster', version);
            return section.list((item) => item.u32());
          })
        : [];
    const pending = new Map<number, Entity>();
    reconcileStartup(world, rosterIds, pending);
    readPools(reader, world);
    readComponentSections(world, reader, pending);
    for (const entity of pending.values()) {
      world.entityManager.addEntity(entity);
    }
    readEntityIds(reader, world);
    readRandom(reader, world.random);
    // Transient values are display state. The owner section adds them
    // back; until then they are absent and the next add uses defaults.
    world.discardTransientComponents();
    readModuleSections(reader, world);
    singletonHooks(world)?.onRestore?.(reader);
    enableLive(world);
  } finally {
    SoAComponent.useEntityManager(previous);
  }
}

/**
 * Canonical simulation bytes: roster (when any non-pooled entity exists),
 * pools, SoA stores, the entity id counter, RNG, one `modules` container
 * of registered save sections, then optional singleton hooks.
 */
export function saveWorld(world: GameWorld): Uint8Array {
  const writer = new BinaryStateWriter();
  writeWorld(world, writer);
  return writer.finish();
}

/**
 * Restore bytes from {@link saveWorld}. Ids already spawned by world
 * creation are kept and overwritten. `onEnable` runs after the bytes are
 * applied.
 */
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

interface ModuleEntry {
  readonly key: string;
  readonly version: number;
  readonly body: Uint8Array;
}

const PHYSICS_BROADPHASE_SECTION = 'physics.broadphase';

/**
 * A physics facade that was assigned without `PhysicsWorld.attach` has
 * no save section. Runtime does not import physics; the section key is
 * the contract.
 */
function assertPhysicsBound(world: GameWorld): void {
  if (world.context.physics === undefined) return;
  if (
    world.saveSections.some(
      (section) => section.key === PHYSICS_BROADPHASE_SECTION
    )
  ) {
    return;
  }
  throw new Error(
    "save: physics is assigned but save section 'physics.broadphase' is not registered; call PhysicsWorld.attach(world)"
  );
}

/** The `modules` container: registered sections in key order. */
export function writeModuleSections(
  writer: StateWriter,
  world: GameWorld
): void {
  assertPhysicsBound(world);
  const sections = world.saveSections;
  writer.section(MODULES_SECTION, MODULES_VERSION, (section) => {
    section.list(sections, (saveSection, item) => {
      item.section(saveSection.key, saveSection.version, (body) => {
        saveSection.write(body, world);
      });
    });
  });
}

/** Inverse of {@link writeModuleSections}. */
export function readModuleSections(
  reader: StateReader,
  world: GameWorld
): void {
  reader.section(MODULES_SECTION, (section, version) => {
    if (version !== MODULES_VERSION) {
      throw new Error(
        `restore: save section '${MODULES_SECTION}' has version ${String(version)}, expected ${String(MODULES_VERSION)}`
      );
    }
    const registered = world.saveSections;
    const found = readModuleEntries(section);
    assertModuleEntries(registered, found);
    for (let index = 0; index < registered.length; index += 1) {
      const saveSection = registered[index];
      const entry = found[index];
      if (saveSection === undefined || entry === undefined) {
        throw new Error('restore: save sections out of order');
      }
      const body = new BinaryStateReader(entry.body);
      saveSection.read(body, world);
      body.done();
    }
  });
}

/**
 * One entry is the byte layout `StateWriter.section` writes: `str` key,
 * `varint` version, then `bytes` (a `varint` length and the raw body).
 * `readModuleEntries` depends on that layout.
 */
function readModuleEntries(section: StateReader): ModuleEntry[] {
  const count = section.varint();
  const found: ModuleEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    found.push({
      key: section.str(),
      version: section.varint(),
      body: section.bytes(),
    });
  }
  return found;
}

function assertModuleEntries(
  registered: readonly SaveSection[],
  found: readonly ModuleEntry[]
): void {
  const registeredKeys = registered.map((section) => section.key);
  const known = new Set(registeredKeys);
  for (const entry of found) {
    if (!known.has(entry.key)) {
      throw new Error(
        `restore: unknown save section '${entry.key}' (registered: ${registeredKeys.join(', ')})`
      );
    }
  }
  const present = new Set(found.map((entry) => entry.key));
  for (const key of registeredKeys) {
    if (!present.has(key)) {
      throw new Error(
        `restore: save section '${key}' is missing from the snapshot`
      );
    }
  }
  if (
    found.length !== registered.length ||
    found.some((entry, index) => entry.key !== registered[index]?.key)
  ) {
    throw new Error('restore: save sections out of order');
  }
  for (let index = 0; index < registered.length; index += 1) {
    const saveSection = registered[index];
    const entry = found[index];
    if (saveSection === undefined || entry === undefined) {
      throw new Error('restore: save sections out of order');
    }
    if (entry.version !== saveSection.version) {
      throw new Error(
        `restore: save section '${saveSection.key}' has version ${String(entry.version)}, expected ${String(saveSection.version)}`
      );
    }
  }
}

/**
 * Make the live world match the snapshot's membership before sections
 * are read. `readPools` refuses a pool that still has a checked-out
 * entity, and `readSoAStore` refuses a row the section does not list.
 */
function reconcileStartup(
  world: GameWorld,
  rosterIds: readonly number[],
  pending: Map<number, Entity>
): void {
  returnCheckedOut(world);
  const keep = new Set(rosterIds);
  for (const entity of world.entityManager.getAllEntities()) {
    if (entity._inPool || entity._poolTypeKey !== undefined) continue;
    if (keep.has(entity.id)) continue;
    invokeAll(entity, 'onDisable');
    world.entityManager.removeEntity(entity);
    entity.dispose();
  }
  for (const id of rosterIds) {
    if (world.entityManager.getEntity(id) !== undefined) continue;
    const entity = world.createEntityWithId(id);
    // Components are attached once the SoA sections name them. Unregister
    // the empty shell so the later addEntity sees those components and
    // updates component indices. The shell has no rows yet.
    world.entityManager.removeEntity(entity);
    pending.set(id, entity);
  }
}

function returnCheckedOut(world: GameWorld): void {
  const pools = world.pools;
  if (pools === null) return;
  for (const typeKey of pools.typeKeys()) {
    const free = new Set(pools.freeListIds(typeKey));
    for (const id of pools.ownedIds(typeKey).slice()) {
      if (free.has(id)) continue;
      const entity = world.entityManager.getEntity(id);
      if (entity === undefined) continue;
      pools.despawn(entity);
    }
  }
}

function readComponentSections(
  world: GameWorld,
  reader: StateReader,
  pending: ReadonlyMap<number, Entity>
): void {
  for (const schema of schemasOf(world)) {
    ensureRows(world, schema, peekSoAEntityIds(reader, schema), pending);
    const store = world.entityManager.getSoAStoreByType<SoASchemaDefinition>(
      schema.type
    );
    if (store === undefined) {
      throw new Error(
        `readWorld: no store for schema '${schema.type.description ?? ''}'`
      );
    }
    readSoAStore(reader, store);
  }
}

/**
 * Entity ids in the next SoA section, without consuming `reader`.
 * `null` when the next section is not this schema; `readSoAStore` then
 * reports the mismatch.
 */
function peekSoAEntityIds(
  reader: StateReader,
  schema: SoASchema<SoASchemaDefinition>
): readonly number[] | null {
  if (!(reader instanceof BinaryStateReader)) return null;
  const name = schema.type.description;
  if (name === undefined || name.length === 0) return null;
  if (reader.remainingBytes().byteLength === 0) return null;
  const copy = new BinaryStateReader(reader.remainingBytes());
  if (copy.str() !== name) return null;
  if (copy.varint() !== ENGINE_SECTION_VERSION) return null;
  const body = new BinaryStateReader(copy.bytes());
  const count = body.varint();
  const ids: number[] = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(body.u32());
    for (const fieldName of schema.fieldNames) {
      const fieldType = schema.fieldTypes[fieldName];
      if (fieldType === undefined) {
        throw new Error(`readWorld: unknown field '${fieldName}'`);
      }
      skipPersistedField(body, fieldType);
    }
  }
  return ids;
}

function skipPersistedField(
  reader: StateReader,
  fieldType: SoAFieldType
): void {
  switch (fieldType) {
    case 'i32':
      reader.i32();
      return;
    case 'u32':
      reader.u32();
      return;
    case 'u8':
      reader.u8();
      return;
    case 'i64':
      reader.i64();
      return;
    case 'f32':
    case 'f64':
      return;
    default: {
      const unexpected: never = fieldType;
      throw new Error(
        `readWorld: unsupported field type ${String(unexpected)}`
      );
    }
  }
}

function ensureRows(
  world: GameWorld,
  schema: SoASchema<SoASchemaDefinition>,
  ids: readonly number[] | null,
  pending: ReadonlyMap<number, Entity>
): void {
  if (ids === null) return;
  const store = world.entityManager.getSoAStoreByType<SoASchemaDefinition>(
    schema.type
  );
  if (store === undefined) return;
  const listed = new Set(ids);
  const registration = registrationFor(world, schema);
  for (const id of store.entityIds().slice()) {
    if (listed.has(id) || registration === undefined) continue;
    dropRow(world, store, registration, id);
  }
  for (const id of ids) {
    if (store.indexOf(id) !== -1) continue;
    const entity = world.entityManager.getEntity(id) ?? pending.get(id);
    if (entity === undefined) continue;
    if (registration !== undefined) {
      entity.addComponent(registration.create(entity.id));
      // Shells are indexed when they are registered later. A startup
      // entity is already in the manager, so the new component has to
      // be published or queryEntities will not see it.
      if (pending.get(id) === undefined) {
        world.entityManager.onComponentAdded(entity, registration.type);
      }
    } else {
      store.add(id, zeroValues(store));
    }
  }
}

function registrationFor(
  world: GameWorld,
  schema: SoASchema<SoASchemaDefinition>
): ComponentRegistration | undefined {
  for (const component of world.registeredComponents()) {
    if (component.schema.type === schema.type) return component;
  }
  return undefined;
}

function dropRow(
  world: GameWorld,
  store: SoAComponentStore<SoASchemaDefinition>,
  registration: ComponentRegistration,
  id: number
): void {
  const entity = world.entityManager.getEntity(id);
  if (entity !== undefined) {
    const component = entity.getComponent(registration.type);
    if (component !== undefined) {
      invokeHook(component, 'onDisable');
      invokeHook(component, 'onDestroy');
      entity.removeComponent(registration.type);
      world.entityManager.onComponentRemoved(entity, registration.type);
    }
  }
  store.remove(id);
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
    invokeAll(entity, 'onEnable', 'restore');
  }
}

/**
 * Spawn one entity with the named components. The id comes from this
 * world. The spec keys are component names.
 */
export function spawn(
  world: GameWorld,
  spec: Readonly<Record<string, Readonly<Record<string, number | bigint>>>>
): Entity {
  const names = Object.keys(spec);
  if (names.length === 0) {
    throw new Error('spawn: spec is empty');
  }
  const entity = world.createEntity((id) => new Entity(id));
  try {
    for (const name of names) {
      const component = requireComponent(world, name);
      const values = spec[name];
      if (values === undefined) {
        throw new Error(`spawn: missing values for '${name}'`);
      }
      entity.addComponent(component.create(entity.id, values));
    }
  } catch (error) {
    try {
      entity.dispose();
    } finally {
      // create() inserts the SoA row before onCreate. A later failure
      // must drop those rows; the entity was never registered.
      world.entityManager.removeEntity(entity);
    }
    throw error;
  }
  world.entityManager.addEntity(entity);
  invokeAll(entity, 'onEnable');
  return entity;
}

/** Return a pooled entity to its pool, or remove and dispose any other. */
export function despawn(world: GameWorld, entity: Entity): void {
  if (entity._poolTypeKey !== undefined && world.pools !== null) {
    world.pools.despawn(entity);
    return;
  }
  invokeAll(entity, 'onDisable');
  world.entityManager.removeEntity(entity);
  entity.dispose();
}

/**
 * Call `fn` for each live row of `component`, in ascending entity id.
 * The view is reused. Do not retain it.
 */
export function each<S extends SoASchemaDefinition>(
  world: GameWorld,
  component: { readonly schema: SoASchema<S> },
  fn: (view: SoAFieldsOf<S>) => void
): void {
  const store = world.entityManager.getSoAStore(component.schema);
  if (store === undefined) return;
  let entityId = -1;
  // One view for the whole pass. `fn` must not retain it. The dense
  // index is resolved on each access: despawn swap-and-pops other rows.
  const view = new Proxy({} as SoAFieldsOf<S>, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      return readColumn(store.arrays, prop, liveIndex(store, entityId));
    },
    set(_target, prop, value) {
      if (typeof prop !== 'string') return false;
      writeColumn(store.arrays, prop, liveIndex(store, entityId), value);
      return true;
    },
  });
  const ids = store.entityIds().slice();
  for (const id of ids) {
    if (store.indexOf(id) < 0) continue;
    entityId = id;
    fn(view);
  }
}

function liveIndex(
  store: { indexOf(entityId: number): number },
  entityId: number
): number {
  const index = store.indexOf(entityId);
  if (index < 0) {
    throw new Error(`each: entity ${String(entityId)} was removed`);
  }
  return index;
}

function requireComponent(
  world: GameWorld,
  name: string
): ComponentRegistration {
  for (const component of world.registeredComponents()) {
    if (component.name === name) return component;
  }
  throw new Error(`spawn: component '${name}' is not registered`);
}

function invokeAll(
  entity: Entity,
  hook: 'onEnable' | 'onDisable',
  reason?: 'restore'
): void {
  for (const component of [...entity.getComponents().values()]) {
    invokeHook(component, hook, reason);
  }
}

function invokeHook(component: object, hook: string, reason?: 'restore'): void {
  // Lifecycle methods are optional and are not declared on IComponent.
  const record = component as unknown as Record<string, unknown>;
  const fn = record[hook];
  if (typeof fn !== 'function') return;
  if (hook === 'onEnable') {
    (fn as (enableReason?: 'restore') => void).call(component, reason);
    return;
  }
  fn.call(component);
}

function readColumn(
  arrays: object,
  field: string,
  index: number
): number | bigint {
  const column = columnOf(arrays, field);
  const value = column[index];
  if (value === undefined) {
    throw new Error(`each: missing '${field}'`);
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
      throw new Error(`each: '${field}' expects a bigint`);
    }
    column[index] = value;
    return;
  }
  if (typeof value !== 'number') {
    throw new Error(`each: '${field}' expects a number`);
  }
  column[index] = value;
}

function columnOf(arrays: object, field: string): TypedArrayLike {
  const columns = arrays as Record<string, TypedArrayLike>;
  const column = columns[field];
  if (column === undefined) {
    throw new Error(`each: unknown field '${field}'`);
  }
  return column;
}
