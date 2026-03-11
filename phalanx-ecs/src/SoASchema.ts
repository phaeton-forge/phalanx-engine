/**
 * SoA Schema Definition Module
 *
 * Provides type-safe schema definitions for Structure-of-Arrays (SoA) component storage.
 * This enables cache-friendly memory layout for hot-path components like physics and transforms.
 *
 * @example
 * ```typescript
 * const PhysicsSchema = defineSoASchema({
 *   velocityX: 'f64',
 *   velocityY: 'f64',
 *   velocityZ: 'f64',
 *   radius: 'f64',
 *   mass: 'f64',
 *   isStatic: 'u8',
 *   ignorePhysics: 'u8',
 * });
 *
 * // Type-safe access:
 * type PhysicsFields = SoAFieldsOf<typeof PhysicsSchema>;
 * // { velocityX: number, velocityY: number, ... }
 * ```
 */

/**
 * Supported field types for SoA storage
 * - f32: 32-bit float (Float32Array) - lower precision, faster
 * - f64: 64-bit float (Float64Array) - full JS number precision
 * - i32: 32-bit signed integer (Int32Array)
 * - u32: 32-bit unsigned integer (Uint32Array)
 * - u8: 8-bit unsigned integer (Uint8Array) - for flags/booleans
 * - i64: 64-bit signed integer (BigInt64Array) - for fixed-point raw values
 */
export type SoAFieldType = 'f32' | 'f64' | 'i32' | 'u32' | 'u8' | 'i64';

/**
 * Maps SoA field types to their TypedArray constructors
 */
export const TYPED_ARRAY_CONSTRUCTORS: Record<SoAFieldType, new (length: number) => TypedArrayLike> = {
  f32: Float32Array,
  f64: Float64Array,
  i32: Int32Array,
  u32: Uint32Array,
  u8: Uint8Array,
  i64: BigInt64Array,
};

/**
 * Maps SoA field types to their element sizes in bytes
 */
export const FIELD_BYTE_SIZES: Record<SoAFieldType, number> = {
  f32: 4,
  f64: 8,
  i32: 4,
  u32: 4,
  u8: 1,
  i64: 8,
};

/**
 * Union of all TypedArray types we support
 */
export type TypedArrayLike =
  | Float32Array
  | Float64Array
  | Int32Array
  | Uint32Array
  | Uint8Array
  | BigInt64Array;

/**
 * Schema definition type - maps field names to their types
 */
export type SoASchemaDefinition = Record<string, SoAFieldType>;

/**
 * Extracts the JavaScript value type from a SoA field type
 */
export type SoAValueType<T extends SoAFieldType> =
  T extends 'i64' ? bigint : number;

/**
 * Extracts the TypedArray type from a SoA field type
 */
export type SoAArrayType<T extends SoAFieldType> =
  T extends 'f32' ? Float32Array :
  T extends 'f64' ? Float64Array :
  T extends 'i32' ? Int32Array :
  T extends 'u32' ? Uint32Array :
  T extends 'u8' ? Uint8Array :
  T extends 'i64' ? BigInt64Array :
  never;

/**
 * Maps a schema definition to a typed object with field values
 */
export type SoAFieldsOf<S extends SoASchemaDefinition> = {
  [K in keyof S]: SoAValueType<S[K]>;
};

/**
 * Maps a schema definition to typed arrays for each field
 */
export type SoAArraysOf<S extends SoASchemaDefinition> = {
  [K in keyof S]: SoAArrayType<S[K]>;
};

/**
 * A defined SoA schema with runtime metadata
 */
export interface SoASchema<S extends SoASchemaDefinition = SoASchemaDefinition> {
  /** The original schema definition */
  readonly definition: S;
  /** Ordered list of field names */
  readonly fieldNames: (keyof S & string)[];
  /** Field types indexed by name */
  readonly fieldTypes: S;
  /** Unique symbol identifier for this schema */
  readonly type: symbol;
}

/**
 * Define a SoA schema with type-safe field definitions
 *
 * @param definition - Object mapping field names to their types
 * @param name - Optional name for the schema (used in symbol description)
 * @returns A typed schema object that can be used with SoAComponentStore
 *
 * @example
 * ```typescript
 * const TransformSchema = defineSoASchema({
 *   positionX: 'f64',
 *   positionY: 'f64',
 *   positionZ: 'f64',
 * }, 'Transform');
 * ```
 */
export function defineSoASchema<S extends SoASchemaDefinition>(
  definition: S,
  name?: string
): SoASchema<S> {
  const fieldNames = Object.keys(definition) as (keyof S & string)[];

  return {
    definition,
    fieldNames,
    fieldTypes: definition,
    type: Symbol(name ?? 'SoASchema'),
  };
}

/**
 * Calculate total byte size per entity for a schema
 * Useful for memory planning and debugging
 */
export function calculateSchemaByteSize(schema: SoASchema): number {
  let total = 0;
  for (const fieldName of schema.fieldNames) {
    const fieldType = schema.fieldTypes[fieldName];
    total += FIELD_BYTE_SIZES[fieldType];
  }
  return total;
}
