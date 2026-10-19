import {
  calculateSchemaByteSize,
  type EntityManager,
  type PoolManager,
  type SoASchema,
} from '@phalanx-engine/ecs';
import { wallClock } from '../wallClock.js';
import type {
  DebugSnapshot,
  DebugEntitySnapshot,
  DebugComponentSnapshot,
  DebugSoAStoreSnapshot,
  DebugPoolSnapshot,
  DebugDataProviderConfig,
} from './types.js';

/** Default push interval in milliseconds */
const DEFAULT_UPDATE_INTERVAL = 500;

type SnapshotCallback = (snapshot: DebugSnapshot) => void;

/** Schema-erased SoA store used by the debug snapshot collector. */
interface DebugSoAStore {
  readonly schema: SoASchema;
  readonly count: number;
  readonly capacity: number;
  entityIds(): readonly number[];
  get(entityId: number): Record<string, number | bigint> | undefined;
}

/**
 * DebugDataProvider — centralised observable that collects ECS debug snapshots.
 *
 * Owns the single update interval. Subscribers receive `DebugSnapshot` objects
 * on each interval tick. Also exposes `getSnapshot()` for on-demand pull
 * without subscribing to the timer.
 *
 * Usage:
 * ```ts
 * const provider = new DebugDataProvider(entityManager, poolManager);
 * provider.start();
 *
 * // Observable pattern
 * const unsub = provider.subscribe((snap) => console.log(snap.world.entityCount));
 *
 * // On-demand pull
 * const snap = provider.getSnapshot();
 *
 * // Cleanup
 * unsub();
 * provider.dispose();
 * ```
 */
export class DebugDataProvider {
  private readonly entityManager: EntityManager;
  private readonly pools: PoolManager | null;
  private readonly updateInterval: number;

  private subscribers: Set<SnapshotCallback> = new Set();
  private intervalId: unknown = null;
  private _paused: boolean = false;

  /** Externally settable — GameWorld updates this so the snapshot reflects pause state */
  public set paused(value: boolean) {
    this._paused = value;
  }

  constructor(
    entityManager: EntityManager,
    pools: PoolManager | null,
    config?: DebugDataProviderConfig
  ) {
    this.entityManager = entityManager;
    this.pools = pools;
    this.updateInterval = config?.updateInterval ?? DEFAULT_UPDATE_INTERVAL;
  }

  // ── Observable API ──────────────────────────────────────────────────

  /**
   * Subscribe to periodic snapshot updates.
   * @returns Unsubscribe function.
   */
  public subscribe(callback: SnapshotCallback): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  // ── Pull API ────────────────────────────────────────────────────────

  /**
   * Collect and return a snapshot immediately (no timer dependency).
   */
  public getSnapshot(): DebugSnapshot {
    return this.collectSnapshot();
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  /**
   * Start the automatic push interval.
   * If updateInterval is 0, no interval is created (pull-only mode).
   */
  public start(): void {
    if (this.intervalId !== null) return; // already running
    if (this.updateInterval <= 0) return; // pull-only mode

    const clock = wallClock();
    this.intervalId = clock.setInterval(() => {
      this.push();
    }, this.updateInterval);
  }

  /**
   * Stop the automatic push interval. Subscribers remain registered.
   */
  public stop(): void {
    if (this.intervalId !== null) {
      wallClock().clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Stop the interval and remove all subscribers.
   */
  public dispose(): void {
    this.stop();
    this.subscribers.clear();
  }

  // ── Internals ───────────────────────────────────────────────────────

  private push(): void {
    if (this.subscribers.size === 0) return;
    const snapshot = this.collectSnapshot();
    for (const cb of this.subscribers) {
      cb(snapshot);
    }
  }

  private collectSnapshot(): DebugSnapshot {
    const soaStores = this.collectSoAStores();
    return {
      timestamp: Date.now(),
      world: {
        entityCount: this.entityManager.count,
        soaStoreCount: soaStores.length,
        paused: this._paused,
      },
      entities: this.collectEntities(),
      soaStores,
      pools: this.collectPools(),
    };
  }

  private collectEntities(): DebugEntitySnapshot[] {
    const entities = this.entityManager.getAllEntities();
    const result: DebugEntitySnapshot[] = [];

    for (const entity of entities) {
      const components: DebugComponentSnapshot[] = [];

      for (const [typeSymbol, component] of entity.getComponents()) {
        components.push({
          typeName: typeSymbol.description ?? 'unknown',
          typeSymbol,
          data: copyOwnData(component),
        });
      }

      result.push({
        id: entity.id,
        destroyed: entity.isDestroyed,
        components,
      });
    }

    return result;
  }

  private collectSoAStores(): DebugSoAStoreSnapshot[] {
    const stores = this.entityManager.getAllSoAStores();
    const result: DebugSoAStoreSnapshot[] = [];

    for (const raw of stores.values()) {
      if (!isDebugSoAStore(raw)) {
        throw new Error('DebugDataProvider: unexpected SoA store shape');
      }
      const store = raw;
      const schema = store.schema;

      const entities: DebugSoAStoreSnapshot['entities'] = [];
      for (const entityId of store.entityIds()) {
        const fields = store.get(entityId);
        if (fields) {
          entities.push({
            entityId,
            fields,
          });
        }
      }

      result.push({
        name: schema.type.description ?? 'unknown',
        fieldNames: [...schema.fieldNames],
        fieldTypes: { ...schema.fieldTypes },
        count: store.count,
        capacity: store.capacity,
        bytesPerEntity: calculateSchemaByteSize(schema),
        entities,
      });
    }

    return result;
  }

  private collectPools(): DebugPoolSnapshot[] {
    if (!this.pools) return [];

    const result: DebugPoolSnapshot[] = [];
    const stats = this.pools.getStats();

    for (const [typeKey, poolStats] of stats) {
      result.push({ typeKey, stats: { ...poolStats } });
    }

    return result;
  }
}

function copyOwnData(component: object): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(component)) {
    if (key === 'type') continue;
    data[key] = Reflect.get(component, key);
  }
  return data;
}

function isDebugSoAStore(value: object): value is DebugSoAStore {
  if (
    !('schema' in value) ||
    !('count' in value) ||
    !('capacity' in value) ||
    !('entityIds' in value) ||
    !('get' in value)
  ) {
    return false;
  }
  const schema: unknown = value.schema;
  const count: unknown = value.count;
  const capacity: unknown = value.capacity;
  const entityIds: unknown = value.entityIds;
  const get: unknown = value.get;
  return (
    isSoASchema(schema) &&
    typeof count === 'number' &&
    typeof capacity === 'number' &&
    typeof entityIds === 'function' &&
    typeof get === 'function'
  );
}

function isSoASchema(value: unknown): value is SoASchema {
  if (typeof value !== 'object' || value === null) return false;
  if (
    !('type' in value) ||
    !('fieldNames' in value) ||
    !('fieldTypes' in value)
  ) {
    return false;
  }
  const type: unknown = value.type;
  const fieldNames: unknown = value.fieldNames;
  const fieldTypes: unknown = value.fieldTypes;
  return (
    typeof type === 'symbol' &&
    Array.isArray(fieldNames) &&
    typeof fieldTypes === 'object' &&
    fieldTypes !== null
  );
}
