import { GameSystem } from 'phalanx-ecs';
import type { SoAComponentStore, SystemContext } from 'phalanx-ecs';
import type { AbilitySystem } from 'phalanx-abilities';
import { PhysicsSoASchema } from 'phalanx-physics';
import { FP } from 'phalanx-math';
import type { FixedPoint } from 'phalanx-math';
import {
  ComponentType,
  SimulationStateComponent,
  TargetStateComponent,
  TeamComponent,
  TransformSoASchema,
  StatsComponent,
} from '../components';

export class MovementSystem extends GameSystem {
  private get _abilities(): AbilitySystem { return this.abilities as AbilitySystem; }
  private physicsStore!: SoAComponentStore<typeof PhysicsSoASchema.definition>;
  private transformStore!: SoAComponentStore<typeof TransformSoASchema.definition>;

  public override init(context: SystemContext): void {
    super.init(context);
    this.physicsStore = this.entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    this.transformStore = this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  public override processTick(): void {
    const isActive = this.getSimulationState()?.active ?? false;
    const zeroRaw = FP.ToRaw(FP._0);
    const velocityX = this.physicsStore.arrays.velocityX;
    const velocityY = this.physicsStore.arrays.velocityY;
    const velocityZ = this.physicsStore.arrays.velocityZ;

    for (const entityId of this.physicsStore.entityIds()) {
      const physicsIndex = this.physicsStore.indexOf(entityId);
      velocityY[physicsIndex] = zeroRaw;

      const shouldFreeze =
        !isActive ||
        this.physicsStore.arrays.isStatic[physicsIndex] === 1 ||
        this.physicsStore.arrays.ignorePhysics[physicsIndex] === 1;

      const entity = this.entityManager.getEntity(entityId);
      if (entity?.hasComponent(ComponentType.Projectile)) {
        continue;
      }

      const stats = entity?.getComponent<StatsComponent>(ComponentType.UnitStats);

      if (shouldFreeze || !entity || !stats?.alive) {
        velocityX[physicsIndex] = zeroRaw;
        velocityZ[physicsIndex] = zeroRaw;
        continue;
      }

      const transformIndex = this.transformStore.indexOf(entityId);

      if (transformIndex === -1) {
        velocityX[physicsIndex] = zeroRaw;
        velocityZ[physicsIndex] = zeroRaw;
        continue;
      }

      const direction = this.getDesiredDirection(entityId);

      if (!direction) {
        velocityX[physicsIndex] = zeroRaw;
        velocityZ[physicsIndex] = zeroRaw;
        continue;
      }

      const effectiveSpeed = this._abilities.tryGetAttribute(entityId, 'MoveSpeed')?.current;

      if (!effectiveSpeed) continue;

      velocityX[physicsIndex] = FP.ToRaw(FP.Mul(direction.x, effectiveSpeed));
      velocityZ[physicsIndex] = FP.ToRaw(FP.Mul(direction.z, effectiveSpeed));
    }
  }

  private getDesiredDirection(
    entityId: number,
  ): { x: FixedPoint; z: FixedPoint } | null {
    const entity = this.entityManager.getEntity(entityId);
    if (!entity) return null;

    const targetState = entity.getComponent<TargetStateComponent>(ComponentType.TargetState);
    const stats = entity.getComponent<StatsComponent>(ComponentType.UnitStats);
    const team = entity.getComponent<TeamComponent>(ComponentType.Team);
    const ownIndex = this.transformStore.indexOf(entityId);
    if (!targetState || !stats || !team || ownIndex === -1) return null;

    const ownX = FP.FromRaw(this.transformStore.arrays.fpPositionX[ownIndex]);
    const ownZ = FP.FromRaw(this.transformStore.arrays.fpPositionZ[ownIndex]);
    let dx = FP._0;
    let dz = team.teamId === 0 ? FP._1 : FP.Neg(FP._1);

    if (targetState.targetEntityId !== null) {
      const targetIndex = this.transformStore.indexOf(targetState.targetEntityId);
      if (targetIndex !== -1) {
        dx = FP.Sub(
          FP.FromRaw(this.transformStore.arrays.fpPositionX[targetIndex]),
          ownX,
        );
        dz = FP.Sub(
          FP.FromRaw(this.transformStore.arrays.fpPositionZ[targetIndex]),
          ownZ,
        );
      }
    }

    const distanceSq = FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz));
    if (FP.Eq(distanceSq, FP._0)) return null;

    const stopRangeSq = FP.Mul(stats.stopRange, stats.stopRange);
    if (targetState.targetEntityId !== null && FP.Lte(distanceSq, stopRangeSq)) {
      return null;
    }

    const distance = FP.Sqrt(distanceSq);
    return {
      x: FP.Div(dx, distance),
      z: FP.Div(dz, distance),
    };
  }

  private getSimulationState(): SimulationStateComponent | undefined {
    const [stateEntity] = this.entityManager.queryEntities(ComponentType.SimulationState);
    return stateEntity?.getComponent<SimulationStateComponent>(ComponentType.SimulationState);
  }
}
