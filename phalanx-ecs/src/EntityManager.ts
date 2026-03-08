import type { Entity } from './Entity';

/**
 * EntityManager - Central registry for all game entities
 * Provides efficient component-based queries for systems
 *
 * Performance optimization: Component indices are maintained as sorted arrays
 * rather than Sets, eliminating the need to sort on every query. Since entity
 * IDs are typically sequential, insertions are usually O(1) at the end.
 */
export class EntityManager {
  private entities: Map<number, Entity> = new Map();

  // Sorted array of all entity IDs for fast deterministic iteration
  private sortedEntityIds: number[] = [];

  // Component indices for fast queries
  // These are sorted arrays of entity IDs that have each component
  private componentIndices: Map<symbol, number[]> = new Map();

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
  }

  /**
   * Remove an entity from the manager
   */
  public removeEntity(entity: Entity): void {
    // Remove from all component indices
    for (const index of this.componentIndices.values()) {
      this.sortedRemove(index, entity.id);
    }

    this.sortedRemove(this.sortedEntityIds, entity.id);
    this.entities.delete(entity.id);
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
  }

  /**
   * Update component index when a component is removed from an entity
   */
  public onComponentRemoved(entity: Entity, componentType: symbol): void {
    const index = this.componentIndices.get(componentType);
    if (index) {
      this.sortedRemove(index, entity.id);
    }
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
  }
}
