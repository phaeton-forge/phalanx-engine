import type { EntityManager, PoolManager } from '@phalanx-engine/ecs';
import type { EntityFactory } from './EntityFactory';

/**
 * EntityCleanupService - Handles cleanup of destroyed entities
 *
 * Responsible for:
 * - Removing destroyed entities from all systems
 * - Cleaning up ownership tracking
 * - Releasing pooled entities back to pool or disposing non-pooled ones
 *
 * Note: HealthBarSystem and InterpolationSystem cleanup is automatic -
 * they query entities with their respective components and the components
 * are disposed when entities are removed.
 */
export class EntityCleanupService {
  private entityManager: EntityManager;
  private entityFactory: EntityFactory;
  private pools: PoolManager | null;

  constructor(
    entityManager: EntityManager,
    entityFactory: EntityFactory,
    pools: PoolManager | null = null
  ) {
    this.entityManager = entityManager;
    this.entityFactory = entityFactory;
    this.pools = pools;
  }

  /**
   * Remove destroyed entities from all systems.
   * Pooled entities (with _poolTypeKey) are released back to the pool.
   * Non-pooled entities are disposed normally.
   */
  public cleanupDestroyedEntities(): void {
    const destroyed = this.entityManager.cleanupDestroyed();

    for (const entity of destroyed) {
      this.entityFactory.removeOwnership(entity.id);

      if (entity._poolTypeKey && this.pools) {
        this.pools.release(entity._poolTypeKey, entity);
      } else {
        entity.dispose();
      }
    }
  }
}
