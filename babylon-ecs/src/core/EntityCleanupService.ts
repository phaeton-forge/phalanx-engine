import type { EntityManager } from './EntityManager';
import type { EntityFactory } from './EntityFactory';
import type { PhysicsSystem } from '../systems/PhysicsSystem';
import type { InterpolationSystem } from '../systems/InterpolationSystem';
import type { HealthBarSystem } from '../systems/HealthBarSystem';

/**
 * EntityCleanupService - Handles cleanup of destroyed entities
 *
 * Responsible for:
 * - Removing destroyed entities from all systems
 * - Cleaning up ownership tracking
 * - Disposing entity resources
 */
export class EntityCleanupService {
  private entityManager: EntityManager;
  private entityFactory: EntityFactory;
  private physicsSystem: PhysicsSystem;
  private interpolationSystem: InterpolationSystem;
  private healthBarSystem: HealthBarSystem;

  constructor(
    entityManager: EntityManager,
    entityFactory: EntityFactory,
    physicsSystem: PhysicsSystem,
    interpolationSystem: InterpolationSystem,
    healthBarSystem: HealthBarSystem
  ) {
    this.entityManager = entityManager;
    this.entityFactory = entityFactory;
    this.physicsSystem = physicsSystem;
    this.interpolationSystem = interpolationSystem;
    this.healthBarSystem = healthBarSystem;
  }

  /**
   * Update health bar system reference (for late initialization)
   */
  public setHealthBarSystem(healthBarSystem: HealthBarSystem): void {
    this.healthBarSystem = healthBarSystem;
  }

  /**
   * Remove destroyed entities from all systems
   */
  public cleanupDestroyedEntities(): void {
    const destroyed = this.entityManager.cleanupDestroyed();

    for (const entity of destroyed) {
      this.entityFactory.removeOwnership(entity.id);
      this.physicsSystem.unregisterBody(entity.id);
      this.interpolationSystem.unregisterEntity(entity.id);
      this.healthBarSystem.unregisterEntity(entity.id);

      entity.dispose();
    }
  }
}

