import type { EntityManager, GameWorld } from 'phalanx-ecs';
import type { ProjectileEntity } from '../entities/Projectile.ts';

export function despawnProjectile(
  world: GameWorld,
  entityManager: EntityManager,
  projectile: ProjectileEntity,
): void {
  entityManager.removeEntity(projectile);
  world.pools?.release('projectile', projectile);
}
