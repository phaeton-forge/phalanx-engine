import { GameSystem } from 'phalanx-ecs';
import type { SoAComponentStore, SystemContext } from 'phalanx-ecs';
import type { AbilitySystem } from 'phalanx-abilities';
import { FP } from 'phalanx-math';
import {
  ComponentType,
  SimulationStateComponent,
  TargetStateComponent,
  TransformSoASchema,
  UnitStatsComponent,
  UnitTypeComponent,
} from '../components';

export class AttackSystem extends GameSystem {
  private get _abilities(): AbilitySystem { return this.abilities as AbilitySystem; }
  private transformStore!: SoAComponentStore<typeof TransformSoASchema.definition>;

  public override init(context: SystemContext): void {
    super.init(context);
    this.transformStore = this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  public override processTick(): void {
    if (!this.getSimulationState()?.active) return;

    const units = this.entityManager.queryEntities(
      ComponentType.UnitStats,
      ComponentType.UnitType,
      ComponentType.TargetState,
    );

    for (const unit of units) {
      const type = unit.getComponent<UnitTypeComponent>(ComponentType.UnitType);
      if (type?.kind !== 'sphere') continue;

      const stats = unit.getComponent<UnitStatsComponent>(ComponentType.UnitStats);
      const targetState = unit.getComponent<TargetStateComponent>(ComponentType.TargetState);
      if (!stats?.alive || !targetState?.targetEntityId) continue;

      if (!this.isInAttackRange(unit.id, targetState.targetEntityId, stats.stopRange)) continue;

      this._abilities.activateAbility(unit.id, 'Ability.AutoAttack', {
        entityId: targetState.targetEntityId,
      });
    }
  }

  private isInAttackRange(
    attackerId: number,
    targetId: number,
    stopRange: ReturnType<typeof FP.FromFloat>,
  ): boolean {
    const attackerIdx = this.transformStore.indexOf(attackerId);
    const targetIdx = this.transformStore.indexOf(targetId);
    if (attackerIdx === -1 || targetIdx === -1) return false;

    const dx = FP.Sub(
      FP.FromRaw(this.transformStore.arrays.fpPositionX[targetIdx]),
      FP.FromRaw(this.transformStore.arrays.fpPositionX[attackerIdx]),
    );
    const dz = FP.Sub(
      FP.FromRaw(this.transformStore.arrays.fpPositionZ[targetIdx]),
      FP.FromRaw(this.transformStore.arrays.fpPositionZ[attackerIdx]),
    );
    return FP.Lte(FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz)), FP.Mul(stopRange, stopRange));
  }

  private getSimulationState(): SimulationStateComponent | undefined {
    const [entity] = this.entityManager.queryEntities(ComponentType.SimulationState);
    return entity?.getComponent<SimulationStateComponent>(ComponentType.SimulationState);
  }
}
