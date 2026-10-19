import type {
  GameWorld,
  SoAComponentStore,
  SoAFieldType,
  SoASchema,
  SoASchemaDefinition,
  TypedArrayLike,
} from '@phalanx-engine/ecs';
import {
  BinaryStateWriter,
  type StateReader,
  type StateWriter,
} from '@phalanx-engine/ecs';
import { assertSectionVersion, ENGINE_SECTION_VERSION } from './version.js';

/**
 * Structural view of a `SoASchema`.
 *
 * `SoASchema<S>` is invariant in `S`, so a heterogeneous list is not a
 * `readonly SoASchema[]`. These fields look a store up by symbol and, when
 * a saved section has no rows, register an empty one.
 */
interface SoASchemaRef {
  readonly type: symbol;
  readonly definition: SoASchemaDefinition;
  readonly fieldNames: readonly string[];
  readonly fieldTypes: SoASchemaDefinition;
}

/**
 * Callers pass `defineSoASchema()` values. The public parameter stays
 * structural because `SoASchema<S>` is invariant in `S`.
 */
function schemaForCreate(schema: SoASchemaRef): SoASchema<SoASchemaDefinition> {
  return schema as SoASchema<SoASchemaDefinition>;
}

/**
 * `defineSoASchema` without a name uses this symbol description.
 * It is not an explicit schema name.
 */
const IMPLICIT_SCHEMA_NAME = 'SoASchema';

/**
 * Symbol description passed to `defineSoASchema(definition, name)`.
 * Throws when the name was omitted (description `SoASchema`) or is empty.
 */
function requireSchemaName(
  schema: { readonly type: symbol },
  helper: string
): string {
  const name = schema.type.description;
  if (
    name === undefined ||
    name.length === 0 ||
    name === IMPLICIT_SCHEMA_NAME
  ) {
    throw new Error(
      `${helper}: schema has no explicit name; call defineSoASchema(definition, 'Name')`
    );
  }
  return name;
}

function assertUniqueSchemaNames(names: readonly string[]): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      throw new Error(`writeSoAStores: duplicate schema name '${name}'`);
    }
    seen.add(name);
  }
}

function isPersistedField(
  fieldType: SoAFieldType
): fieldType is 'i64' | 'i32' | 'u32' | 'u8' {
  return fieldType !== 'f32' && fieldType !== 'f64';
}

/**
 * `store.arrays` is a mapped type. Field names are runtime strings, so the
 * lookup goes through a string index. The store still holds one typed array
 * per schema field.
 */
function fieldArray<S extends SoASchemaDefinition>(
  store: SoAComponentStore<S>,
  fieldName: string
): TypedArrayLike {
  // Mapped SoA array objects are keyed by field name at runtime.
  const arrays = store.arrays as Record<string, TypedArrayLike>;
  const array = arrays[fieldName];
  if (array === undefined) {
    throw new Error(`writeSoAStore: missing array for field ${fieldName}`);
  }
  return array;
}

function fieldTypeOf(fieldTypes: object, fieldName: string): SoAFieldType {
  // `S` has no string index signature; the table is still a field-name map.
  const types = fieldTypes as {
    readonly [field: string]: SoAFieldType | undefined;
  };
  const fieldType = types[fieldName];
  if (fieldType === undefined) {
    throw new Error(`writeSoAStore: unknown field ${fieldName}`);
  }
  return fieldType;
}

function valueAt(array: TypedArrayLike, index: number): bigint | number {
  const value = array[index];
  if (value === undefined) {
    throw new Error('writeSoAStore: field index out of range');
  }
  return value;
}

function writeField(
  w: StateWriter,
  fieldType: SoAFieldType,
  value: bigint | number
): void {
  switch (fieldType) {
    case 'i64':
      if (typeof value !== 'bigint') {
        throw new Error('writeSoAStore: expected a bigint for an i64 field');
      }
      w.i64(value);
      return;
    case 'i32':
      if (typeof value !== 'number') {
        throw new Error('writeSoAStore: expected a number for an i32 field');
      }
      w.i32(value);
      return;
    case 'u32':
      if (typeof value !== 'number') {
        throw new Error('writeSoAStore: expected a number for a u32 field');
      }
      w.u32(value);
      return;
    case 'u8':
      if (typeof value !== 'number') {
        throw new Error('writeSoAStore: expected a number for a u8 field');
      }
      w.u8(value);
      return;
    case 'f32':
    case 'f64':
      return;
    default: {
      const unexpected: never = fieldType;
      throw new Error(
        `writeSoAStore: unsupported field type ${String(unexpected)}`
      );
    }
  }
}

