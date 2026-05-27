import { GameSystem, GameWorld, type SoAComponentStore, type SystemContext } from 'phalanx-ecs';
import { PhysicsSoASchema } from 'phalanx-physics';
import { FP } from 'phalanx-math';
import { networkConfig } from '../config/constants';
import { ComponentType, TransformSoASchema } from '../components';
import { ProjectileComponent } from '../components/ProjectileComponent';
import { ProjectileEntity } from '../entities/Projectile.ts';

const FP_TICK_TIMESTEP = FP.FromFloat(networkConfig.tickTimestep);

export class ProjectileMovementSystem extends GameSystem {
  private physicsStore!: SoAComponentStore<typeof PhysicsSoASchema.definition>;
  private transformStore!: SoAComponentStore<typeof TransformSoASchema.definition>;
  private readonly world: GameWorld;

  constructor(world: GameWorld) {
    super();
    this.world = world;
  }

  public override init(context: SystemContext): void {
    super.init(context);
    this.physicsStore = this.entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    this.transformStore = this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  public override processTick(): void {
    const velocityX = this.physicsStore.arrays.velocityX;
    const velocityZ = this.physicsStore.arrays.velocityZ;
    const positionX = this.transformStore.arrays.fpPositionX;
    const positionZ = this.transformStore.arrays.fpPositionZ;

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
        this.entityManager.removeEntity(projectile);
        this.world.pools?.release('projectile', projectile);
        continue;
      }

      const physicsIndex = this.physicsStore.indexOf(projectile.id);
      if (physicsIndex === -1) continue;

      positionX[physicsIndex] += velocityX[physicsIndex];
      positionZ[physicsIndex] += velocityZ[physicsIndex];
    }
  }
}
