import { GameSystem } from '@phalanx-engine/ecs';
import type { SoAComponentStore, SystemContext } from '@phalanx-engine/ecs';
import type { AbilitySystem } from '@phalanx-engine/abilities';
import { FP } from '@phalanx-engine/math';
import { PhysicsWorld, TransformSoASchema } from '@phalanx-engine/physics';
import { MISSILE_VOLLEY_COOLDOWN_TAG } from '../config/abilityDefinitions';
import { UnitType } from '../units';
import {
  ComponentType,
  SimulationStateComponent,
  StatsComponent,
  TeamComponent,
  UnitTypeComponent,
} from '../components';

/**
 * Decides *when* a rocket fires its homing-missile volley and commits the cast
 * via `activateAbility('Ability.MissileVolley')`.
 *
 * Spawning and multi-target acquisition live in the {@link Hook.MissileVolley}
 * activation hook (`hooks/MissileVolley.ts`); the volley cooldown is owned by
 * phalanx-abilities (`Effect.MissileVolley.Cooldown` grants
 * {@link MISSILE_VOLLEY_COOLDOWN_TAG}), so this system no longer tracks any
 * per-rocket timer.
 *
 * Each tick, for every alive rocket that is off cooldown, it performs only a
 * cheap "is there at least one hostile unit in detection range?" existence
 * check. The check exists so a volley (and its cooldown) is only committed when
 * there is something to shoot — preserving the original "retry every tick while
 * idle" responsiveness. The full nearest-N selection runs once per volley,
 * inside the hook.
 */
export class MissileLauncherSystem extends GameSystem {
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

    const rockets = this.entityManager.queryEntities(
      ComponentType.UnitStats,
      ComponentType.Team,
      ComponentType.UnitType,
      ComponentType.Transform
    );

    for (const rocket of rockets) {
      const stats = rocket.getComponent<StatsComponent>(
        ComponentType.UnitStats
      );
      const team = rocket.getComponent<TeamComponent>(ComponentType.Team);
      const type = rocket.getComponent<UnitTypeComponent>(
        ComponentType.UnitType
      );
      if (!stats?.alive || !team || !type || type.kind !== UnitType.Rocket) continue;

      // Cooldown is owned by the ability system; skip while the cooldown tag
      // is present so we neither enqueue nor re-check targets uselessly.
      if (this._abilities.hasTag(rocket.id, MISSILE_VOLLEY_COOLDOWN_TAG))
        continue;

      const rIdx = this.transformStore.indexOf(rocket.id);
      if (rIdx === -1) continue;
      const rx = FP.FromRaw(this.transformStore.arrays.fpPositionX[rIdx]);
      const rz = FP.FromRaw(this.transformStore.arrays.fpPositionZ[rIdx]);

      // Only commit a volley when there is at least one valid hostile in range.
      const nearby = physics.spatialGrid.queryRadius(
        rx,
        rz,
        type.detectionRadius
      );
      if (!this.hasHostileInRange(rocket.id, team.teamId, nearby)) continue;

      this._abilities.activateAbility(rocket.id, 'Ability.MissileVolley');
    }
  }

  /**
   * Early-exit existence check: returns `true` on the first alive, hostile,
   * typed unit found among `nearbyIds`. Mirrors the eligibility filter used by
   * the volley hook's nearest-enemy selection.
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
