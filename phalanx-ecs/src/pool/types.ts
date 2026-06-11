import type { Entity } from '../Entity';
import type { IPoolableEntity } from './IPoolableEntity';

export interface PoolConfig {
  /** Initial number of pre-allocated objects. Default: 0 */
  initialSize?: number;
  /** Maximum pool size. 0 = unlimited. Default: 0 */
  maxSize?: number;
  /** Growth strategy when pool is empty: 'create' (single) or 'grow' (batch). Default: 'create' */
  growthStrategy?: 'create' | 'grow';
  /** Number of objects to create in batch when growthStrategy = 'grow'. Default: 8 */
  growthBatchSize?: number;
}

export interface PoolStats {
  available: number;
  totalCreated: number;
  acquireCount: number;
  releaseCount: number;
  missCount: number;
}

export interface EntityTypeConfig<T extends Entity & IPoolableEntity<any> = Entity & IPoolableEntity<any>> {
  factory: () => T;
  pool?: PoolConfig;
}

export interface PoolingConfig {
  entityTypes: Record<string, EntityTypeConfig>;
  /** Automatically prewarm all pools on start(). Default: true */
  autoPrewarm?: boolean;
}

export interface ResolvedPoolConfig {
  initialSize: number;
  maxSize: number;
  growthStrategy: 'create' | 'grow';
  growthBatchSize: number;
}

export function resolvePoolConfig(config?: PoolConfig): ResolvedPoolConfig {
  return {
    initialSize: config?.initialSize ?? 0,
    maxSize: config?.maxSize ?? 0,
    growthStrategy: config?.growthStrategy ?? 'create',
    growthBatchSize: config?.growthBatchSize ?? 8,
  };
}
