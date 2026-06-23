import { GameSystem, type SystemContext } from '@phalanx-engine/ecs';
import { ComponentType } from '../components/ComponentType.ts';
import type { HealthComponent } from '../components/HealthComponent.ts';
import type { EntityTypeComponent } from '../components/EntityTypeComponent.ts';
import { GameEvents, type HealthDiedEvent, type PlayerDamagedEvent } from '../events/GameEvents.ts';

export class HealthSystem extends GameSystem {
  public override init(context: SystemContext): void {
    super.init(context);
  }

  public override processTick(_tick: number): void {
    const entities = this.entityManager.queryEntities(ComponentType.Health);

    for (const entity of entities) {
      const health = entity.getComponent<HealthComponent>(ComponentType.Health);
      if (!health || entity.isDestroyed) continue;

      // Apply pending heal
      if (health.pendingHeal > 0) {
        health.hp = Math.min(health.hp + health.pendingHeal, health.maxHp);
        health.pendingHeal = 0;
      }

      // Apply pending damage
      if (health.pendingDamage > 0) {
        health.hp -= health.pendingDamage;
        const entityType = entity.getComponent<EntityTypeComponent>(ComponentType.EntityType);

        if (entityType?.kind === 'player') {
          this.eventBus.emit<PlayerDamagedEvent>(GameEvents.COMBAT_PLAYER_DAMAGED, {
            damage: health.pendingDamage,
            currentHp: health.hp,
          });
        }

        health.pendingDamage = 0;

        if (health.hp <= 0) {
          health.hp = 0;
          this.eventBus.emit<HealthDiedEvent>(GameEvents.HEALTH_DIED, {
            entityId: entity.id,
          });
        }
      }
    }
  }
}
