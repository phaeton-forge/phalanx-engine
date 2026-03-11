import type { Entity } from './Entity';
import { SoAComponentStore } from './SoAComponentStore';
import type { SoASchema, SoASchemaDefinition } from './SoASchema';

/**
 * EntityManager - Central registry for all game entities
 * Provides efficient component-based queries for systems
 *
 * Performance optimization: Component indices are maintained as sorted arrays
 * rather than Sets, eliminating the need to sort on every query. Since entity
 * IDs are typically sequential, insertions are usually O(1) at the end.
 *
 * SoA Support: Can hold SoAComponentStore instances for high-performance
 * component types. SoA stores are registered by schema type symbol and
 * provide cache-friendly iteration for hot-path systems.
 */
export class EntityManager {
  private entities: Map<number, Entity> = new Map();

  // Sorted array of all entity IDs for fast deterministic iteration
  private sortedEntityIds: number[] = [];

  // SoA component stores indexed by schema type symbol
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private soaStores: Map<symbol, SoAComponentStore<any>> = new Map();

  // Component indices for fast queries
  // These are sorted arrays of entity IDs that have each component
  private componentIndices: Map<symbol, number[]> = new Map();

  // ── Query Cache ────────────────────────────────────────────────────
  // Reusable result buffers keyed by a cache key derived from component types.
  // The cache is invalidated (cleared) whenever entities or components change.
  private queryCache: Map<string, Entity[]> = new Map();
  private queryCacheDirty: boolean = true;

  /** Build a deterministic cache key from an array of component type symbols. */
  private buildQueryCacheKey(componentTypes: symbol[]): string {
    // Symbol.toString() is deterministic for the same symbol instance
    return componentTypes.map((s) => s.toString()).sort().join('|');
  }

  /**
   * Binary search to find insertion index for maintaining sorted order
   * Returns the index where the value should be inserted
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

  /**
   * Insert a value into a sorted array, maintaining sorted order
   */
  private sortedInsert(arr: number[], value: number): void {
    const index = this.binarySearchInsertIndex(arr, value);
    // Avoid duplicate insertion
    if (arr[index] !== value) {
      arr.splice(index, 0, value);
    }
  }

  /**
   * Remove a value from a sorted array using binary search
   */
  private sortedRemove(arr: number[], value: number): void {
    const index = this.binarySearchInsertIndex(arr, value);
    if (arr[index] === value) {
      arr.splice(index, 1);
    }
  }

  /**
   * Register component types for efficient queries
   * Call this during initialization with your game's component types
   * @param componentTypes - Array of component type symbols
   */
  public registerComponentTypes(componentTypes: symbol[]): void {
    for (const type of componentTypes) {
      if (!this.componentIndices.has(type)) {
        this.componentIndices.set(type, []);
      }
    }
  }

  /**
   * Register an entity with the manager
   */
  public addEntity(entity: Entity): void {
    this.entities.set(entity.id, entity);
    this.sortedInsert(this.sortedEntityIds, entity.id);

    // Update component indices for any registered component types
    for (const [type, index] of this.componentIndices) {
      if (entity.hasComponent(type)) {
        this.sortedInsert(index, entity.id);
      }
    }

    this.invalidateQueryCache();
  }

  /**
   * Remove an entity from the manager
   */
  public removeEntity(entity: Entity): void {
    // Remove from all component indices
    for (const index of this.componentIndices.values()) {
      this.sortedRemove(index, entity.id);
    }

    // Remove from all SoA stores
    this.cleanupSoAStores(entity.id);

    this.sortedRemove(this.sortedEntityIds, entity.id);
    this.entities.delete(entity.id);

    this.invalidateQueryCache();
  }

  /**
   * Get entity by ID
   */
  public getEntity(id: number): Entity | undefined {
    return this.entities.get(id);
  }

  /**
   * Get all entities
   *
   * IMPORTANT: Results are sorted by entity ID for deterministic ordering
   * across all clients in networked games.
   *
   * Performance: No sorting needed - entities are maintained in sorted order.
   */
  public getAllEntities(): Entity[] {
    const result: Entity[] = [];
    for (const id of this.sortedEntityIds) {
      const entity = this.entities.get(id);
      if (entity) {
        result.push(entity);
      }
    }
    return result;
  }

