import type { Entity } from '../Entity';
import type { IResettableComponent } from './IResettableComponent';

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

export interface ComponentTemplate {
  type: symbol;
  factory: () => IResettableComponent;
}

export interface EntityPoolConfig extends PoolConfig {
  componentTemplates?: ComponentTemplate[];
}

export interface EntityTypeConfig<T extends Entity = Entity> {
  factory: () => T;
  pool?: PoolConfig;
  components?: ComponentTemplate[];
}

export interface PoolingConfig {
  entityTypes: Record<string, EntityTypeConfig>;
  /** Automatically prewarm all pools on start(). Default: true */
  autoPrewarm?: boolean;
}
