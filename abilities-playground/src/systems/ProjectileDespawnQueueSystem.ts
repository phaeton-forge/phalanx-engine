import { GameSystem, type SystemContext } from 'phalanx-ecs';
import type { ProjectileEntity } from '../entities/Projectile';
import { GameEvents, type ProjectileDespawnRequestedEvent } from '../events/GameEvents';
import { despawnProjectile } from './projectileDespawn';

export class ProjectileDespawnQueueSystem extends GameSystem {
  private readonly pendingDespawnTickByProjectileId = new Map<number, number>();

  public override init(context: SystemContext): void {
    super.init(context);
    this.subscribe<ProjectileDespawnRequestedEvent>(
      GameEvents.PROJECTILE_DESPAWN_REQUESTED,
      ({ projectileId, dueTick }) => {
        this.queueDespawn(projectileId, dueTick);
      },
    );
  }

  queueDespawn(projectileId: number, dueTick: number): void {
    this.pendingDespawnTickByProjectileId.set(projectileId, dueTick);
  }

  public override processTick(tick: number): void {
    for (const [projectileId, dueTick] of this.pendingDespawnTickByProjectileId) {
      if (tick < dueTick) continue;

      const entity = this.entityManager.getEntity(projectileId) as ProjectileEntity | undefined;
      if (entity) {
        despawnProjectile(this.pools, entity);
      }
      this.pendingDespawnTickByProjectileId.delete(projectileId);
    }
  }
}
