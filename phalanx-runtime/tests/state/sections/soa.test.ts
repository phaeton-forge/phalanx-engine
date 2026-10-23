import { describe, expect, it } from 'vitest';
import {
  Entity,
  GameWorld,
  defineComponent,
  defineSoASchema,
  type SoAComponentStore,
  type SoASchema,
  type SoASchemaDefinition,
  type TypedArrayLike,
} from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import {
  PhysicsSoASchema,
  TransformSoASchema,
  attachPhysicsBody,
  attachTransform,
} from '@phalanx-engine/physics';
import { StateHelpers } from '../../../src/advanced/StateHelpers.js';
import { BinaryStateReader, BinaryStateWriter } from '@phalanx-engine/ecs';
import { manualTickProvider } from '../../support/manualTickProvider.js';

const ENTITY_COUNT = 50;

const MarkerSchema = defineSoASchema(
  {
    team: 'i32',
    flags: 'u8',
    score: 'i64',
    shown: 'f32',
  },
  'Marker'
);

const SCHEMAS = [TransformSoASchema, PhysicsSoASchema, MarkerSchema] as const;

class Body extends Entity {
  public constructor(id: number) {
    super(id);
    attachTransform(this, { x: FP._0, y: FP._0, z: FP._0 });
    attachPhysicsBody(this, { radius: FP._1 });
  }
}

function finish(fill: (w: BinaryStateWriter) => void): Uint8Array {
  const writer = new BinaryStateWriter();
  fill(writer);
  return writer.finish();
}

function fieldArray<S extends SoASchemaDefinition>(
  store: SoAComponentStore<S>,
  fieldName: string
): TypedArrayLike {
  const arrays = store.arrays as Record<string, TypedArrayLike>;
  const array = arrays[fieldName];
  if (array === undefined) {
    throw new Error(`missing array ${fieldName}`);
  }
  return array;
}

function persistedFields<S extends SoASchemaDefinition>(
  store: SoAComponentStore<S>
): string[] {
  return store.schema.fieldNames.filter((fieldName) => {
    const fieldType = store.schema.fieldTypes[fieldName];
    return fieldType !== 'f32' && fieldType !== 'f64';
  });
}

function snapshotStore<S extends SoASchemaDefinition>(
  store: SoAComponentStore<S>
): Map<number, (bigint | number)[]> {
  const fields = persistedFields(store);
  const snapshot = new Map<number, (bigint | number)[]>();
  for (const id of store.entityIds()) {
    const index = store.indexOf(id);
    const values: (bigint | number)[] = [];
    for (const fieldName of fields) {
      const value = fieldArray(store, fieldName)[index];
      if (value === undefined) {
        throw new Error(`missing ${fieldName} for ${String(id)}`);
      }
      values.push(value);
    }
    snapshot.set(id, values);
  }
  return snapshot;
}

function stamp<S extends SoASchemaDefinition>(
  store: SoAComponentStore<S>
): void {
  const names = store.schema.fieldNames;
  for (const id of store.entityIds()) {
    const index = store.indexOf(id);
    for (let field = 0; field < names.length; field += 1) {
      const fieldName = names[field];
      if (fieldName === undefined) continue;
      const fieldType = store.schema.fieldTypes[fieldName];
      const array = fieldArray(store, fieldName);
      if (fieldType === 'i64') {
        if (!(array instanceof BigInt64Array)) {
          throw new Error(`expected i64 array for ${fieldName}`);
        }
        array[index] = BigInt(field) - BigInt(id) * 3n;
      } else if (array instanceof BigInt64Array) {
        throw new Error(`unexpected i64 array for ${fieldName}`);
      } else if (fieldType === 'i32') {
        array[index] = field % 2 === 0 ? -id : id;
      } else if (fieldType === 'u32') {
        array[index] = id * 10 + field;
      } else if (fieldType === 'u8') {
        array[index] = (id + field) % 200;
      } else {
        array[index] = id + field + 0.5;
      }
    }
  }
}

function poison<S extends SoASchemaDefinition>(
  store: SoAComponentStore<S>
): void {
  for (const id of store.entityIds()) {
    const index = store.indexOf(id);
    for (const fieldName of store.schema.fieldNames) {
      const fieldType = store.schema.fieldTypes[fieldName];
      const array = fieldArray(store, fieldName);
      if (fieldType === 'i64') {
        if (!(array instanceof BigInt64Array)) {
          throw new Error(`expected i64 array for ${fieldName}`);
        }
        array[index] = 1n;
      } else if (array instanceof BigInt64Array) {
        throw new Error(`unexpected i64 array for ${fieldName}`);
      } else if (fieldType === 'f32' || fieldType === 'f64') {
        array[index] = 999;
      } else {
        array[index] = 7;
      }
    }
  }
}

