import type { EntityManager, PoolManager } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import { PhysicsSoASchema, TransformSoASchema } from 'phalanx-physics';
import { ComponentType, MeshComponent } from '../components';
import type { ProjectileEntity } from '../entities/Projectile.ts';

const PARKED_POSITION = FP.FromFloat(1e9);

export function despawnProjectile(
  pools: PoolManager | null,
  entityManager: EntityManager,
  projectile: ProjectileEntity,
): void {
  entityManager.removeEntity(projectile);
  pools?.release('projectile', projectile);
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
    const parked = FP.ToRaw(PARKED_POSITION);
    transformStore.arrays.fpPositionX[tIdx] = parked;
    transformStore.arrays.fpPositionY[tIdx] = parked;
    transformStore.arrays.fpPositionZ[tIdx] = parked;
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
