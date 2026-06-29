import { GameSystem } from '@phalanx-engine/ecs';
import type { SoAComponentStore, SystemContext } from '@phalanx-engine/ecs';
import type { AbilitySystem } from '@phalanx-engine/abilities';
import { FP } from '@phalanx-engine/math';
import { PhysicsWorld, TransformSoASchema } from '@phalanx-engine/physics';
import { VOLT_COOLDOWN_TAG } from '../config/abilityDefinitions';
import { UnitType } from '../units';
import {
  ComponentType,
  SimulationStateComponent,
  StatsComponent,
  TeamComponent,
  UnitTypeComponent,
} from '../components';

/**
 * Decides *when* a Volt unit casts chain lightning and commits the cast via
 * `activateAbility('Ability.Volt.ChainLightning')`.
 *
 * Target selection and damage application live in the
 * {@link Hook.Volt.ChainLightning} activation hook; the cooldown is owned by
 * phalanx-abilities through `Effect.Volt.Cooldown`, so this system only checks
 * the cooldown tag and confirms a hostile is in range before committing.
 */
export class VoltAttackSystem extends GameSystem {
  private get _abilities(): AbilitySystem {
    return this.abilities as AbilitySystem;
  }

  private transformStore!: SoAComponentStore<
    typeof TransformSoASchema.definition
  >;

  public override init(ctx: SystemContext): void {
    super.init(ctx);
    this.transformStore =
      this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  public override processTick(): void {
    if (!this.getSimulationState()?.active) return;

    const physics = this.physics as PhysicsWorld | undefined;
    if (!physics) return;

    const volts = this.entityManager.queryEntities(
      ComponentType.UnitStats,
      ComponentType.Team,
      ComponentType.UnitType,
      ComponentType.Transform
    );

    for (const volt of volts) {
      const stats = volt.getComponent<StatsComponent>(ComponentType.UnitStats);
      const team = volt.getComponent<TeamComponent>(ComponentType.Team);
      const type = volt.getComponent<UnitTypeComponent>(ComponentType.UnitType);
      if (!stats?.alive || !team || !type || type.kind !== UnitType.Volt) {
        continue;
      }

      if (this._abilities.hasTag(volt.id, VOLT_COOLDOWN_TAG)) continue;

      const vIdx = this.transformStore.indexOf(volt.id);
      if (vIdx === -1) continue;
      const vx = FP.FromRaw(this.transformStore.arrays.fpPositionX[vIdx]);
      const vz = FP.FromRaw(this.transformStore.arrays.fpPositionZ[vIdx]);

      const nearby = physics.spatialGrid.queryRadius(
        vx,
        vz,
        type.detectionRadius
      );
      if (!this.hasHostileInRange(volt.id, team.teamId, nearby)) continue;

      this._abilities.activateAbility(volt.id, 'Ability.Volt.ChainLightning');
    }
  }

  /**
   * Early-exit existence check: returns `true` on the first alive, hostile,
   * typed unit found among `nearbyIds`.
   */
  private hasHostileInRange(
    selfId: number,
    selfTeam: number,
    nearbyIds: readonly number[]
  ): boolean {
    for (const id of nearbyIds) {
      if (id === selfId) continue;

      const entity = this.entityManager.getEntity(id);
      if (!entity) continue;

      const stats = entity.getComponent<StatsComponent>(
        ComponentType.UnitStats
      );
      const team = entity.getComponent<TeamComponent>(ComponentType.Team);
      if (!stats?.alive || !team || team.teamId === selfTeam) continue;
      if (!entity.hasComponent(ComponentType.UnitType)) continue;

      return true;
    }
    return false;
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
