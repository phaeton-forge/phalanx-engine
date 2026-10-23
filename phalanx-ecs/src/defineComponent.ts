import { defineSoASchema } from './SoASchema.js';
import type { IComponent, IStoreBoundComponent } from './Component.js';
import type { EntityManager } from './EntityManager.js';
import type { ComponentLifecycle } from './lifecycle.js';
import type { IPoolableComponent } from './pool/IPoolableComponent.js';
import type { ComponentRegistration } from './ComponentRegistration.js';
import type {
  SoAFieldType,
  SoAFieldsOf,
  SoASchema,
  SoASchemaDefinition,
} from './SoASchema.js';
import type { StateReader, StateWriter } from './state/StateIO.js';

const RESERVED_NAMES = new Set([
  'roster',
  'pools',
  'entityIds',
  'random',
  'broadphase',
  'gas',
  // Symbol description of defineSoASchema() with no explicit name.
  'SoASchema',
]);

const KNOWN_FIELD_TYPES = ['i32', 'u32', 'u8', 'i64', 'f32', 'f64'] as const;

type IntegerFieldType = 'i32' | 'u32' | 'u8' | 'i64';

/** Field map of a saved SoA component. Floats belong on a transient component. */
export type IntegerSchema = Record<string, IntegerFieldType>;

/**
 * Saved integer SoA component. Register it, then use `world.add` / `get` /
 * `remove`. `create` exists so snapshot restore can attach a row; callers
 * use the world methods.
 */
export interface SoaComponentDef<
  S extends SoASchemaDefinition = SoASchemaDefinition,
> extends ComponentRegistration<S> {
  readonly kind: 'soa';
}

/**
 * Object component. `save` and `load` may be omitted here; `registerComponent`
 * rejects the component until both are present.
 */
export interface ObjectComponentDef<T extends object = object> {
  readonly kind: 'object';
  readonly name: string;
  readonly type: symbol;
  create(): T;
  save?(value: T, writer: StateWriter): void;
  load?(reader: StateReader): T;
}

/** Display-only component. It is not saved and is not part of `configHash`. */
export interface TransientComponentDef<T extends object = object> {
  readonly kind: 'transient';
  readonly name: string;
  readonly type: symbol;
  create(): T;
}

export type DefinedComponent =
  SoaComponentDef | ObjectComponentDef | TransientComponentDef;

interface ObjectSpec<T extends object> {
  readonly kind: 'object';
  create(): T;
  save?(value: T, writer: StateWriter): void;
  load?(reader: StateReader): T;
}

interface TransientSpec<T extends object> {
  readonly kind: 'transient';
  create(): T;
}

/** Row defaults plus optional lifecycle hooks, called with no `this`. */
export interface DefineSoaOptions<
  S extends SoASchemaDefinition,
> extends ComponentLifecycle {
  readonly defaults?: Partial<SoAFieldsOf<S>>;
}

/**
 * Define a component. Domain packages import this from `@phalanx-engine/ecs`.
 *
 * SoA: `defineComponent(name, fields, { defaults? })`. Fields are `i32`,
 * `u32`, `u8` or `i64`. The runtime saves the store and folds the name and
 * fields into `configHash`.
 *
 * Object: `{ kind: 'object', create, save?, load? }`. `registerComponent`
 * throws when `save` or `load` is missing. `save` must write `Set` and
 * `Map` values with {@link writeSorted}.
 *
 * Transient: `{ kind: 'transient', create }`. Any fields, including floats
 * and objects. Not saved, not in `configHash`. Tick systems may write it
 * through `world.add` and must not branch on it.
 */
export function defineComponent<S extends IntegerSchema>(
  name: string,
  fields: S,
  options?: DefineSoaOptions<S>
): SoaComponentDef<S>;
export function defineComponent<T extends object>(
  name: string,
  spec: ObjectSpec<T>
): ObjectComponentDef<T>;
export function defineComponent<T extends object>(
  name: string,
  spec: TransientSpec<T>
): TransientComponentDef<T>;
export function defineComponent(
  name: string,
  fieldsOrSpec: IntegerSchema | ObjectSpec<object> | TransientSpec<object>,
  options?: DefineSoaOptions<SoASchemaDefinition>
) {
  assertName(name);
  if (isObjectSpec(fieldsOrSpec)) {
    return defineObject(name, fieldsOrSpec);
  }
  if (isTransientSpec(fieldsOrSpec)) {
    return defineTransient(name, fieldsOrSpec);
  }
  return defineSoa(name, fieldsOrSpec, options);
}