function assignField(
  array: TypedArrayLike,
  index: number,
  value: bigint | number
): void {
  if (array instanceof BigInt64Array) {
    if (typeof value !== 'bigint') {
      throw new Error('readSoAStore: expected a bigint for an i64 field');
    }
    array[index] = value;
    return;
  }
  if (typeof value !== 'number') {
    throw new Error('readSoAStore: expected a number for an integer field');
  }
  array[index] = value;
}

function readField(r: StateReader, fieldType: SoAFieldType): bigint | number {
  switch (fieldType) {
    case 'i64':
      return r.i64();
    case 'i32':
      return r.i32();
    case 'u32':
      return r.u32();
    case 'u8':
      return r.u8();
    case 'f32':
    case 'f64':
      throw new Error('readSoAStore: float fields are not stored');
    default: {
      const unexpected: never = fieldType;
      throw new Error(
        `readSoAStore: unsupported field type ${String(unexpected)}`
      );
    }
  }
}

type ColumnWrite = (
  w: BinaryStateWriter,
  array: TypedArrayLike,
  index: number
) => void;

interface StorePlan {
  readonly names: readonly string[];
  readonly writes: readonly ColumnWrite[];
}

const STORE_PLANS = new WeakMap<object, StorePlan>();

const COLUMN_WRITE: Record<'i64' | 'i32' | 'u32' | 'u8', ColumnWrite> = {
  i64: (w, array, index) => {
    const value = array[index];
    if (typeof value !== 'bigint') {
      throw new Error('writeSoAStore: expected a bigint for an i64 field');
    }
    w.i64Unchecked(value);
  },
  i32: (w, array, index) => {
    const value = array[index];
    if (typeof value !== 'number') {
      throw new Error('writeSoAStore: expected a number for an i32 field');
    }
    w.i32Unchecked(value);
  },
  u32: (w, array, index) => {
    const value = array[index];
    if (typeof value !== 'number') {
      throw new Error('writeSoAStore: expected a number for a u32 field');
    }
    w.u32Unchecked(value);
  },
  u8: (w, array, index) => {
    const value = array[index];
    if (typeof value !== 'number') {
      throw new Error('writeSoAStore: expected a number for a u8 field');
    }
    w.u8Unchecked(value);
  },
};

function planFor(schema: SoASchemaRef): StorePlan {
  const cached = STORE_PLANS.get(schema);
  if (cached !== undefined) return cached;
  const names: string[] = [];
  const writes: ColumnWrite[] = [];
  for (const fieldName of schema.fieldNames) {
    const fieldType = fieldTypeOf(schema.fieldTypes, fieldName);
    if (!isPersistedField(fieldType)) continue;
    names.push(fieldName);
    writes.push(COLUMN_WRITE[fieldType]);
  }
  const plan: StorePlan = { names, writes };
  STORE_PLANS.set(schema, plan);
  return plan;
}

function writeRow<S extends SoASchemaDefinition>(
  w: StateWriter,
  store: SoAComponentStore<S>,
  entityId: number
): void {
  const index = store.indexOf(entityId);
  if (index === -1) {
    throw new Error(`writeSoAStore: missing entity ${String(entityId)}`);
  }
  w.u32(entityId);
  for (const fieldName of store.schema.fieldNames) {
    const fieldType = fieldTypeOf(store.schema.fieldTypes, fieldName);
    if (!isPersistedField(fieldType)) continue;
    writeField(w, fieldType, valueAt(fieldArray(store, fieldName), index));
  }
}

function writeRowFast<S extends SoASchemaDefinition>(
  w: BinaryStateWriter,
  store: SoAComponentStore<S>,
  entityId: number,
  columns: readonly TypedArrayLike[],
  writes: readonly ColumnWrite[]
): void {
  const index = store.indexOf(entityId);
  if (index === -1) {
    throw new Error(`writeSoAStore: missing entity ${String(entityId)}`);
  }
  w.u32Unchecked(entityId);
  for (let field = 0; field < writes.length; field += 1) {
    const write = writes[field];
    const column = columns[field];
    if (write === undefined || column === undefined) {
      throw new Error('writeSoAStore: missing field plan');
    }
    write(w, column, index);
  }
}

function readRow<S extends SoASchemaDefinition>(
  r: StateReader,
  store: SoAComponentStore<S>,
  schemaName: string,
  seen: Set<number>
): void {
  const entityId = r.u32();
  if (seen.has(entityId)) {
    throw new Error(
      `readSoAStore: duplicate entity ${String(entityId)} in ${schemaName}`
    );
  }
  seen.add(entityId);
  const index = store.indexOf(entityId);
  if (index === -1) {
    throw new Error(
      `readSoAStore: missing entity ${String(entityId)} in ${schemaName}`
    );
  }
  for (const fieldName of store.schema.fieldNames) {
    const fieldType = fieldTypeOf(store.schema.fieldTypes, fieldName);
    if (!isPersistedField(fieldType)) continue;
    assignField(fieldArray(store, fieldName), index, readField(r, fieldType));
  }
}