  /**
   * Query entities that have ALL specified components
   * This is the primary method systems use to get relevant entities
   *
   * IMPORTANT: Results are sorted by entity ID for deterministic ordering
   * across all clients in networked games. This ensures that iteration
   * order is consistent, which is critical for deterministic gameplay.
   *
   * Performance: No sorting needed - component indices are maintained in sorted order.
   */
  public queryEntities(...componentTypes: symbol[]): Entity[] {
    if (componentTypes.length === 0) {
      return this.getAllEntities();
    }

    // Start with the smallest set for efficiency
    const sortedTypes = [...componentTypes].sort((a, b) => {
      const sizeA = this.componentIndices.get(a)?.length ?? 0;
      const sizeB = this.componentIndices.get(b)?.length ?? 0;
      return sizeA - sizeB;
    });

    const firstIndex = this.componentIndices.get(sortedTypes[0]);
    if (!firstIndex || firstIndex.length === 0) {
      return [];
    }

    // Filter by intersection of all component sets
    // Since firstIndex is already sorted, result will be in sorted order
    const result: Entity[] = [];
    for (const entityId of firstIndex) {
      const entity = this.entities.get(entityId);
      if (
        entity &&
        !entity.isDestroyed &&
        entity.hasComponents(...componentTypes)
      ) {
        result.push(entity);
      }
    }

    return result;
  }

  /**
   * Query entities that have at least ONE of the specified components
   *
   * IMPORTANT: Results are sorted by entity ID for deterministic ordering
   * across all clients in networked games.
   *
   * Performance: Uses merge of pre-sorted arrays instead of Set + sort.
   */
  public queryEntitiesAny(...componentTypes: symbol[]): Entity[] {
    if (componentTypes.length === 0) {
      return [];
    }

    // Merge sorted arrays to get union of entity IDs
    const mergedIds = this.mergeSortedArrays(
      componentTypes
        .map((type) => this.componentIndices.get(type))
        .filter((arr): arr is number[] => arr !== undefined)
    );

    const result: Entity[] = [];
    for (const id of mergedIds) {
      const entity = this.entities.get(id);
      if (entity && !entity.isDestroyed) {
        result.push(entity);
      }
    }

    return result;
  }

  // ============ Cached Queries ============

  /**
   * Query entities with a reusable result buffer.
   * Does not allocate a new array when the cache is still valid.
   *
   * IMPORTANT: The returned array is owned by the cache — do NOT modify it.
   *
   * @param componentTypes — Component types to filter by
   * @returns Readonly array of matching entities (sorted by ID)
   */
  public queryEntitiesCached(...componentTypes: symbol[]): readonly Entity[] {
    const key = this.buildQueryCacheKey(componentTypes);

    if (!this.queryCacheDirty) {
      const cached = this.queryCache.get(key);
      if (cached) {
        return cached;
      }
    }

    // Perform the actual query
    const result = this.queryEntities(...componentTypes);

    // Store in cache. Clear dirty so subsequent cached queries also
    // rebuild lazily on their next call.
    this.queryCache.set(key, result);
    this.queryCacheDirty = false;

    return result;
  }

  /**
   * Invalidate all cached query results.
   * Called automatically when entities or components change.
   */
  public invalidateQueryCache(): void {
    this.queryCacheDirty = true;
    this.queryCache.clear();
  }

  /**
   * Merge multiple sorted arrays into a single sorted array with unique values
   */
  private mergeSortedArrays(arrays: number[][]): number[] {
    if (arrays.length === 0) return [];
    if (arrays.length === 1) return arrays[0];

    const result: number[] = [];
    const pointers = arrays.map(() => 0);

    while (true) {
      let minValue = Infinity;
      let minIndex = -1;

      // Find the smallest current value across all arrays
      for (let i = 0; i < arrays.length; i++) {
        if (pointers[i] < arrays[i].length && arrays[i][pointers[i]] < minValue) {
          minValue = arrays[i][pointers[i]];
          minIndex = i;
        }
      }

      if (minIndex === -1) break;

      // Add to result if not duplicate
      if (result.length === 0 || result[result.length - 1] !== minValue) {
        result.push(minValue);
      }

      // Advance all pointers that point to this value
      for (let i = 0; i < arrays.length; i++) {
        if (pointers[i] < arrays[i].length && arrays[i][pointers[i]] === minValue) {
          pointers[i]++;
        }
      }
    }

    return result;
  }