export function componentKind(
  component: object
): 'soa' | 'object' | 'transient' | undefined {
  if (!('kind' in component)) return undefined;
  const kind = component.kind;
  if (kind === 'soa' || kind === 'object' || kind === 'transient') {
    return kind;
  }
  return undefined;
}

/** Full row: defaults overwritten by `values`. */
export function mergeSoaValues<S extends SoASchemaDefinition>(
  component: SoaComponentDef<S>,
  values: Partial<SoAFieldsOf<S>> | undefined
): SoAFieldsOf<S> {
  assertSoaPatch(component, values);
  const merged = {} as SoAFieldsOf<S>;
  for (const fieldName of component.schema.fieldNames) {
    const override = values?.[fieldName];
    merged[fieldName] =
      override !== undefined ? override : component.defaults[fieldName];
  }
  return merged;
}

/** Reject unknown names and values that do not match the field type. */
export function assertSoaPatch<S extends SoASchemaDefinition>(
  component: SoaComponentDef<S>,
  values: Partial<SoAFieldsOf<S>> | undefined
): void {
  if (values === undefined) return;
  if (values === null || typeof values !== 'object') {
    throw new Error(
      `defineComponent '${component.name}': values must be an object`
    );
  }
  const fields = component.schema.definition;
  for (const key of Object.keys(values)) {
    const fieldType = fields[key];
    if (fieldType === undefined) {
      throw new Error(
        `defineComponent '${component.name}': unknown field '${key}'`
      );
    }
    const value = values[key as keyof S & string];
    if (value === undefined) continue;
    assertFieldValue(component.name, key, fieldType, value);
  }
}

function defineSoa<S extends IntegerSchema>(
  name: string,
  fields: S,
  options: DefineSoaOptions<S> | undefined
): SoaComponentDef<S> {
  for (const fieldName of Object.keys(fields)) {
    const fieldType = assertKnownFieldType(fieldName, fields[fieldName]);
    if (fieldType === 'f32' || fieldType === 'f64') {
      throw new Error(
        `defineComponent: field '${fieldName}' is ${fieldType} and is not saved; use a transient component`
      );
    }
  }
  const schema = defineSoASchema(fields, name);
  const defaults = buildDefaults(name, schema, options?.defaults);
  const hooks: ComponentLifecycle = options ?? {};
  return {
    kind: 'soa',
    name,
    schema,
    defaults,
    type: schema.type,
    create(entityId, values, manager) {
      return createSoaRow(
        name,
        schema,
        defaults,
        hooks,
        entityId,
        values,
        manager
      );
    },
  };
}

function defineObject<T extends object>(
  name: string,
  spec: ObjectSpec<T>
): ObjectComponentDef<T> {
  if (typeof spec.create !== 'function') {
    throw new Error(
      `defineComponent: object component '${name}' requires create`
    );
  }
  return {
    kind: 'object',
    name,
    type: Symbol(name),
    create(): T {
      return spec.create();
    },
    save:
      spec.save === undefined
        ? undefined
        : (value, writer) => {
            spec.save?.(value, writer);
          },
    load:
      spec.load === undefined
        ? undefined
        : (reader) => {
            const loaded = spec.load?.(reader);
            if (loaded === undefined) {
              throw new Error(
                `defineComponent '${name}': load() must return an object`
              );
            }
            return loaded;
          },
  };
}

function defineTransient<T extends object>(
  name: string,
  spec: TransientSpec<T>
): TransientComponentDef<T> {
  if (typeof spec.create !== 'function') {
    throw new Error(
      `defineComponent: transient component '${name}' requires create`
    );
  }
  return {
    kind: 'transient',
    name,
    type: Symbol(name),
    create(): T {
      return spec.create();
    },
  };
}

function createSoaRow<S extends SoASchemaDefinition>(
  name: string,
  schema: SoASchema<S>,
  defaults: SoAFieldsOf<S>,
  hooks: ComponentLifecycle,
  entityId: number,
  values: Readonly<Partial<Record<string, number | bigint>>> | undefined,
  manager: EntityManager | undefined
): SoaRow<S> {
  const component: SoaComponentDef<S> = {
    kind: 'soa',
    name,
    schema,
    defaults,
    type: schema.type,
    create() {
      throw new Error(`defineComponent '${name}': use world.add`);
    },
  };
  const initial = mergeSoaValues(component, values as Partial<SoAFieldsOf<S>>);
  const row = new SoaRow(schema, entityId, initial, hooks);
  if (manager !== undefined) row._bind(manager);
  return row;
}

/**
 * SoA row that follows the pool contract: `onSpawn` restores the values
 * passed to `create`, `onDespawn` drops the row. The row reaches a store
 * when the entity's world binds it; a dormant pooled entity stays out of
 * the store.
 */
