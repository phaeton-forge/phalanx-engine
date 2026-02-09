import type { EntityManager } from './EntityManager';
import type { EntityFactory } from './EntityFactory';
import type { InterpolationSystem } from '../systems/InterpolationSystem';

/**
 * EntityCleanupService - Handles cleanup of destroyed entities
 *
 * Responsible for:
 * - Removing destroyed entities from all systems
 * - Cleaning up ownership tracking
 * - Disposing entity resources
 *
 * Note: HealthBarSystem cleanup is automatic - it queries entities with
 * HealthBarComponent and removes UI when entities are no longer found.
 */
export class EntityCleanupService {
  private entityManager: EntityManager;
  private entityFactory: EntityFactory;
  private interpolationSystem: InterpolationSystem;

  constructor(
    entityManager: EntityManager,
    entityFactory: EntityFactory,
    interpolationSystem: InterpolationSystem
  ) {
    this.entityManager = entityManager;
    this.entityFactory = entityFactory;
    this.interpolationSystem = interpolationSystem;
  }

  /**
   * Remove destroyed entities from all systems
   */
  public cleanupDestroyedEntities(): void {
    const destroyed = this.entityManager.cleanupDestroyed();

    for (const entity of destroyed) {
      this.entityFactory.removeOwnership(entity.id);
      this.interpolationSystem.unregisterEntity(entity.id);
      // HealthBarComponent cleanup is automatic - HealthBarSystem's update()
      // removes UI for entities that no longer exist

      entity.dispose();
    }
  }
}
