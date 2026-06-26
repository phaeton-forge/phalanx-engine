import { GameSystem, type SystemContext } from '@phalanx-engine/ecs';
import { PhysicsEvents, type CollisionEvent } from '@phalanx-engine/physics';
import {
  ComponentType,
  StatsComponent,
  TeamComponent,
} from '../components';
import { ProjectileComponent } from '../components/ProjectileComponent';
import { PROJECTILE_DESPAWN_DELAY_TICKS } from '../config/constants';
import type { ProjectileEntity } from '../entities/Projectile.ts';
import type { MissileEntity } from '../entities/Missile';
import { GameEvents, type ProjectileDespawnRequestedEvent } from '../events/GameEvents';
import { softDeactivateProjectile } from './projectileDespawn';

export class ProjectileCollisionSystem extends GameSystem {
  private readonly collisionQueue: CollisionEvent[] = [];

  public override init(context: SystemContext): void {
    super.init(context);
    this.subscribe<CollisionEvent>(PhysicsEvents.COLLISION, (event) => {
      this.collisionQueue.push(event);
    });
  }

  public override processTick(tick: number): void {
    for (const collision of this.collisionQueue) {
      this.handleCollision(collision, tick);
    }
    this.collisionQueue.length = 0;
  }

  private handleCollision(collision: CollisionEvent, tick: number): void {
    const entityA = this.entityManager.getEntity(collision.entityA);
    const entityB = this.entityManager.getEntity(collision.entityB);

    if (!entityA || !entityB) return;

    const aProjectile = entityA.hasComponent(ComponentType.Projectile);
    const bProjectile = entityB.hasComponent(ComponentType.Projectile);

    if (aProjectile === bProjectile) return;

    const projectile = (
      aProjectile ? entityA : entityB
    ) as ProjectileEntity | MissileEntity;
    const other = aProjectile ? entityB : entityA;

    if (!projectile.active) return;

    const otherStats = other.getComponent<StatsComponent>(ComponentType.UnitStats);

    if (!otherStats?.alive) return;

    const projectileTeam = projectile.getComponent<TeamComponent>(ComponentType.Team);
    const otherTeam = other.getComponent<TeamComponent>(ComponentType.Team);

    if (
      projectileTeam &&
      otherTeam &&
      projectileTeam.teamId === otherTeam.teamId
    ) {
      return;
    }

    const projectileComp = projectile.getComponent<ProjectileComponent>(ComponentType.Projectile);
    const effectId = projectileComp?.damageEffectId ?? 'Effect.Damage.Sphere';
    this.abilities?.applyEffect(other.id, effectId, projectile.id);

    // Keep projectile entity around briefly so cue handlers can still read its transform.
    // (Cue event only carries ids; removing immediately makes impact point computation null.)
    softDeactivateProjectile(this.entityManager, projectile);
    this.eventBus.emit<ProjectileDespawnRequestedEvent>(
      GameEvents.PROJECTILE_DESPAWN_REQUESTED,
      { projectileId: projectile.id, dueTick: tick + PROJECTILE_DESPAWN_DELAY_TICKS },
    );
  }
}
