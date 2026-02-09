import type { EntityManager } from './EntityManager';
import type { EntityFactory } from './EntityFactory';
import type { PhysicsSystem } from '../systems/PhysicsSystem';
import type { InterpolationSystem } from '../systems/InterpolationSystem';
import type { HealthBarSystem } from '../systems/HealthBarSystem';
import type { SelectionSystem, ISelectableEntity } from '../systems/SelectionSystem';

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
  private selectionSystem: SelectionSystem;

  constructor(
    entityManager: EntityManager,
    entityFactory: EntityFactory,
    physicsSystem: PhysicsSystem,
    interpolationSystem: InterpolationSystem,
    healthBarSystem: HealthBarSystem,
    selectionSystem: SelectionSystem
  ) {
    this.entityManager = entityManager;
    this.entityFactory = entityFactory;
    this.physicsSystem = physicsSystem;
    this.interpolationSystem = interpolationSystem;
    this.healthBarSystem = healthBarSystem;
    this.selectionSystem = selectionSystem;
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

      if (
        'canBeSelected' in entity &&
        typeof entity.canBeSelected === 'function'
      ) {
        this.selectionSystem.unregisterSelectable(
          entity as unknown as ISelectableEntity
        );
      }

      entity.dispose();
    }

    this.selectionSystem.cleanup();
  }
}

