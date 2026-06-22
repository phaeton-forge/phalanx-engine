import { GameSystem } from 'phalanx-ecs';
import type { SoAComponentStore, SystemContext } from 'phalanx-ecs';
import type { AbilitySystem } from 'phalanx-abilities';
import { FP } from 'phalanx-math';
import { PhysicsWorld, TransformSoASchema } from 'phalanx-physics';
import {
  ComponentType,
  HealAuraComponent,
  SimulationStateComponent,
  StatsComponent,
  TeamComponent,
} from '../components';

const HEAL_AURA_ACTIVE_TAG = 'State.HealAura.Active';

/**
 * Drives support healing auras (game-side AoE — auras are user-side per
 * phalanx-abilities). Every {@link HealAuraComponent.pulseTicks} ticks, each
 * active aura queries allied units within its radius (via the physics spatial
 * grid `queryRadius`) and applies `Effect.Heal.Tick` to them. The heal magnitude
 * and the green-cross cue live on the effect definition.
 *
 * Determinism: pulse cadence is counted in whole ticks; `queryRadius` returns a
 * deterministic id-sorted set already filtered by exact distance; `applyEffect`
 * is enqueued from a tick system (never from a cue). Game code only layers
 * gameplay filters (team, alive) on top of the physics range query.
 */
export class HealingAuraSystem extends GameSystem {
  private get _abilities(): AbilitySystem {
    return this.abilities as AbilitySystem;
  }

  private transformStore!: SoAComponentStore<typeof TransformSoASchema.definition>;

  public override init(context: SystemContext): void {
    super.init(context);
    this.transformStore = this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  public override processTick(): void {
    if (!this.getSimulationState()?.active) return;

    const physics = this.physics as PhysicsWorld | undefined;
    if (!physics) return;

    const auras = this.entityManager.queryEntities(
      ComponentType.HealAura,
      ComponentType.Team,
      ComponentType.UnitStats,
    );

    for (const caster of auras) {
      const aura = caster.getComponent<HealAuraComponent>(ComponentType.HealAura);
      const stats = caster.getComponent<StatsComponent>(ComponentType.UnitStats);
      const team = caster.getComponent<TeamComponent>(ComponentType.Team);
      if (!aura || !stats?.alive || !team) continue;

      // Only pulse while the aura marker (granted at spawn) is active.
      if (!this._abilities.hasTag(caster.id, HEAL_AURA_ACTIVE_TAG)) continue;

      if (--aura.ticksUntilPulse > 0) continue;
      aura.ticksUntilPulse = aura.pulseTicks;

      this.pulse(physics, caster.id, team.teamId, aura.radius);
    }
  }

  private pulse(
    physics: PhysicsWorld,
    casterId: number,
    casterTeam: number,
    radius: ReturnType<typeof FP.FromFloat>,
  ): void {
    const casterIdx = this.transformStore.indexOf(casterId);
    if (casterIdx === -1) return;

    const casterX = FP.FromRaw(this.transformStore.arrays.fpPositionX[casterIdx]);
    const casterZ = FP.FromRaw(this.transformStore.arrays.fpPositionZ[casterIdx]);

    // queryRadius already filters by exact distance — game code only applies
    // gameplay filters (team, alive). Candidates are sorted by id (deterministic).
    const candidates = physics.spatialGrid.queryRadius(casterX, casterZ, radius);

    for (const candidateId of candidates) {
      if (candidateId === casterId) continue;

      const candidate = this.entityManager.getEntity(candidateId);
      if (!candidate) continue;

      // Allies only: same team, living units (excludes projectiles — no UnitStats).
      const candidateStats = candidate.getComponent<StatsComponent>(ComponentType.UnitStats);
      const candidateTeam = candidate.getComponent<TeamComponent>(ComponentType.Team);
      if (!candidateStats?.alive || candidateTeam?.teamId !== casterTeam) continue;

      // Skip allies already at full health to prevent overheal.
      const health = this._abilities.tryGetAttribute(candidateId, 'Health')?.current;
      const maxHealth = this._abilities.tryGetAttribute(candidateId, 'MaxHealth')?.base;
      if (health && maxHealth && FP.Gte(health, maxHealth)) continue;

      this._abilities.applyEffect(candidateId, 'Effect.Heal.Tick', casterId);
    }
  }

  private getSimulationState(): SimulationStateComponent | undefined {
    const [entity] = this.entityManager.queryEntities(ComponentType.SimulationState);
    return entity?.getComponent<SimulationStateComponent>(ComponentType.SimulationState);
  }
}




