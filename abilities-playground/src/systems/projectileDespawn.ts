import type { EntityManager, GameWorld } from 'phalanx-ecs';
import { PhysicsSoASchema } from 'phalanx-physics';
import { ComponentType, MeshComponent, TransformSoASchema } from '../components';
import type { ProjectileEntity } from '../entities/Projectile.ts';

export function despawnProjectile(
  world: GameWorld,
  entityManager: EntityManager,
  projectile: ProjectileEntity,
): void {
  entityManager.removeEntity(projectile);
  world.pools?.release('projectile', projectile);
}

export function softDeactivateProjectile(
  entityManager: EntityManager,
  projectile: ProjectileEntity,
): void {
  projectile.active = false;

  const mesh = projectile.getComponent<MeshComponent>(ComponentType.Mesh);
  if (mesh) mesh.root.visible = false;

  const transformStore = entityManager.getOrCreateSoAStore(TransformSoASchema);
  const tIdx = transformStore.indexOf(projectile.id);
  if (tIdx !== -1) {
    // Park it far away so it won't be seen if something toggles visibility.
    transformStore.arrays.visualPositionX[tIdx] = 1e9;
    transformStore.arrays.visualPositionY[tIdx] = 1e9;
    transformStore.arrays.visualPositionZ[tIdx] = 1e9;
  }

  const physStore = entityManager.getOrCreateSoAStore(PhysicsSoASchema);
  const pIdx = physStore.indexOf(projectile.id);
  if (pIdx !== -1) {
    physStore.arrays.ignorePhysics[pIdx] = 1;
    physStore.arrays.velocityX[pIdx] = 0n;
    physStore.arrays.velocityY[pIdx] = 0n;
    physStore.arrays.velocityZ[pIdx] = 0n;
  }
}
