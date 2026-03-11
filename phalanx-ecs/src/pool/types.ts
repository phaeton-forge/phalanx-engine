/**
 * Configuration for an ObjectPool.
 */
export interface PoolConfig {
  /** Initial number of pre-allocated objects. Default: 0 */
  initialSize?: number;
  /** Maximum pool size. 0 = unlimited. Default: 0 */
  maxSize?: number;
  /** Growth strategy when pool is empty: 'create' (single) | 'grow' (batch). Default: 'create' */
  growthStrategy?: 'create' | 'grow';
  /** Batch size when growthStrategy = 'grow'. Default: 8 */
  growthBatchSize?: number;
}

/**
 * Runtime statistics for a pool.
 */
export interface PoolStats {
  /** Objects currently available in the pool */
  available: number;
  /** Total objects ever created by this pool */
  totalCreated: number;
  /** Number of acquire() calls */
  acquireCount: number;
  /** Number of release() calls */
  releaseCount: number;
  /** Number of times acquire() found the pool empty */
  missCount: number;
}

/**
 * Resolved pool config with all defaults applied.
 */
export interface ResolvedPoolConfig {
  initialSize: number;
  maxSize: number;
  growthStrategy: 'create' | 'grow';
  growthBatchSize: number;
}

/**
 * Apply defaults to a partial PoolConfig.
 */
export function resolvePoolConfig(config?: PoolConfig): ResolvedPoolConfig {
  return {
    initialSize: config?.initialSize ?? 0,
    maxSize: config?.maxSize ?? 0,
    growthStrategy: config?.growthStrategy ?? 'create',
    growthBatchSize: config?.growthBatchSize ?? 8,
  };
}
