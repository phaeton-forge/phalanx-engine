import { GameSystem } from 'phalanx-ecs';
import type { SoAComponentStore, SystemContext } from 'phalanx-ecs';
import type { AbilitySystem } from 'phalanx-abilities';
import { FP } from 'phalanx-math';
import { PhysicsSoASchema } from 'phalanx-physics';
import {
  ComponentType,
  SimulationStateComponent,
  TeamComponent,
  StatsComponent,
} from '../components';

export class DeathSystem extends GameSystem {
  private get _abilities(): AbilitySystem { return this.abilities as AbilitySystem; }
  private physicsStore!: SoAComponentStore<typeof PhysicsSoASchema.definition>;
  private readonly pendingDespawnTickByEntityId = new Map<number, number>();

  public override init(context: SystemContext): void {
    super.init(context);
    this.physicsStore = this.entityManager.getOrCreateSoAStore(PhysicsSoASchema);
  }

  public override processTick(tick: number): void {
    const simState = this.getSimulationState();
    if (!simState?.active || simState.gameOver) return;

    this.despawnDueEntities(tick);

    let team0Alive = false;
    let team1Alive = false;

    const units = this.entityManager.queryEntities(ComponentType.UnitStats, ComponentType.Team);

    for (const unit of units) {
      const stats = unit.getComponent<StatsComponent>(ComponentType.UnitStats);
      const team = unit.getComponent<TeamComponent>(ComponentType.Team);

      if (!stats || !team) continue;

      if (stats.alive) {
        const health = this._abilities.tryGetAttribute(unit.id, 'Health')?.current;

        if (health && FP.Lte(health, FP._0)) {
          this.killUnit(unit.id, stats, tick);
        }
      }

      if (stats.alive) {
        if (team.teamId === 0) {
          team0Alive = true;
        }
        else {
          team1Alive = true;
        }
      }
    }

    if (!team0Alive || !team1Alive) {
      simState.gameOver = true;

      if (team0Alive) simState.winner = 0;

      else if (team1Alive) simState.winner = 1;
      else simState.winner = null;
    }
  }

  private killUnit(entityId: number, stats: StatsComponent, tick: number): void {
    stats.alive = false;

    const physIdx = this.physicsStore.indexOf(entityId);

    if (physIdx !== -1) {
      this.physicsStore.arrays.ignorePhysics[physIdx] = 1;
      this.physicsStore.arrays.velocityX[physIdx] = FP.ToRaw(FP._0);
      this.physicsStore.arrays.velocityZ[physIdx] = FP.ToRaw(FP._0);
    }

    this._abilities.applyEffect(entityId, 'Effect.Death', entityId);
    this.pendingDespawnTickByEntityId.set(entityId, tick + 1);
  }

  private despawnDueEntities(tick: number): void {
    for (const [entityId, dueTick] of this.pendingDespawnTickByEntityId) {
      if (tick < dueTick) continue;

      const entity = this.entityManager.getEntity(entityId);
      if (!entity) {
        this.pendingDespawnTickByEntityId.delete(entityId);
        continue;
      }

      this.entityManager.removeEntity(entity);
      this.pendingDespawnTickByEntityId.delete(entityId);
    }
  }

  private getSimulationState(): SimulationStateComponent | undefined {
    const [entity] = this.entityManager.queryEntities(ComponentType.SimulationState);
    return entity?.getComponent<SimulationStateComponent>(ComponentType.SimulationState);
  }
}