/**
 * `section(<schema name>, 1)`, `varint(rows)`, then per entity id ascending:
 * `u32 id` and every non-float field in schema declaration order.
 *
 * `f32` / `f64` fields are skipped. They are presentation caches
 * (`PhysicsBody.lastX` / `lastZ`), not simulation state.
 *
 * Throws if the schema has no explicit, unique name. Uniqueness across a
 * list is checked by {@link writeSoAStores}.
 */
export function writeSoAStore<S extends SoASchemaDefinition>(
  w: StateWriter,
  store: SoAComponentStore<S>
): void {
  const name = requireSchemaName(store.schema, 'writeSoAStore');
  w.section(name, ENGINE_SECTION_VERSION, (section) => {
    const ids = store.entityIds();
    if (section instanceof BinaryStateWriter) {
      const plan = planFor(store.schema);
      const columns = plan.names.map((fieldName) =>
        fieldArray(store, fieldName)
      );
      section.varint(ids.length);
      for (let row = 0; row < ids.length; row += 1) {
        const entityId = ids[row];
        if (entityId === undefined) {
          throw new Error('writeSoAStore: missing entity id');
        }
        writeRowFast(section, store, entityId, columns, plan.writes);
      }
      return;
    }
    section.list(ids, (entityId, row) => {
      writeRow(row, store, entityId);
    });
  });
}

/**
 * Overwrites existing rows by entity id.
 *
 * Entities must already exist: their constructors create the SoA rows.
 * Call this after `spawnWithId` / pool restore and before `readEntityIds`.
 * A zero-row section does not need those rows. Pass the schema to
 * {@link readSoAStores}, which registers an empty store when this world
 * has not created one yet.
 *
 * @throws If a saved id has no row, the store has a row the section
 * omitted, or the section version is not 1.
 */
export function readSoAStore<S extends SoASchemaDefinition>(
  r: StateReader,
  store: SoAComponentStore<S>
): void {
  const name = requireSchemaName(store.schema, 'readSoAStore');
  const seen = new Set<number>();
  r.section(name, (section, version) => {
    assertSectionVersion('readSoAStore', version);
    section.list((row) => {
      readRow(row, store, name, seen);
      return 0;
    });
    if (seen.size !== store.entityIds().length) {
      for (const id of store.entityIds()) {
        if (!seen.has(id)) {
          throw new Error(
            `readSoAStore: extra entity ${String(id)} in ${name}`
          );
        }
      }
    }
  });
}

function prepareStores(
  world: GameWorld,
  schemas: readonly SoASchemaRef[],
  helper: string,
  createMissing: boolean
): SoAComponentStore<SoASchemaDefinition>[] {
  const named = schemas.map((schema) => ({
    name: requireSchemaName(schema, helper),
    schema,
    store: world.entityManager.getSoAStoreByType<SoASchemaDefinition>(
      schema.type
    ),
  }));
  assertUniqueSchemaNames(named.map((item) => item.name));
  const stores: SoAComponentStore<SoASchemaDefinition>[] = [];
  for (const item of named) {
    if (item.store !== undefined) {
      stores.push(item.store);
      continue;
    }
    if (!createMissing) {
      throw new Error(`${helper}: no store for schema ${item.name}`);
    }
    // Removing the last entity leaves the source store registered and
    // empty. A fresh world has not constructed that component, so the
    // store does not exist until this call. Nonempty sections still fail
    // in readRow when a saved id has no row.
    stores.push(
      world.entityManager.getOrCreateSoAStore(schemaForCreate(item.schema))
    );
  }
  return stores;
}

/** `writeSoAStore` for each schema, in the given order. */
export function writeSoAStores(
  w: StateWriter,
  world: GameWorld,
  schemas: readonly SoASchemaRef[]
): void {
  const stores = prepareStores(world, schemas, 'writeSoAStores', false);
  for (const store of stores) {
    writeSoAStore(w, store);
  }
}

/**
 * `readSoAStore` for each schema, in the given order.
 *
 * A missing store is created empty so a zero-row section round-trips into
 * a fresh world. A nonempty section whose entity has no row still throws
 * `readSoAStore: missing entity <id> in <schema>`.
 */
export function readSoAStores(
  r: StateReader,
  world: GameWorld,
  schemas: readonly SoASchemaRef[]
): void {
  const stores = prepareStores(world, schemas, 'readSoAStores', true);
  for (const store of stores) {
    readSoAStore(r, store);
  }
}
