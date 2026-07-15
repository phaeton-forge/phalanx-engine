import { GameSystem } from '@phalanx-engine/ecs';
import type { SoAComponentStore, SystemContext } from '@phalanx-engine/ecs';
import type { AbilitySystem } from '@phalanx-engine/abilities';
import { FP } from '@phalanx-engine/math';
import { TransformSoASchema } from '@phalanx-engine/physics';
import {
  AutoAttackTimerComponent,
  ComponentType,
  SimulationStateComponent,
  TargetStateComponent,
  StatsComponent,
} from '../components';

export class AttackSystem extends GameSystem {
  private get _abilities(): AbilitySystem {
    return this.abilities as AbilitySystem;
  }
  private transformStore!: SoAComponentStore<
    typeof TransformSoASchema.definition
  >;

  public override init(context: SystemContext): void {
    super.init(context);
    this.transformStore =
      this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  public override processTick(): void {
    if (!this.getSimulationState()?.active) return;

    const units = this.entityManager.queryEntities(
      ComponentType.UnitStats,
      ComponentType.UnitType,
      ComponentType.TargetState,
      ComponentType.AutoAttackTimer
    );

    for (const unit of units) {
      const stats = unit.getComponent<StatsComponent>(ComponentType.UnitStats);
      const targetState = unit.getComponent<TargetStateComponent>(
        ComponentType.TargetState
      );
      const timer = unit.getComponent<AutoAttackTimerComponent>(
        ComponentType.AutoAttackTimer
      );
      if (!stats?.alive || !targetState || !timer) continue;

      const speedMult =
        this._abilities.tryGetAttribute(unit.id, 'AttackSpeedMultiplier')
          ?.current ?? FP.FromInt(1);

      if (FP.Gt(timer.ticksUntilNextAttack, FP.FromInt(0))) {
        timer.ticksUntilNextAttack = FP.Sub(
          timer.ticksUntilNextAttack,
          speedMult
        );
        continue;
      }

      if (!targetState.targetEntityId) continue;
      if (
        !this.isInAttackRange(
          unit.id,
          targetState.targetEntityId,
          stats.stopRange
        )
      )
        continue;

      this._abilities.activateAbility(unit.id, timer.abilityId, {
        entityId: targetState.targetEntityId,
      });
      timer.ticksUntilNextAttack = FP.FromInt(timer.cooldownTicks);
    }
  }

  private isInAttackRange(
    attackerId: number,
    targetId: number,
    stopRange: ReturnType<typeof FP.FromFloat>
  ): boolean {
    const attackerIdx = this.transformStore.indexOf(attackerId);
    const targetIdx = this.transformStore.indexOf(targetId);
    if (attackerIdx === -1 || targetIdx === -1) return false;

    const dx = FP.Sub(
      FP.FromRaw(this.transformStore.arrays.fpPositionX[targetIdx]),
      FP.FromRaw(this.transformStore.arrays.fpPositionX[attackerIdx])
    );
    const dz = FP.Sub(
      FP.FromRaw(this.transformStore.arrays.fpPositionZ[targetIdx]),
      FP.FromRaw(this.transformStore.arrays.fpPositionZ[attackerIdx])
    );
    return FP.Lte(
      FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz)),
      FP.Mul(stopRange, stopRange)
    );
  }

  private getSimulationState(): SimulationStateComponent | undefined {
    const [entity] = this.entityManager.queryEntities(
      ComponentType.SimulationState
    );
    return entity?.getComponent<SimulationStateComponent>(
      ComponentType.SimulationState
    );
  }
}
