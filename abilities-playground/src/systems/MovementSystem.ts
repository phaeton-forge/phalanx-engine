import { GameSystem } from '@phalanx-engine/ecs';
import type {
  Entity,
  SoAComponentStore,
  SystemContext,
} from '@phalanx-engine/ecs';
import { PhysicsSoASchema, TransformSoASchema } from '@phalanx-engine/physics';
import { FP } from '@phalanx-engine/math';
import type { FixedPoint } from '@phalanx-engine/math';
import {
  ComponentType,
  SimulationStateComponent,
  SupportUnitTargetingComponent,
  TargetStateComponent,
  TeamComponent,
  StatsComponent,
} from '../components';
import { UNIT_MOVE_SPEED } from '../config/abilityDefinitions.ts';

export class MovementSystem extends GameSystem {
  private physicsStore!: SoAComponentStore<typeof PhysicsSoASchema.definition>;
  private transformStore!: SoAComponentStore<
    typeof TransformSoASchema.definition
  >;

  /** Cached singleton simulation-state entity (re-resolved if it disappears). */
  private simStateEntity?: Entity;

  public override init(context: SystemContext): void {
    super.init(context);
    this.physicsStore =
      this.entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    this.transformStore =
      this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  public override processTick(): void {
    const isActive = this.getSimulationState()?.active ?? false;
    const zeroRaw = FP.ToRaw(FP._0);
    const velocityX = this.physicsStore.arrays.velocityX;
    const velocityY = this.physicsStore.arrays.velocityY;
    const velocityZ = this.physicsStore.arrays.velocityZ;

    for (const entityId of this.physicsStore.entityIds()) {
      const physicsIndex = this.physicsStore.indexOf(entityId);

      // Ballistic bodies (useGravity=true, e.g. SAU shrapnel) own all three
      // velocity axes: GravitySystem accelerates them and PhysicsSystem
      // integrates the arc. The unit-movement controller must not touch them,
      // otherwise it flattens the arc by zeroing velocity every tick.
      if (this.physicsStore.arrays.useGravity[physicsIndex] === 1) continue;

      velocityY[physicsIndex] = zeroRaw;

      const shouldFreeze =
        !isActive ||
        this.physicsStore.arrays.isStatic[physicsIndex] === 1 ||
        this.physicsStore.arrays.ignorePhysics[physicsIndex] === 1;

      const entity = this.entityManager.getEntity(entityId);
      if (entity?.hasComponent(ComponentType.Projectile)) {
        continue;
      }

      const stats = entity?.getComponent<StatsComponent>(
        ComponentType.UnitStats
      );

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

      const direction = this.getDesiredDirection(entity, transformIndex);

      if (!direction) {
        velocityX[physicsIndex] = zeroRaw;
        velocityZ[physicsIndex] = zeroRaw;
        continue;
      }

      const effectiveSpeed = FP.FromInt(UNIT_MOVE_SPEED);

      if (!effectiveSpeed) continue;

      velocityX[physicsIndex] = FP.ToRaw(FP.Mul(direction.x, effectiveSpeed));
      velocityZ[physicsIndex] = FP.ToRaw(FP.Mul(direction.z, effectiveSpeed));
    }
  }

  /**
   * Compute the normalized desired movement direction for an entity.
   *
   * @param entity - The moving entity (already resolved by the caller).
   * @param ownIndex - The entity's index in the transform store (already
   *   resolved and validated as != -1 by the caller).
   */
  private getDesiredDirection(
    entity: Entity,
    ownIndex: number
  ): { x: FixedPoint; z: FixedPoint } | null {
    const targetState = entity.getComponent<TargetStateComponent>(
      ComponentType.TargetState
    );
    const stats = entity.getComponent<StatsComponent>(ComponentType.UnitStats);
    const team = entity.getComponent<TeamComponent>(ComponentType.Team);
    if (!targetState || !stats || !team) return null;

    // Support units advance while the area is clear and hold position once hostiles
    // are detected nearby, channeling their aura from a safer distance.
    const supportTargeting = entity.getComponent<SupportUnitTargetingComponent>(
      ComponentType.SupportUnitTargeting
    );
    if (supportTargeting && supportTargeting.enemiesDetected) return null;

    const ownX = FP.FromRaw(this.transformStore.arrays.fpPositionX[ownIndex]);
    const ownZ = FP.FromRaw(this.transformStore.arrays.fpPositionZ[ownIndex]);
    let dx = FP._0;
    let dz = team.teamId === 0 ? FP._1 : FP.Neg(FP._1);

    if (targetState.targetEntityId !== null) {
      const targetIndex = this.transformStore.indexOf(
        targetState.targetEntityId
      );
      if (targetIndex !== -1) {
        dx = FP.Sub(
          FP.FromRaw(this.transformStore.arrays.fpPositionX[targetIndex]),
          ownX
        );
        dz = FP.Sub(
          FP.FromRaw(this.transformStore.arrays.fpPositionZ[targetIndex]),
          ownZ
        );
      }
    }

    const distanceSq = FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz));
    if (FP.Eq(distanceSq, FP._0)) return null;

    const stopRangeSq = FP.Mul(stats.stopRange, stats.stopRange);
    if (
      targetState.targetEntityId !== null &&
      FP.Lte(distanceSq, stopRangeSq)
    ) {
      return null;
    }

    const distance = FP.Sqrt(distanceSq);
    return {
      x: FP.Div(dx, distance),
      z: FP.Div(dz, distance),
    };
  }

  private getSimulationState(): SimulationStateComponent | undefined {
    // Re-resolve only when the cached entity is missing or has been destroyed,
    // avoiding a full queryEntities() pass every tick for this singleton.
    if (!this.simStateEntity || this.simStateEntity.isDestroyed) {
      [this.simStateEntity] = this.entityManager.queryEntities(
        ComponentType.SimulationState
      );
    }
    return this.simStateEntity?.getComponent<SimulationStateComponent>(
      ComponentType.SimulationState
    );
  }
}
