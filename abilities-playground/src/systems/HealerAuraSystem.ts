import { GameSystem } from 'phalanx-ecs';
import type { SoAComponentStore, SystemContext } from 'phalanx-ecs';
import {
  ComponentType,
  HealerAuraLinkComponent,
  TransformSoASchema,
  StatsComponent,
} from '../components';

/**
 * Keeps each healing-aura zone entity spatially aligned with its cube owner
 * so that `AuraTickSystem` can resolve targets from the correct position.
 * Must run before `abilities.tickSystems` each tick.
 */
export class HealerAuraSystem extends GameSystem {
  private transformStore!: SoAComponentStore<typeof TransformSoASchema.definition>;

  public override init(context: SystemContext): void {
    super.init(context);
    this.transformStore = this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  public override processTick(): void {
    const cubes = this.entityManager.queryEntities(
      ComponentType.HealerAuraLink,
      ComponentType.UnitStats,
      ComponentType.Transform,
    );

    for (const cube of cubes) {
      const stats = cube.getComponent<StatsComponent>(ComponentType.UnitStats);
      const link = cube.getComponent<HealerAuraLinkComponent>(ComponentType.HealerAuraLink);
      if (!stats || !link?.auraEntityId) continue;

      const cubeIdx = this.transformStore.indexOf(cube.id);
      const zoneIdx = this.transformStore.indexOf(link.auraEntityId);
      if (cubeIdx === -1 || zoneIdx === -1) continue;

      this.transformStore.arrays.fpPositionX[zoneIdx] =
        this.transformStore.arrays.fpPositionX[cubeIdx];
      this.transformStore.arrays.fpPositionZ[zoneIdx] =
        this.transformStore.arrays.fpPositionZ[cubeIdx];
    }
  }
}
