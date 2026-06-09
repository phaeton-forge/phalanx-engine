import { GameSystem, type SoAComponentStore, type SystemContext } from 'phalanx-ecs';
import { PhysicsSoASchema, TransformSoASchema } from 'phalanx-physics';
import { FP } from 'phalanx-math';
import { networkConfig, PROJECTILE_SPEED } from '../config/constants';
import { ComponentType } from '../components';
import { ProjectileComponent } from '../components/ProjectileComponent';
import { ProjectileEntity } from '../entities/Projectile.ts';
import { despawnProjectile } from './projectileDespawn';

const FP_TICK_TIMESTEP = FP.FromFloat(networkConfig.tickTimestep);
const FP_PROJECTILE_SPEED = FP.FromFloat(PROJECTILE_SPEED);

export class ProjectileMovementSystem extends GameSystem {
  private physicsStore!: SoAComponentStore<typeof PhysicsSoASchema.definition>;
  private transformStore!: SoAComponentStore<typeof TransformSoASchema.definition>;

  public override init(context: SystemContext): void {
    super.init(context);
    this.physicsStore = this.entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    this.transformStore = this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  public override processTick(): void {
    const velocityX = this.physicsStore.arrays.velocityX;
    const velocityZ = this.physicsStore.arrays.velocityZ;

    const projectiles = this.entityManager.queryEntities(
      ComponentType.Projectile,
      ComponentType.Transform,
    ) as ProjectileEntity[];

    for (const projectile of projectiles) {
      if (!projectile.active) continue;

      const projectileComponent = projectile.getComponent<ProjectileComponent>(
        ComponentType.Projectile,
      );
      if (!projectileComponent) continue;

      projectileComponent.lifeTime = FP.Sub(projectileComponent.lifeTime, FP_TICK_TIMESTEP);

      if (FP.Lte(projectileComponent.lifeTime, FP._0)) {
        this.releaseProjectile(projectile);
        continue;
      }

      const transformIndex = this.transformStore.indexOf(projectile.id);
      const physicsIndex = this.physicsStore.indexOf(projectile.id);

      if (transformIndex === -1 || physicsIndex === -1) continue;

      const direction2 = projectileComponent.fpDirection2;
      velocityX[physicsIndex] = FP.ToRaw(FP.Mul(direction2.x, FP_PROJECTILE_SPEED));
      velocityZ[physicsIndex] = FP.ToRaw(FP.Mul(direction2.y, FP_PROJECTILE_SPEED));
    }
  }

  private releaseProjectile(projectile: ProjectileEntity): void {
    despawnProjectile(this.pools, this.entityManager, projectile);
  }
}
