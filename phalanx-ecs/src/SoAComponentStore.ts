/**
 * SoA Component Store
 *
 * High-performance Structure-of-Arrays storage for ECS components.
 * Provides cache-friendly memory layout by storing each field in contiguous typed arrays.
 *
 * Key features:
 * - O(1) access by entity ID via indirection table
 * - Dense packing for cache efficiency
 * - Automatic capacity growth
 * - Deterministic iteration order (sorted by entity ID)
 * - Type-safe field access
 *
 * @example
 * ```typescript
 * const PhysicsSchema = defineSoASchema({
 *   velocityX: 'f64', velocityY: 'f64', velocityZ: 'f64',
 *   radius: 'f64', isStatic: 'u8'
 * });
 *
 * const store = new SoAComponentStore(PhysicsSchema, 1000);
 *
 * // Add entity data
 * store.add(entityId, { velocityX: 0, velocityY: 0, velocityZ: 0, radius: 1, isStatic: 0 });
 *
 * // Direct array access in hot loops
 * const idx = store.indexOf(entityId);
 * store.arrays.velocityX[idx] += acceleration;
 *
 * // Iterate in deterministic order
 * for (const entityId of store.entityIds()) {
 *   const idx = store.indexOf(entityId);
 *   // process...
 * }
 * ```
 */

import {
  type SoASchema,
  type SoASchemaDefinition,
  type SoAFieldsOf,
  type SoAArraysOf,
  type TypedArrayLike,
  TYPED_ARRAY_CONSTRUCTORS,
} from './SoASchema';

/** Default initial capacity for stores */
const DEFAULT_INITIAL_CAPACITY = 256;

/** Growth factor when resizing (2x) */
const GROWTH_FACTOR = 2;

/**
 * Set a value in a typed array at the given index
 * Handles both number and bigint arrays
 */
function setTypedArrayValue(arr: TypedArrayLike, index: number, value: number | bigint): void {
  if (arr instanceof BigInt64Array) {
    arr[index] = value as bigint;
  } else {
    (arr as Exclude<TypedArrayLike, BigInt64Array>)[index] = value as number;
  }
}

/**
 * Get a value from a typed array at the given index
 */
function getTypedArrayValue(arr: TypedArrayLike, index: number): number | bigint {
  return arr[index];
}

/**
 * SoAComponentStore - Dense Structure-of-Arrays storage for a component type
 *
 * Uses an indirection table to map entity IDs to dense array indices,
 * enabling both O(1) access and cache-friendly iteration.
 */
export class SoAComponentStore<S extends SoASchemaDefinition> {
  /** The schema this store uses */
  public readonly schema: SoASchema<S>;

  /** Typed arrays for each field, indexed by field name */
  public readonly arrays: SoAArraysOf<S>;

  /** Current number of entities in the store */
  private _count: number = 0;

  /** Current capacity (max entities before resize) */
  private _capacity: number;

  /**
   * Maps entity ID → dense array index
   * Sparse array indexed by entity ID for O(1) lookup
   */
  private entityToIndex: Map<number, number> = new Map();

  /**
   * Maps dense array index → entity ID
   * Used for swap-and-pop removal and iteration
   */
  private indexToEntity: number[] = [];

  /**
   * Sorted list of entity IDs for deterministic iteration
   * Maintained incrementally on add/remove
   */
  private _sortedEntityIds: number[] = [];