  /**
   * Update component index when a component is added to an entity
   */
  public onComponentAdded(entity: Entity, componentType: symbol): void {
    const index = this.componentIndices.get(componentType);
    if (index) {
      this.sortedInsert(index, entity.id);
    }
    this.invalidateQueryCache();
  }

  /**
   * Update component index when a component is removed from an entity
   */
  public onComponentRemoved(entity: Entity, componentType: symbol): void {
    const index = this.componentIndices.get(componentType);
    if (index) {
      this.sortedRemove(index, entity.id);
    }
    this.invalidateQueryCache();
  }

  /**
   * Remove destroyed entities
   */
  public cleanupDestroyed(): Entity[] {
    const destroyed: Entity[] = [];

    for (const entity of this.entities.values()) {
      if (entity.isDestroyed) {
        destroyed.push(entity);
      }
    }

    for (const entity of destroyed) {
      this.removeEntity(entity);
    }

    return destroyed;
  }

  /**
   * Get count of entities with a specific component
   */
  public countWithComponent(componentType: symbol): number {
    return this.componentIndices.get(componentType)?.length ?? 0;
  }

  /**
   * Get total entity count
   */
  public get count(): number {
    return this.entities.size;
  }

  // ============ SoA Component Store Management ============

  /**
   * Register a SoA component store
   * Call this during initialization for high-performance component types
   *
   * @param store - The SoAComponentStore instance to register
   */
  public registerSoAStore<S extends SoASchemaDefinition>(
    store: SoAComponentStore<S>
  ): void {
    this.soaStores.set(store.schema.type, store);
  }

  /**
   * Get a registered SoA component store by schema
   *
   * @param schema - The schema used to create the store
   * @returns The store, or undefined if not registered
   */
  public getSoAStore<S extends SoASchemaDefinition>(
    schema: SoASchema<S>
  ): SoAComponentStore<S> | undefined {
    return this.soaStores.get(schema.type) as SoAComponentStore<S> | undefined;
  }

  /**
   * Get a registered SoA component store by schema type symbol
   *
   * @param schemaType - The schema type symbol
   * @returns The store, or undefined if not registered
   */
  public getSoAStoreByType<S extends SoASchemaDefinition>(
    schemaType: symbol
  ): SoAComponentStore<S> | undefined {
    return this.soaStores.get(schemaType) as SoAComponentStore<S> | undefined;
  }

  /**
   * Get or lazily create a SoA store for the given schema.
   * If a store already exists for this schema type, it is returned.
   * Otherwise a new one is created, registered, and returned.
   *
   * @param schema - The schema definition
   * @param initialCapacity - Initial entity capacity (default: 1024)
   */
  public getOrCreateSoAStore<S extends SoASchemaDefinition>(
    schema: SoASchema<S>,
    initialCapacity: number = 1024
  ): SoAComponentStore<S> {
    const existing = this.soaStores.get(schema.type) as SoAComponentStore<S> | undefined;
    if (existing) {
      return existing;
    }
    const store = new SoAComponentStore<S>(schema, initialCapacity);
    this.soaStores.set(schema.type, store);
    return store;
  }

  /**
   * Check if a SoA store is registered for a schema
   */
  public hasSoAStore(schema: SoASchema): boolean {
    return this.soaStores.has(schema.type);
  }

  /**
   * Remove entity data from all SoA stores
   * Called automatically when entity is removed
   */
  private cleanupSoAStores(entityId: number): void {
    for (const store of this.soaStores.values()) {
      store.remove(entityId);
    }
  }

  /**
   * Clear all entities
   */
  public clear(): void {
    for (const entity of this.entities.values()) {
      entity.dispose();
    }
    this.entities.clear();
    this.sortedEntityIds.length = 0;

    for (const index of this.componentIndices.values()) {
      index.length = 0;
    }

    // Clear all SoA stores
    for (const store of this.soaStores.values()) {
      store.clear();
    }
  }
}
