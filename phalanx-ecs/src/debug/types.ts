import type { PoolStats } from '../pool/types';
import type { SoAFieldType } from '../SoASchema';

/**
 * Serialised snapshot of a single IComponent attached to an entity.
 */
export interface DebugComponentSnapshot {
  /** Human-readable name derived from symbol.description */
  typeName: string;
  /** Original component type symbol */
  typeSymbol: symbol;
  /** Shallow copy of the component's own enumerable properties (excluding `type`) */
  data: Record<string, unknown>;
}

/**
 * Serialised snapshot of a single entity and its standard (non-SoA) components.
 */
export interface DebugEntitySnapshot {
  id: number;
  destroyed: boolean;
  components: DebugComponentSnapshot[];
}

/**
 * Serialised snapshot of one SoA component store.
 */
export interface DebugSoAStoreSnapshot {
  /** Human-readable schema name from symbol.description */
  name: string;
  /** Ordered field names from the schema */
  fieldNames: string[];
  /** Field name → SoA type string (e.g. 'f64', 'i64', 'u8') */
  fieldTypes: Record<string, SoAFieldType>;
  /** Current number of entities in the store */
  count: number;
  /** Current allocated capacity */
  capacity: number;
  /** Bytes consumed per entity (sum of field byte sizes) */
  bytesPerEntity: number;
  /** Per-entity field values */
  entities: {
    entityId: number;
    fields: Record<string, number | bigint>;
  }[];
}

/**
 * Serialised snapshot of one entity pool's stats.
 */
export interface DebugPoolSnapshot {
  /** Pool registration key */
  typeKey: string;
  /** Pool statistics */
  stats: PoolStats;
}

/**
 * Complete debug snapshot of the GameWorld state.
 *
 * Produced by `DebugDataProvider` on a configurable interval or on demand
 * via `getSnapshot()`. Designed to be consumed by the built-in DebugPanel
 * or any custom visualisation tool.
 */
export interface DebugSnapshot {
  /** Timestamp (ms) when this snapshot was collected */
  timestamp: number;

  /** World-level summary */
  world: {
    entityCount: number;
    soaStoreCount: number;
    paused: boolean;
  };

  /** Per-entity data for standard IComponent entities */
  entities: DebugEntitySnapshot[];

  /** SoA store snapshots */
  soaStores: DebugSoAStoreSnapshot[];

  /** Pool statistics */
  pools: DebugPoolSnapshot[];
}

/**
 * Configuration for DebugDataProvider.
 */
export interface DebugDataProviderConfig {
  /**
   * Interval in milliseconds between automatic snapshot pushes.
   * Set to 0 to disable automatic pushes (pull-only via getSnapshot()).
   * Default: 500
   */
  updateInterval?: number;
}
