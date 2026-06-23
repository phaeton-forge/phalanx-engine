import { Vector3 } from '@babylonjs/core';
import type { SystemContext } from '@phalanx-engine/ecs';
import { GameSystem } from '@phalanx-engine/ecs';
import {
  ComponentType,
  HealthComponent,
  AnimationComponent,
  MovementComponent,
  DeathComponent,
  PhysicsBodyComponent,
  TransformComponent,
} from '../components';
import type { Unit } from '../entities/Unit';
import { GameEvents, createEvent } from '../events';
import type {
  DamageRequestedEvent,
  DamageAppliedEvent,
  HealRequestedEvent,
  EntityDyingEvent,
  EntityDestroyedEvent,
  ShowBloodEffectEvent,
  PlayDeathAnimationEvent,
} from '../events';

/**
 * HealthSystem - Manages entity health and destruction
 * Follows Single Responsibility: Only handles health-related logic
 * Uses EventBus for decoupled communication
 *
 * DETERMINISM: Death timing is controlled via DeathComponent tick counters,
 * NOT animation callbacks. This ensures all clients destroy entities at
 * exactly the same simulation tick.
 */
export class HealthSystem extends GameSystem {
  private currentTick: number = 0;

  constructor() {
    super();
  }

  /**
   * Initialize the system with context
   */
  public override init(context: SystemContext): void {
    super.init(context);
    this.setupEventListeners();
  }


  /**
   * Update the current tick (call this from LockstepManager before processing)
   * @param tick Current simulation tick
   */
  public setCurrentTick(tick: number): void {
    this.currentTick = tick;
  }

  /**
   * Process death timers for all dying entities
   * Call this once per simulation tick for deterministic death timing
   * @param _tick Current simulation tick
   */
  public override processTick(_tick: number): void {
    this.currentTick = _tick;

    // Query all entities with DeathComponent
    const dyingEntities = this.entityManager.queryEntities(ComponentType.Death);

    for (const entity of dyingEntities) {
      const deathComp = entity.getComponent<DeathComponent>(ComponentType.Death);
      if (!deathComp || !deathComp.isDying) continue;

      // Check if death timer has expired
      if (deathComp.shouldCompleteThisTick(_tick)) {
        const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);

        // Emit entity destroyed event before destroying
        this.eventBus.emit<EntityDestroyedEvent>(GameEvents.ENTITY_DESTROYED, {
          ...createEvent(),
          entityId: entity.id,
          position: transform?.visualPosition.clone() ?? new Vector3(),
        });

        // Complete the death (invokes callback and destroys entity)
        deathComp.completeDeath();
        entity.destroy();
      }
    }
  }

  private setupEventListeners(): void {
    // Listen for damage requests from other systems
    this.subscribe<DamageRequestedEvent>(
      GameEvents.DAMAGE_REQUESTED,
      (event) => {
        this.applyDamageById(event.entityId, event.amount, event.sourceId);
      }
    );

    // Listen for heal requests
    this.subscribe<HealRequestedEvent>(
      GameEvents.HEAL_REQUESTED,
      (event) => {
        const entity = this.entityManager.getEntity(event.entityId) as Unit | undefined;
        if (entity) {
          this.heal(entity, event.amount);
        }
      }
    );
  }

  /**
   * Apply damage to an entity
   * @returns true if entity was destroyed by this damage
   */
  public applyDamage(
    entity: Unit,
    amount: number,
    sourceId?: number
  ): boolean {
    const health = entity.getComponent<HealthComponent>(ComponentType.Health);
    if (!health) return false;

    const wasDestroyed = health.takeDamage(amount);

    // Show blood effect via event (AnimationSystem will handle this)
    const animComp = entity.getComponent<AnimationComponent>(
      ComponentType.Animation
    );
    if (animComp) {
      this.eventBus.emit<ShowBloodEffectEvent>(GameEvents.SHOW_BLOOD_EFFECT, {
        ...createEvent(),
        entityId: entity.id,
      });
    }

    // Emit damage applied event
    this.eventBus.emit<DamageAppliedEvent>(GameEvents.DAMAGE_APPLIED, {
      ...createEvent(),
      entityId: entity.id,
      amount,
      newHealth: health.health,
      maxHealth: health.maxHealth,
      sourceId,
    });

    if (wasDestroyed) {
      // Handle death differently for entities with DeathComponent (units with animations)
      const deathComp = entity.getComponent<DeathComponent>(ComponentType.Death);

      if (deathComp) {
        // Stop any ongoing movement immediately
        const movement = entity.getComponent<MovementComponent>(
          ComponentType.Movement
        );
        if (movement) {
          movement.stop();
        }

        // Mark entity to be ignored by physics (dying units shouldn't move or collide)
        const body = entity.getComponent<PhysicsBodyComponent>(ComponentType.PhysicsBody);
        if (body) {
          body.ignorePhysics = true;
        }

        // Emit entity dying event immediately (for health bar removal, etc.)
        this.eventBus.emit<EntityDyingEvent>(GameEvents.ENTITY_DYING, {
          ...createEvent(),
          entityId: entity.id,
        });

        // Start deterministic death timer (tick-based, NOT animation-based)
        // The entity will be destroyed in processTick() when timer expires
        deathComp.startDeath(this.currentTick, () => {
          // This callback is called from processTick when timer expires
          // The actual destroy happens there for determinism
        });

        // Start visual death animation via event (purely cosmetic, does NOT control timing)
        if (animComp) {
          this.eventBus.emit<PlayDeathAnimationEvent>(GameEvents.PLAY_DEATH_ANIMATION, {
            ...createEvent(),
            entityId: entity.id,
          });
        }
      } else {
        // For other entities (no DeathComponent), destroy immediately
        // Emit entity destroyed event before destroying
        const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
        this.eventBus.emit<EntityDestroyedEvent>(GameEvents.ENTITY_DESTROYED, {
          ...createEvent(),
          entityId: entity.id,
          position: transform?.visualPosition.clone() ?? new Vector3(),
        });

        entity.destroy();
      }
    }

    return wasDestroyed;
  }

  /**
   * Apply damage to an entity by ID
   * @returns true if entity was destroyed by this damage
   */
  public applyDamageById(
    entityId: number,
    amount: number,
    sourceId?: number
  ): boolean {
    const entity = this.entityManager.getEntity(entityId) as Unit | undefined;
    if (!entity) return false;

    return this.applyDamage(entity, amount, sourceId);
  }

  /**
   * Heal an entity
   */
  public heal(entity: Unit, amount: number): void {
    const health = entity.getComponent<HealthComponent>(ComponentType.Health);
    health?.heal(amount);
  }

  /**
   * Get current health of an entity
   */
  public getHealth(entity: Unit): number | undefined {
    const health = entity.getComponent<HealthComponent>(ComponentType.Health);
    return health?.health;
  }

  /**
   * Get health percentage of an entity (0-1)
   */
  public getHealthPercent(entity: Unit): number | undefined {
    const health = entity.getComponent<HealthComponent>(ComponentType.Health);
    return health?.healthPercent;
  }

  /**
   * Dispose and unsubscribe from all events
   */
  public override dispose(): void {
    super.dispose(); // Clean up subscriptions from base class
  }
}
