import {
  SoAComponent,
  defineSoASchema,
  type SoAFieldType,
  type SoAFieldsOf,
  type SoASchema,
  type SoASchemaDefinition,
} from '@phalanx-engine/ecs';

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

const ALLOWED_FIELD_TYPES = ['i32', 'u32', 'u8', 'i64', 'f32', 'f64'] as const;

/**
 * A named SoA component. Pass it to `world.registerComponent`.
 * The name is the snapshot section key.
 */
export interface DefinedComponent<
  S extends SoASchemaDefinition = SoASchemaDefinition,
> {
  readonly name: string;
  readonly schema: SoASchema<S>;
  readonly defaults: SoAFieldsOf<S>;
  readonly type: symbol;
  create(
    entityId: number,
    values?: Readonly<Partial<Record<string, number | bigint>>>
  ): SoAComponent<S>;
}

export interface DefineComponentOptions<S extends SoASchemaDefinition> {
  readonly defaults?: Partial<SoAFieldsOf<S>>;
  onCreate?(this: SoAComponent<S>): void;
  onEnable?(this: SoAComponent<S>): void;
  onDisable?(this: SoAComponent<S>): void;
  onDestroy?(this: SoAComponent<S>): void;
}

/**
 * Define a simulation component.
 *
 * `f32` / `f64` fields are rejected: those columns are not written into
 * snapshots, so a simulation value stored there would desync. Register
 * the result with `world.registerComponent` before the first spawn.
 * Registration order and each field's name and type are included in
 * `configHash`. A type outside `i32`, `u32`, `u8`, `i64`, `f32`, `f64`
 * throws here and lists those types.
 */
export function defineComponent<S extends SoASchemaDefinition>(
  name: string,
  fields: S,
  options?: DefineComponentOptions<S>
): DefinedComponent<S> {
  assertName(name);
  for (const fieldName of Object.keys(fields)) {
    const fieldType = assertAllowedFieldType(fieldName, fields[fieldName]);
    if (fieldType === 'f32' || fieldType === 'f64') {
      throw new Error(
        `defineComponent: field '${fieldName}' is ${fieldType} and is not saved; use an integer field`
      );
    }
  }
  const schema = defineSoASchema(fields, name);
  const defaults = buildDefaults(name, fields, options?.defaults);
  const type = Symbol(name);
  const lifecycle = options;

  class Defined extends SoAComponent<S> {
    public readonly type = type;

    public constructor(entityId: number, values: SoAFieldsOf<S>) {
      super(schema, entityId, values);
    }

    public onCreate(): void {
      lifecycle?.onCreate?.call(this);
    }

    public onEnable(): void {
      lifecycle?.onEnable?.call(this);
    }

    public onDisable(): void {
      lifecycle?.onDisable?.call(this);
    }

    public onDestroy(): void {
      lifecycle?.onDestroy?.call(this);
    }
  }

  return {
    name,
    schema,
    defaults,
    type,
    create(entityId, values) {
      return new Defined(entityId, mergeValues(name, fields, defaults, values));
    },
  };
}

function assertAllowedFieldType(
  fieldName: string,
  fieldType: unknown
): SoAFieldType {
  if (!isSoAFieldType(fieldType)) {
    throw new Error(
      `defineComponent: field '${fieldName}' has type '${String(fieldType)}'; allowed types are i32, u32, u8, i64, f32, f64`
    );
  }
  return fieldType;
}

function isSoAFieldType(value: unknown): value is SoAFieldType {
  for (const allowed of ALLOWED_FIELD_TYPES) {
    if (value === allowed) return true;
  }
  return false;
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

function buildDefaults<S extends SoASchemaDefinition>(
  name: string,
  fields: S,
  overrides: Partial<SoAFieldsOf<S>> | undefined
): SoAFieldsOf<S> {
  assertKnown(name, fields, overrides);
  const defaults = {} as SoAFieldsOf<S>;
  for (const fieldName of Object.keys(fields) as (keyof S & string)[]) {
    const fieldType = requireFieldType(name, fieldName, fields[fieldName]);
    const override = overrides?.[fieldName];
    if (override !== undefined) {
      assertFieldValue(name, fieldName, fieldType, override);
      defaults[fieldName] = override;
    } else {
      defaults[fieldName] = (
        fieldType === 'i64' ? 0n : 0
      ) as SoAFieldsOf<S>[typeof fieldName];
    }
  }
  return defaults;
}

function mergeValues<S extends SoASchemaDefinition>(
  name: string,
  fields: S,
  defaults: SoAFieldsOf<S>,
  overrides: Readonly<Partial<Record<string, number | bigint>>> | undefined
): SoAFieldsOf<S> {
  assertKnown(name, fields, overrides);
  const values = {} as SoAFieldsOf<S>;
  for (const fieldName of Object.keys(fields) as (keyof S & string)[]) {
    const override = overrides?.[fieldName];
    if (override !== undefined) {
      assertFieldValue(
        name,
        fieldName,
        requireFieldType(name, fieldName, fields[fieldName]),
        override
      );
      values[fieldName] = override as SoAFieldsOf<S>[typeof fieldName];
    } else {
      values[fieldName] = defaults[fieldName];
    }
  }
  return values;
}

function assertKnown(
  name: string,
  fields: SoASchemaDefinition,
  values: Readonly<Partial<Record<string, number | bigint>>> | undefined
): void {
  if (values === undefined) return;
  for (const key of Object.keys(values)) {
    if (fields[key] === undefined) {
      throw new Error(`defineComponent '${name}': unknown field '${key}'`);
    }
  }
}

function requireFieldType(
  name: string,
  field: string,
  fieldType: SoAFieldType | undefined
): SoAFieldType {
  if (fieldType === undefined) {
    throw new Error(`defineComponent '${name}': unknown field '${field}'`);
  }
  return fieldType;
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
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(
      `defineComponent '${name}': field '${field}' expects an integer`
    );
  }
}
