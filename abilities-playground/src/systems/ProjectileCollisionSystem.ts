import { GameSystem, type GameWorld, type SystemContext } from 'phalanx-ecs';
import { PhysicsEvents, type CollisionEvent } from 'phalanx-physics';
import {
  ComponentType,
  StatsComponent,
  TeamComponent,
} from '../components';
import type { ProjectileEntity } from '../entities/Projectile.ts';
import { despawnProjectile } from './projectileDespawn';

export class ProjectileCollisionSystem extends GameSystem {
  private readonly collisionQueue: CollisionEvent[] = [];
  private readonly world: GameWorld;

  constructor(world: GameWorld) {
    super();
    this.world = world;
  }

  public override init(context: SystemContext): void {
    super.init(context);
    this.subscribe<CollisionEvent>(PhysicsEvents.COLLISION, (event) => {
      this.collisionQueue.push(event);
    });
  }

  public override processTick(): void {
    for (const collision of this.collisionQueue) {
      this.handleCollision(collision);
    }
    this.collisionQueue.length = 0;
  }

  private handleCollision(collision: CollisionEvent): void {
    const entityA = this.entityManager.getEntity(collision.entityA);
    const entityB = this.entityManager.getEntity(collision.entityB);

    if (!entityA || !entityB) return;

    const aProjectile = entityA.hasComponent(ComponentType.Projectile);
    const bProjectile = entityB.hasComponent(ComponentType.Projectile);

    if (aProjectile === bProjectile) return;

    const projectile = (
      aProjectile ? entityA : entityB
    ) as ProjectileEntity;
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

    despawnProjectile(this.world, this.entityManager, projectile);
  }
}
