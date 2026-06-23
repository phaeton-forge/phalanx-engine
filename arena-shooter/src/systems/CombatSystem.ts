import { GameSystem, type SystemContext } from '@phalanx-engine/ecs';
import { PhysicsEvents, type CollisionEvent } from '@phalanx-engine/physics';
import { ComponentType } from '../components/ComponentType.ts';
import type { EntityTypeComponent } from '../components/EntityTypeComponent.ts';
import type { HealthComponent } from '../components/HealthComponent.ts';
import type { PickupComponent } from '../components/PickupComponent.ts';
import { ENEMY_CONTACT_DAMAGE, ENEMY_DROP_CHANCE } from '../config/constants.ts';
import { GameEvents, type EnemyKilledEvent } from '../events/GameEvents.ts';
import { GameRandom } from '../core/GameRandom.ts';
import type { EntityFactory } from '../core/EntityFactory.ts';
import type { TransformComponent } from '../components/TransformComponent.ts';
import { FP } from '@phalanx-engine/math';

export class CombatSystem extends GameSystem {
  private entityFactory: EntityFactory;
  private collisionQueue: CollisionEvent[] = [];

  constructor(entityFactory: EntityFactory) {
    super();
    this.entityFactory = entityFactory;
  }

  public override init(context: SystemContext): void {
    super.init(context);

    this.subscribe<CollisionEvent>(PhysicsEvents.COLLISION, (event) => {
      this.collisionQueue.push(event);
    });
  }

  public override processTick(_tick: number): void {
    for (const collision of this.collisionQueue) {
      this.handleCollision(collision);
    }
    this.collisionQueue.length = 0;
  }

  private handleCollision(collision: CollisionEvent): void {
    const entityA = this.entityManager.getEntity(collision.entityA);
    const entityB = this.entityManager.getEntity(collision.entityB);
    if (!entityA || !entityB) return;
    if (entityA.isDestroyed || entityB.isDestroyed) return;

    const typeA = entityA.getComponent<EntityTypeComponent>(ComponentType.EntityType);
    const typeB = entityB.getComponent<EntityTypeComponent>(ComponentType.EntityType);
    if (!typeA || !typeB) return;

    // Determine collision type
    const pair = [typeA.kind, typeB.kind].sort().join('+');

    if (pair === 'enemy+projectile') {
      const enemy = typeA.kind === 'enemy' ? entityA : entityB;
      const projectile = typeA.kind === 'projectile' ? entityA : entityB;
      this.handleProjectileHitsEnemy(enemy.id, projectile.id);
    } else if (pair === 'enemy+player') {
      const enemy = typeA.kind === 'enemy' ? entityA : entityB;
      const player = typeA.kind === 'player' ? entityA : entityB;
      this.handleEnemyHitsPlayer(enemy.id, player.id);
    } else if (pair === 'pickup+player') {
      const pickup = typeA.kind === 'pickup' ? entityA : entityB;
      const player = typeA.kind === 'player' ? entityA : entityB;
      this.handlePlayerPicksUp(pickup.id, player.id);
    }
  }

  private handleProjectileHitsEnemy(enemyId: number, projectileId: number): void {
    const enemy = this.entityManager.getEntity(enemyId);
    const projectile = this.entityManager.getEntity(projectileId);
    if (!enemy || !projectile || enemy.isDestroyed || projectile.isDestroyed) return;

    // Get enemy position before destroying
    const transform = enemy.getComponent<TransformComponent>(ComponentType.Transform);
    const posX = transform ? FP.ToFloat(transform.fpPosition.x) : 0;
    const posZ = transform ? FP.ToFloat(transform.fpPosition.z) : 0;

    // Destroy both
    enemy.destroy();
    projectile.destroy();

    this.eventBus.emit<EnemyKilledEvent>(GameEvents.COMBAT_ENEMY_KILLED, {
      enemyId,
      positionX: posX,
      positionZ: posZ,
    });

    // Drop chance
    if (GameRandom.boolean(ENEMY_DROP_CHANCE)) {
      this.entityFactory.createPickup(FP.FromFloat(posX), FP.FromFloat(posZ));
    }
  }

  private handleEnemyHitsPlayer(enemyId: number, playerId: number): void {
    const enemy = this.entityManager.getEntity(enemyId);
    const player = this.entityManager.getEntity(playerId);
    if (!enemy || !player || enemy.isDestroyed || player.isDestroyed) return;

    // Get enemy position before destroying
    const transform = enemy.getComponent<TransformComponent>(ComponentType.Transform);
    const posX = transform ? FP.ToFloat(transform.fpPosition.x) : 0;
    const posZ = transform ? FP.ToFloat(transform.fpPosition.z) : 0;

    // Deal damage to player
    const health = player.getComponent<HealthComponent>(ComponentType.Health);
    if (health) {
      health.pendingDamage += ENEMY_CONTACT_DAMAGE;
    }

    // Destroy enemy
    enemy.destroy();

    this.eventBus.emit<EnemyKilledEvent>(GameEvents.COMBAT_ENEMY_KILLED, {
      enemyId,
      positionX: posX,
      positionZ: posZ,
    });

    // Drop chance on contact death too
    if (GameRandom.boolean(ENEMY_DROP_CHANCE)) {
      this.entityFactory.createPickup(FP.FromFloat(posX), FP.FromFloat(posZ));
    }
  }

  private handlePlayerPicksUp(pickupId: number, playerId: number): void {
    const pickup = this.entityManager.getEntity(pickupId);
    const player = this.entityManager.getEntity(playerId);
    if (!pickup || !player || pickup.isDestroyed || player.isDestroyed) return;

    const pickupComp = pickup.getComponent<PickupComponent>(ComponentType.Pickup);
    const health = player.getComponent<HealthComponent>(ComponentType.Health);
    if (!pickupComp || !health) return;

    health.pendingHeal += pickupComp.healAmount;

    pickup.destroy();
  }
}