class SoaRow<S extends SoASchemaDefinition>
  implements IStoreBoundComponent, IPoolableComponent
{
  public readonly type: symbol;
  private manager: EntityManager | null = null;

  public constructor(
    private readonly schema: SoASchema<S>,
    private readonly entityId: number,
    private readonly defaults: SoAFieldsOf<S>,
    private readonly hooks: ComponentLifecycle
  ) {
    this.type = schema.type;
  }

  public onCreate(): void {
    this.hooks.onCreate?.();
  }

  public onEnable(reason?: 'restore'): void {
    this.hooks.onEnable?.(reason);
  }

  public onDisable(): void {
    this.hooks.onDisable?.();
  }

  public onDestroy(): void {
    this.hooks.onDestroy?.();
  }

  public _bind(manager: EntityManager): void {
    if (this.manager === manager) return;
    if (this.manager !== null) {
      throw new Error(
        `SoA row '${String(this.type.description)}' of entity ${String(this.entityId)} belongs to another world`
      );
    }
    this.manager = manager;
    const store = manager.getOrCreateSoAStore(this.schema);
    if (store.indexOf(this.entityId) === -1) {
      store.add(this.entityId, this.defaults);
    }
  }

  public onSpawn(): void {
    const store = this.requireManager().getOrCreateSoAStore(this.schema);
    if (store.indexOf(this.entityId) === -1) {
      store.add(this.entityId, this.defaults);
      return;
    }
    store.set(this.entityId, this.defaults);
  }

  public onDespawn(): void {
    this.manager?.getSoAStore(this.schema)?.remove(this.entityId);
  }

  private requireManager(): EntityManager {
    if (this.manager === null) {
      throw new Error(
        `SoA row '${String(this.type.description)}' of entity ${String(this.entityId)} is not in a world`
      );
    }
    return this.manager;
  }
}

function isObjectSpec(value: object): value is ObjectSpec<object> {
  return 'kind' in value && value.kind === 'object';
}

function isTransientSpec(value: object): value is TransientSpec<object> {
  return 'kind' in value && value.kind === 'transient';
}

function assertName(name: string): void {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('defineComponent: name must be a non-empty string');
  }
  if (RESERVED_NAMES.has(name)) {
    throw new Error(
      `defineComponent: '${name}' is reserved for a world-module section`
    );
  }
}

function assertKnownFieldType(
  fieldName: string,
  fieldType: unknown
): SoAFieldType | 'f32' | 'f64' {
  if (!isKnownFieldType(fieldType)) {
    throw new Error(
      `defineComponent: field '${fieldName}' has type '${String(fieldType)}'; allowed types are i32, u32, u8, i64, f32, f64`
    );
  }
  return fieldType;
}

function isKnownFieldType(
  value: unknown
): value is (typeof KNOWN_FIELD_TYPES)[number] {
  for (const allowed of KNOWN_FIELD_TYPES) {
    if (value === allowed) return true;
  }
  return false;
}

function buildDefaults<S extends SoASchemaDefinition>(
  name: string,
  schema: SoASchema<S>,
  overrides: Partial<SoAFieldsOf<S>> | undefined
): SoAFieldsOf<S> {
  const component = {
    kind: 'soa' as const,
    name,
    schema,
    defaults: {} as SoAFieldsOf<S>,
    type: schema.type,
    create(): IComponent {
      return { type: schema.type };
    },
  };
  assertSoaPatch(component, overrides);
  const defaults = {} as SoAFieldsOf<S>;
  for (const fieldName of schema.fieldNames) {
    const fieldType = schema.fieldTypes[fieldName];
    const override = overrides?.[fieldName];
    if (override !== undefined) {
      defaults[fieldName] = override;
    } else if (fieldType === 'i64') {
      defaults[fieldName] = 0n as SoAFieldsOf<S>[typeof fieldName];
    } else {
      defaults[fieldName] = 0 as SoAFieldsOf<S>[typeof fieldName];
    }
  }
  return defaults;
}

function assertFieldValue(
  name: string,
  field: string,
  fieldType: SoAFieldType,
  value: number | bigint
): void {
  if (fieldType === 'i64') {
    if (typeof value !== 'bigint') {
      throw new Error(
        `defineComponent '${name}': field '${field}' expects a bigint`
      );
    }
    return;
  }
  if (fieldType === 'f32' || fieldType === 'f64') {
    throw new Error(
      `defineComponent: field '${field}' is ${fieldType} and is not saved; use a transient component`
    );
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(
      `defineComponent '${name}': field '${field}' expects an integer`
    );
  }
}
