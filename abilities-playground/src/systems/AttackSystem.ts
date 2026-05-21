import { GameSystem } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import {
  ComponentType,
  CombatComponent,
  LifecycleComponent,
  TransformComponent,
  UnitComponent,
} from '../components';
import { distanceSquared } from '../core/helpers';
import type { AbilityContext, GameRuntimeState } from '../core/types';

export class AttackSystem extends GameSystem {
  public constructor(
    private readonly state: GameRuntimeState,
    private readonly abilities: AbilityContext
  ) {
    super();
  }

  public override processTick(tick: number): void {
    if (!this.state.simulationStarted || this.state.gameOver) return;

    const entities = this.entityManager.queryEntities(ComponentType.Unit);
    for (const entity of entities) {
      const unit = entity.getComponent<UnitComponent>(ComponentType.Unit);
      const combat = entity.getComponent<CombatComponent>(ComponentType.Combat);
      const transform = entity.getComponent<TransformComponent>(
        ComponentType.Transform
      );
      const life = entity.getComponent<LifecycleComponent>(
        ComponentType.Lifecycle
      );
      if (!unit || !combat || !transform || !life || !life.alive) continue;
      if (
        unit.unitType !== 'sphere' ||
        combat.targetId === null ||
        tick < combat.nextAttackTick
      )
        continue;

      const targetEntity = this.entityManager.getEntity(combat.targetId);
      const targetUnit = targetEntity?.getComponent<UnitComponent>(
        ComponentType.Unit
      );
      const targetTransform = targetEntity?.getComponent<TransformComponent>(
        ComponentType.Transform
      );
      const targetLife = targetEntity?.getComponent<LifecycleComponent>(
        ComponentType.Lifecycle
      );
      if (
        !targetEntity ||
        !targetUnit ||
        !targetTransform ||
        !targetLife ||
        !targetLife.alive
      )
        continue;

      const inRange =
        distanceSquared(
          FP.ToFloat(transform.x),
          FP.ToFloat(transform.z),
          FP.ToFloat(targetTransform.x),
          FP.ToFloat(targetTransform.z)
        ) <= Math.pow(FP.ToFloat(unit.attackRange), 2);
      if (!inRange) continue;

      this.abilities.facade.applyEffect(
        targetEntity.id,
        this.abilities.effects.damage18,
        entity.id
      );
      if (
        this.abilities.facade.hasTag(
          targetEntity.id,
          this.abilities.tags.illuminated
        )
      ) {
        this.abilities.facade.applyEffect(
          targetEntity.id,
          this.abilities.effects.damage54,
          entity.id
        );
      }

      const attackSpeed = FP.ToFloat(
        this.abilities.facade.getAttribute(entity.id, 'AttackSpeedMultiplier')
          .current
      );
      const cooldownTicks = Math.max(
        1,
        Math.round(unit.attackCooldownTicks / Math.max(attackSpeed, 0.01))
      );
      combat.nextAttackTick = tick + cooldownTicks;
    }
  }
}
