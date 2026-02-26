import type { EntityManager } from 'phalanx-ecs';
import type { EntityFactory } from './EntityFactory';

/**
 * EntityCleanupService - Handles cleanup of destroyed entities
 *
 * Responsible for:
 * - Removing destroyed entities from all systems
 * - Cleaning up ownership tracking
 * - Disposing entity resources
 *
 * Note: HealthBarSystem and InterpolationSystem cleanup is automatic -
 * they query entities with their respective components and the components
 * are disposed when entities are removed.
 */
export class EntityCleanupService {
  private entityManager: EntityManager;
  private entityFactory: EntityFactory;

  constructor(
    entityManager: EntityManager,
    entityFactory: EntityFactory
  ) {
    this.entityManager = entityManager;
    this.entityFactory = entityFactory;
  }

  /**
   * Remove destroyed entities from all systems
   */
  public cleanupDestroyedEntities(): void {
    const destroyed = this.entityManager.cleanupDestroyed();

    for (const entity of destroyed) {
      this.entityFactory.removeOwnership(entity.id);
      // InterpolationComponent and HealthBarComponent cleanup is automatic -
      // they are removed with the entity when disposed

      entity.dispose();
    }
  }
}