function requireStore<S extends SoASchemaDefinition>(
  world: GameWorld,
  schema: SoASchema<S>
): SoAComponentStore<S> {
  const store = world.entityManager.getSoAStore(schema);
  if (store === undefined) {
    throw new Error('missing store');
  }
  return store;
}

function buildWorld(): GameWorld {
  const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
  for (let id = ENTITY_COUNT; id >= 1; id -= 1) {
    StateHelpers.spawnWithId(world, id, (entityId) => new Body(entityId));
  }
  const markers = world.entityManager.getOrCreateSoAStore(MarkerSchema);
  for (const id of world.entityManager
    .getAllEntities()
    .map((entity) => entity.id)) {
    markers.add(id, {
      team: 0,
      flags: 0,
      score: 0n,
      shown: 0,
    });
  }
  for (const schema of SCHEMAS) {
    const store = world.entityManager.getSoAStoreByType(schema.type);
    if (store === undefined) {
      throw new Error('missing store');
    }
    stamp(store);
  }
  return world;
}

describe('SoA state helpers', () => {
  it('restores i64, i32 and u8 fields and ignores f32/f64', () => {
    const source = buildWorld();
    const expected = SCHEMAS.map((schema) => {
      const store = source.entityManager.getSoAStoreByType(schema.type);
      if (store === undefined) {
        throw new Error('missing store');
      }
      return snapshotStore(store);
    });
    const bytes = finish((writer) => {
      StateHelpers.writeSoAStores(writer, source, SCHEMAS);
    });

    const shown = requireStore(source, MarkerSchema);
    for (const id of shown.entityIds()) {
      const markerIndex = shown.indexOf(id);
      shown.arrays.shown[markerIndex] = id + 0.25;
    }
    const withoutFloats = finish((writer) => {
      StateHelpers.writeSoAStores(writer, source, SCHEMAS);
    });
    expect(withoutFloats.byteLength).toBe(bytes.byteLength);
    expect(withoutFloats).toEqual(bytes);

    const restored = new GameWorld({ tickFrameProvider: manualTickProvider() });
    for (let id = 1; id <= ENTITY_COUNT; id += 1) {
      StateHelpers.spawnWithId(restored, id, (entityId) => new Body(entityId));
    }
    const restoredMarkers =
      restored.entityManager.getOrCreateSoAStore(MarkerSchema);
    for (let id = 1; id <= ENTITY_COUNT; id += 1) {
      restoredMarkers.add(id, {
        team: 0,
        flags: 0,
        score: 0n,
        shown: 0,
      });
    }
    for (const schema of SCHEMAS) {
      const store = restored.entityManager.getSoAStoreByType(schema.type);
      if (store === undefined) {
        throw new Error('missing store');
      }
      poison(store);
    }

    const reader = new BinaryStateReader(bytes);
    StateHelpers.readSoAStores(reader, restored, SCHEMAS);
    reader.done();

    SCHEMAS.forEach((schema, schemaIndex) => {
      const store = restored.entityManager.getSoAStoreByType(schema.type);
      if (store === undefined) {
        throw new Error('missing store');
      }
      expect(snapshotStore(store)).toEqual(expected[schemaIndex]);
    });
    for (const id of restoredMarkers.entityIds()) {
      const markerIndex = restoredMarkers.indexOf(id);
      expect(restoredMarkers.arrays.shown[markerIndex]).toBe(999);
    }

    const again = finish((writer) => {
      StateHelpers.writeSoAStores(writer, restored, SCHEMAS);
    });
    expect(again).toEqual(bytes);
  });

  it('omits an f64 field from the byte length', () => {
    const schema = defineSoASchema({ a: 'u8', hidden: 'f64', b: 'u8' }, 'Tiny');
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    const store = world.entityManager.getOrCreateSoAStore(schema);
    store.add(1, { a: 2, hidden: 99.5, b: 3 });

    const bytes = finish((writer) => {
      StateHelpers.writeSoAStore(writer, store);
    });

    // section('Tiny', 1): str + version + length + one row.
    // Row is varint(1), u32 id 1, u8 2, u8 3. The f64 is absent,
    // so the body is 7 bytes and the section is 14, not 22.
    const expected = new Uint8Array([
      0x04, 0x54, 0x69, 0x6e, 0x79, 0x01, 0x07, 0x01, 0x01, 0x00, 0x00, 0x00,
      0x02, 0x03,
    ]);
    expect(bytes.byteLength).toBe(14);
    expect(bytes.byteLength).not.toBe(22);
    expect(bytes).toEqual(expected);
  });

  it('restores a zero-row store after the last entity is removed', () => {
    const Flag = defineComponent('Flag', { n: 'i32' }, { defaults: { n: 1 } });
    const FlagSchema = Flag.schema;

    class FlagEntity extends Entity {
      public constructor(id: number) {
        super(id);
        this.addComponent(Flag.create(this.id));
      }
    }

    const source = new GameWorld({ tickFrameProvider: manualTickProvider() });
    const entity = source.createEntity((id) => new FlagEntity(id));
    source.entityManager.addEntity(entity);
    source.entityManager.removeEntity(entity);
    const emptied = source.entityManager.getSoAStore(FlagSchema);
    expect(emptied).toBeDefined();
    expect(emptied?.entityIds()).toEqual([]);

    const bytes = finish((writer) => {
      StateHelpers.writeSoAStores(writer, source, [FlagSchema]);
    });

    const restored = new GameWorld({ tickFrameProvider: manualTickProvider() });
    expect(restored.entityManager.getSoAStore(FlagSchema)).toBeUndefined();
    const reader = new BinaryStateReader(bytes);
    StateHelpers.readSoAStores(reader, restored, [FlagSchema]);
    reader.done();

    const again = finish((writer) => {
      StateHelpers.writeSoAStores(writer, restored, [FlagSchema]);
    });
    expect(again).toEqual(bytes);
    expect(restored.entityManager.getSoAStore(FlagSchema)?.entityIds()).toEqual(
      []
    );
  });

  it('keeps the missing-row error when a nonempty section has no store', () => {
    const schema = defineSoASchema({ a: 'u8' }, 'Lone');
    const source = new GameWorld({ tickFrameProvider: manualTickProvider() });
    source.entityManager.getOrCreateSoAStore(schema).add(7, { a: 1 });
    const bytes = finish((writer) => {
      StateHelpers.writeSoAStores(writer, source, [schema]);
    });
    const restored = new GameWorld({ tickFrameProvider: manualTickProvider() });
    const reader = new BinaryStateReader(bytes);
    expect(() =>
      StateHelpers.readSoAStores(reader, restored, [schema])
    ).toThrow('readSoAStore: missing entity 7 in Lone');
  });

  it('throws when the store has an entity the section omitted', () => {
    const schema = defineSoASchema({ a: 'u8' }, 'Extra');
    const source = new GameWorld({ tickFrameProvider: manualTickProvider() });
    const store = source.entityManager.getOrCreateSoAStore(schema);
    store.add(1, { a: 1 });
    const bytes = finish((writer) => {
      StateHelpers.writeSoAStore(writer, store);
    });

    const restored = new GameWorld({ tickFrameProvider: manualTickProvider() });
    const restoredStore = restored.entityManager.getOrCreateSoAStore(schema);
    restoredStore.add(1, { a: 0 });
    restoredStore.add(2, { a: 0 });
    const reader = new BinaryStateReader(bytes);
    expect(() => StateHelpers.readSoAStore(reader, restoredStore)).toThrow(
      'readSoAStore: extra entity 2 in Extra'
    );
  });

  it('throws when a saved entity has no row', () => {
    const source = buildWorld();
    const bytes = finish((writer) => {
      StateHelpers.writeSoAStores(writer, source, SCHEMAS);
    });
    const restored = new GameWorld({ tickFrameProvider: manualTickProvider() });
    for (let id = 1; id < ENTITY_COUNT; id += 1) {
      StateHelpers.spawnWithId(restored, id, (entityId) => new Body(entityId));
    }
    const markers = restored.entityManager.getOrCreateSoAStore(MarkerSchema);
    for (let id = 1; id < ENTITY_COUNT; id += 1) {
      markers.add(id, { team: 0, flags: 0, score: 0n, shown: 0 });
    }
    const reader = new BinaryStateReader(bytes);
    expect(() => StateHelpers.readSoAStores(reader, restored, SCHEMAS)).toThrow(
      'readSoAStore: missing entity 50 in Transform'
    );
  });

  it('requires an explicit unique schema name', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    const unnamed = defineSoASchema({ a: 'i32' });
    const store = world.entityManager.getOrCreateSoAStore(unnamed);
    store.add(1, { a: 4 });
    expect(() =>
      finish((writer) => {
        StateHelpers.writeSoAStore(writer, store);
      })
    ).toThrow(/no explicit name/);

    const left = defineSoASchema({ a: 'i32' }, 'Same');
    const right = defineSoASchema({ b: 'i32' }, 'Same');
    world.entityManager.getOrCreateSoAStore(left).add(1, { a: 1 });
    world.entityManager.getOrCreateSoAStore(right).add(1, { b: 2 });
    expect(() =>
      finish((writer) => {
        StateHelpers.writeSoAStores(writer, world, [left, right]);
      })
    ).toThrow("writeSoAStores: duplicate schema name 'Same'");
  });
});
