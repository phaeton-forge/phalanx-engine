import { GameSystem } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import { arenaConfig, networkConfig } from '../config/constants';
import {
  ComponentType,
  LifecycleComponent,
  TargetingComponent,
  TransformComponent,
  UnitComponent,
} from '../components';
import { clamp, distanceSquared } from '../core/helpers';
import type { AbilityContext, GameRuntimeState } from '../core/types';

export class MovementSystem extends GameSystem {
  public constructor(
    private readonly state: GameRuntimeState,
    private readonly abilities: AbilityContext
  ) {
    super();
  }

  public override processTick(): void {
    if (!this.state.simulationStarted || this.state.gameOver) return;

    const units = this.entityManager.queryEntities(ComponentType.Unit);

    for (const entity of units) {
      const unit = entity.getComponent<UnitComponent>(ComponentType.Unit);
      const transform = entity.getComponent<TransformComponent>(
        ComponentType.Transform
      );
      const lifecycle = entity.getComponent<LifecycleComponent>(
        ComponentType.Lifecycle
      );
      const targeting = entity.getComponent<TargetingComponent>(
        ComponentType.Targeting
      );
      if (!unit || !transform || !lifecycle || !targeting || !lifecycle.alive)
        continue;

      const speedMultiplier = FP.ToFloat(
        this.abilities.facade.getAttribute(entity.id, 'MoveSpeedMultiplier')
          .current
      );
      const speed =
        FP.ToFloat(unit.moveSpeed) *
        speedMultiplier *
        networkConfig.tickTimestep;
      if (speed <= 0) continue;

      const currentX = FP.ToFloat(transform.x);
      const currentZ = FP.ToFloat(transform.z);
      const target = this.pickTargetPosition(
        entity.id,
        unit,
        currentX,
        currentZ,
        targeting.attackTargetId,
        units
      );
      if (!target) continue;

      const dx = target.x - currentX;
      const dz = target.z - currentZ;
      const distSq = dx * dx + dz * dz;
      if (distSq < 0.0001) continue;

      const dist = Math.sqrt(distSq);
      const step = Math.min(speed, dist);
      const nextX = clamp(
        currentX + (dx / dist) * step,
        arenaConfig.minX + 1,
        arenaConfig.maxX - 1
      );
      const nextZ = clamp(
        currentZ + (dz / dist) * step,
        arenaConfig.minZ + 1,
        arenaConfig.maxZ - 1
      );

      transform.x = FP.FromFloat(nextX);
      transform.z = FP.FromFloat(nextZ);
    }
  }

  private pickTargetPosition(
    entityId: number,
    unit: UnitComponent,
    x: number,
    z: number,
    attackTargetId: number | null,
    allUnits: import('phalanx-ecs').Entity[]
  ): { x: number; z: number } | null {
    if (unit.unitType === 'sphere' && attackTargetId !== null) {
      const targetEntity = this.entityManager.getEntity(attackTargetId);
      const targetTransform = targetEntity?.getComponent<TransformComponent>(
        ComponentType.Transform
      );
      const targetLife = targetEntity?.getComponent<LifecycleComponent>(
        ComponentType.Lifecycle
      );
      if (!targetTransform || !targetLife || !targetLife.alive) return null;

      const targetX = FP.ToFloat(targetTransform.x);
      const targetZ = FP.ToFloat(targetTransform.z);
      const range = FP.ToFloat(unit.attackRange);
      if (distanceSquared(x, z, targetX, targetZ) <= range * range) {
        return null;
      }
      return { x: targetX, z: targetZ };
    }

    if (unit.unitType === 'cube') {
      const allies = allUnits.filter((candidate) => {
        const candidateUnit = candidate.getComponent<UnitComponent>(
          ComponentType.Unit
        );
        const candidateLife = candidate.getComponent<LifecycleComponent>(
          ComponentType.Lifecycle
        );
        return (
          !!candidateUnit &&
          !!candidateLife &&
          candidateLife.alive &&
          candidateUnit.teamId === unit.teamId
        );
      });
      if (allies.length === 0) return null;

      let sumX = 0;
      let sumZ = 0;
      for (const ally of allies) {
        const allyTransform = ally.getComponent<TransformComponent>(
          ComponentType.Transform
        );
        if (!allyTransform) continue;
        sumX += FP.ToFloat(allyTransform.x);
        sumZ += FP.ToFloat(allyTransform.z);
      }
      return { x: sumX / allies.length, z: sumZ / allies.length };
    }

    if (unit.unitType === 'cone') {
      const allies = allUnits.filter((candidate) => {
        const candidateUnit = candidate.getComponent<UnitComponent>(
          ComponentType.Unit
        );
        const candidateLife = candidate.getComponent<LifecycleComponent>(
          ComponentType.Lifecycle
        );
        return (
          !!candidateUnit &&
          !!candidateLife &&
          candidateLife.alive &&
          candidateUnit.teamId === unit.teamId
        );
      });

      if (allies.length === 0) return null;

      let sumX = 0;
      let fallbackZ =
        unit.teamId === 1 ? arenaConfig.team1SpawnZ : arenaConfig.team2SpawnZ;
      let count = 0;
      for (const ally of allies) {
        if (ally.id === entityId) continue;
        const allyTransform = ally.getComponent<TransformComponent>(
          ComponentType.Transform
        );
        if (!allyTransform) continue;
        const allyX = FP.ToFloat(allyTransform.x);
        const allyZ = FP.ToFloat(allyTransform.z);
        sumX += allyX;
        fallbackZ =
          unit.teamId === 1
            ? Math.min(fallbackZ, allyZ)
            : Math.max(fallbackZ, allyZ);
        count += 1;
      }

      if (count === 0) return null;
      return {
        x: sumX / count,
        z: unit.teamId === 1 ? fallbackZ - 12 : fallbackZ + 12,
      };
    }

    return null;
  }
}