  /**
   * Binary search to find insertion index for maintaining sorted order
   */
  private binarySearchInsertIndex(arr: number[], value: number): number {
    let low = 0;
    let high = arr.length;

    while (low < high) {
      const mid = (low + high) >>> 1;
      if (arr[mid] < value) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  constructor(schema: SoASchema<S>, initialCapacity: number = DEFAULT_INITIAL_CAPACITY) {
    this.schema = schema;
    this._capacity = initialCapacity;

    // Initialize typed arrays for each field
    const arrays: Record<string, TypedArrayLike> = {};
    for (const fieldName of schema.fieldNames) {
      const fieldType = schema.fieldTypes[fieldName];
      const ArrayConstructor = TYPED_ARRAY_CONSTRUCTORS[fieldType];
      arrays[fieldName] = new ArrayConstructor(initialCapacity);
    }
    this.arrays = arrays as SoAArraysOf<S>;
  }

  /**
   * Get current entity count
   */
  public get count(): number {
    return this._count;
  }

  /**
   * Get current capacity
   */
  public get capacity(): number {
    return this._capacity;
  }

  /**
   * Check if store contains an entity
   */
  public has(entityId: number): boolean {
    return this.entityToIndex.has(entityId);
  }

  /**
   * Get dense array index for an entity ID
   * Returns -1 if entity is not in store
   */
  public indexOf(entityId: number): number {
    return this.entityToIndex.get(entityId) ?? -1;
  }

  /**
   * Get entity ID at a dense array index
   * Returns -1 if index is out of bounds
   */
  public entityAt(index: number): number {
    return index >= 0 && index < this._count ? this.indexToEntity[index] : -1;
  }

  /**
   * Iterate entity IDs in deterministic sorted order
   * Use this for lockstep-safe iteration
   */
  public entityIds(): readonly number[] {
    return this._sortedEntityIds;
  }

  /**
   * Add an entity with initial field values
   * Returns the dense array index for the entity
   *
   * @throws If entity already exists in store
   */
  public add(entityId: number, values: SoAFieldsOf<S>): number {
    if (this.entityToIndex.has(entityId)) {
      throw new Error(`Entity ${entityId} already exists in SoA store`);
    }

    // Grow if needed
    if (this._count >= this._capacity) {
      this.grow();
    }

    const index = this._count++;

    // Update mappings
    this.entityToIndex.set(entityId, index);
    this.indexToEntity[index] = entityId;

    // Maintain sorted entity ID list
    const insertIdx = this.binarySearchInsertIndex(this._sortedEntityIds, entityId);
    this._sortedEntityIds.splice(insertIdx, 0, entityId);

    // Set initial values
    for (const fieldName of this.schema.fieldNames) {
      const arr = this.arrays[fieldName] as TypedArrayLike;
      const value = values[fieldName];
      setTypedArrayValue(arr, index, value);
    }

    return index;
  }

  /**
   * Remove an entity from the store using swap-and-pop
   * Returns true if entity was removed, false if not found
   *
   * NOTE: This changes the dense index of the last entity!
   * Hot loops should use entityIds() for stable iteration.
   */
  public remove(entityId: number): boolean {
    const index = this.entityToIndex.get(entityId);
    if (index === undefined) {
      return false;
    }

    const lastIndex = this._count - 1;

    // If not the last element, swap with last
    if (index !== lastIndex) {
      const lastEntityId = this.indexToEntity[lastIndex];

      // Copy last element's data to removed slot
      for (const fieldName of this.schema.fieldNames) {
        const arr = this.arrays[fieldName] as TypedArrayLike;
        setTypedArrayValue(arr, index, getTypedArrayValue(arr, lastIndex));
      }

      // Update mappings for swapped entity
      this.entityToIndex.set(lastEntityId, index);
      this.indexToEntity[index] = lastEntityId;
    }

    // Remove from mappings
    this.entityToIndex.delete(entityId);
    this.indexToEntity.length = lastIndex;
    this._count = lastIndex;

    // Maintain sorted entity ID list
    const sortedIdx = this.binarySearchInsertIndex(this._sortedEntityIds, entityId);
    if (this._sortedEntityIds[sortedIdx] === entityId) {
      this._sortedEntityIds.splice(sortedIdx, 1);
    }

    return true;
  }

  /**
   * Get all field values for an entity as an object
   * Useful for debugging, but creates garbage - avoid in hot paths
   */
  public get(entityId: number): SoAFieldsOf<S> | undefined {
    const index = this.entityToIndex.get(entityId);
    if (index === undefined) {
      return undefined;
    }

    const result: Record<string, unknown> = {};
    for (const fieldName of this.schema.fieldNames) {
      const arr = this.arrays[fieldName] as TypedArrayLike;
      result[fieldName] = getTypedArrayValue(arr, index);
    }
    return result as SoAFieldsOf<S>;
  }

  /**
   * Set all field values for an entity
   */
  public set(entityId: number, values: Partial<SoAFieldsOf<S>>): boolean {
    const index = this.entityToIndex.get(entityId);
    if (index === undefined) {
      return false;
    }

    for (const fieldName of this.schema.fieldNames) {
      if (fieldName in values) {
        const arr = this.arrays[fieldName] as TypedArrayLike;
        const value = values[fieldName as keyof S];
        setTypedArrayValue(arr, index, value as number | bigint);
      }
    }
    return true;
  }

  /**
   * Get a single field value for an entity
   */
  public getField<K extends keyof S & string>(
    entityId: number,
    fieldName: K
  ): SoAFieldsOf<S>[K] | undefined {
    const index = this.entityToIndex.get(entityId);
    if (index === undefined) {
      return undefined;
    }
    const arr = this.arrays[fieldName] as TypedArrayLike;
    return getTypedArrayValue(arr, index) as SoAFieldsOf<S>[K];
  }

  /**
   * Set a single field value for an entity
   */
  public setField<K extends keyof S & string>(
    entityId: number,
    fieldName: K,
    value: SoAFieldsOf<S>[K]
  ): boolean {
    const index = this.entityToIndex.get(entityId);
    if (index === undefined) {
      return false;
    }
    const arr = this.arrays[fieldName] as TypedArrayLike;
    setTypedArrayValue(arr, index, value as number | bigint);
    return true;
  }

  /**
   * Clear all entities from the store
   * Capacity is preserved
   */
  public clear(): void {
    this._count = 0;
    this.entityToIndex.clear();
    this.indexToEntity.length = 0;
    this._sortedEntityIds.length = 0;

    // Zero out arrays for clean state
    for (const fieldName of this.schema.fieldNames) {
      const arr = this.arrays[fieldName] as TypedArrayLike;
      if (arr instanceof BigInt64Array) {
        arr.fill(0n);
      } else {
        (arr as Float64Array).fill(0);
      }
    }
  }

  /**
   * Grow capacity by GROWTH_FACTOR
   */
  private grow(): void {
    const newCapacity = this._capacity * GROWTH_FACTOR;
    this.resize(newCapacity);
  }

  /**
   * Resize all arrays to new capacity
   */
  private resize(newCapacity: number): void {
    for (const fieldName of this.schema.fieldNames) {
      const oldArray = this.arrays[fieldName] as TypedArrayLike;
      const fieldType = this.schema.fieldTypes[fieldName];
      const ArrayConstructor = TYPED_ARRAY_CONSTRUCTORS[fieldType];
      const newArray = new ArrayConstructor(newCapacity);

      // Copy existing data
      if (oldArray instanceof BigInt64Array) {
        (newArray as BigInt64Array).set(oldArray);
      } else {
        (newArray as Float64Array).set(oldArray as Float64Array);
      }

      (this.arrays as Record<string, TypedArrayLike>)[fieldName] = newArray;
    }

    this._capacity = newCapacity;
  }

  /**
   * Iterate over all entities with a callback
   * Iteration order is by dense array index (NOT deterministic by entity ID)
   * Use entityIds() for deterministic iteration
   */
  public forEachDense(callback: (entityId: number, index: number) => void): void {
    for (let i = 0; i < this._count; i++) {
      callback(this.indexToEntity[i], i);
    }
  }

  /**
   * Iterate over all entities in deterministic entity ID order
   */
  public forEach(callback: (entityId: number, index: number) => void): void {
    for (const entityId of this._sortedEntityIds) {
      const index = this.entityToIndex.get(entityId)!;
      callback(entityId, index);
    }
  }
}
