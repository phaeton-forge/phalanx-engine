/**
 * Lifecycle contract for pooled entities. Components are attached once
 * (in the entity constructor) and live for the entity's whole lifetime.
 */
export interface IPoolableEntity<TSpawnArgs = void> {
  /**
   * Apply per-spawn values to components via their typed setters. Must not allocate.
   * Called by PoolManager.spawn() AFTER component onSpawn() hooks restored backing
   * storage (SoA rows exist and hold constructor defaults at this point) and right
   * before the entity is added to the EntityManager.
   */
  onSpawn(args: TSpawnArgs): void;

  /**
   * Game-level teardown (clear timers/targets/flags). Must NOT allocate.
   * Called by PoolManager.despawn() after removal from the EntityManager and
   * BEFORE component onDespawn() hooks run their mechanical cleanup.
   */
  onDespawn(): void;
}

/** Infers the typed spawn-args tuple from the entity class. */
export type SpawnArgsOf<T> =
  T extends IPoolableEntity<infer A> ? (A extends void ? [] : [args: A]) : never;
