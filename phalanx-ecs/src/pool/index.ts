// Pool interfaces
export type { IPoolable } from './IPoolable';
export type { IResettableComponent } from './IResettableComponent';

// Pool types & config
export type { PoolConfig, PoolStats, ResolvedPoolConfig } from './types';
export { resolvePoolConfig } from './types';

// Pool implementations
export { ObjectPool } from './ObjectPool';
export { EntityPool } from './EntityPool';
export type { ComponentTemplate, EntityPoolConfig } from './EntityPool';
export { PoolManager } from './PoolManager';
export type { EntityTypeConfig } from './PoolManager';
export { ComponentPoolRegistry } from './ComponentPoolRegistry';
