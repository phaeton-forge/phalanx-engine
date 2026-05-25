import { GameSystem } from 'phalanx-ecs';
import type { SoAComponentStore, SystemContext } from 'phalanx-ecs';
import type { AbilitySystem } from 'phalanx-abilities';
import { FP } from 'phalanx-math';
import type { FixedPoint } from 'phalanx-math';
import {
  ComponentType,
  ConeBeamComponent,
  SimulationStateComponent,
  TeamComponent,
  TransformSoASchema,
  UnitStatsComponent,
  UnitTypeComponent,
} from '../components';

export class BeamSystem extends GameSystem {
  private get _abilities(): AbilitySystem { return this.abilities as AbilitySystem; }
  private transformStore!: SoAComponentStore<typeof TransformSoASchema.definition>;

  public override init(context: SystemContext): void {
    super.init(context);
    this.transformStore = this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  public override processTick(): void {
    if (!this.getSimulationState()?.active) return;

    const cones = this.entityManager.queryEntities(
      ComponentType.UnitStats,
      ComponentType.UnitType,
      ComponentType.ConeBeam,
      ComponentType.Team,
    );
    const allUnits = this.entityManager.queryEntities(
      ComponentType.UnitStats,
      ComponentType.Team,
      ComponentType.Transform,
    );

    for (const cone of cones) {
      const type = cone.getComponent<UnitTypeComponent>(ComponentType.UnitType);
      if (type?.kind !== 'cone') continue;

      const stats = cone.getComponent<UnitStatsComponent>(ComponentType.UnitStats);
      const beam = cone.getComponent<ConeBeamComponent>(ComponentType.ConeBeam);
      const team = cone.getComponent<TeamComponent>(ComponentType.Team);
      if (!stats?.alive || !beam || !team) continue;

      const coneIdx = this.transformStore.indexOf(cone.id);
      if (coneIdx === -1) continue;

      const coneX = FP.FromRaw(this.transformStore.arrays.fpPositionX[coneIdx]);
      const coneZ = FP.FromRaw(this.transformStore.arrays.fpPositionZ[coneIdx]);

      const [first, second] = this.findTwoNearest(allUnits, team.teamId, cone.id, coneX, coneZ);

      beam.primaryTargetId = first;
      beam.secondaryTargetId = second;

      for (const targetId of [first, second]) {
        if (targetId === null) continue;
        if (!this._abilities.hasTag(targetId, 'State.Illuminated')) {
          this._abilities.applyEffect(targetId, 'Effect.Illuminated', cone.id);
        }
      }

      if (first !== null && !this._abilities.hasTag(first, 'State.Jammed')) {
        this._abilities.applyEffect(first, 'Effect.Jammed', cone.id);
      }
    }
  }

  private findTwoNearest(
    units: ReturnType<typeof this.entityManager.queryEntities>,
    coneTeamId: number,
    coneId: number,
    coneX: FixedPoint,
    coneZ: FixedPoint,
  ): [number | null, number | null] {
    let firstId: number | null = null;
    let secondId: number | null = null;
    let firstDist: FixedPoint | null = null;
    let secondDist: FixedPoint | null = null;

    for (const candidate of units) {
      if (candidate.id === coneId) continue;
      const candidateTeam = candidate.getComponent<TeamComponent>(ComponentType.Team);
      const candidateStats = candidate.getComponent<UnitStatsComponent>(ComponentType.UnitStats);
      if (!candidateStats?.alive || candidateTeam?.teamId === coneTeamId) continue;

      const idx = this.transformStore.indexOf(candidate.id);
      if (idx === -1) continue;

      const dx = FP.Sub(FP.FromRaw(this.transformStore.arrays.fpPositionX[idx]), coneX);
      const dz = FP.Sub(FP.FromRaw(this.transformStore.arrays.fpPositionZ[idx]), coneZ);
      const distSq = FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz));

      const betterThanFirst =
        firstDist === null ||
        FP.Lt(distSq, firstDist) ||
        (FP.Eq(distSq, firstDist) && candidate.id < (firstId ?? Infinity));

      if (betterThanFirst) {
        secondId = firstId;
        secondDist = firstDist;
        firstId = candidate.id;
        firstDist = distSq;
      } else {
        const betterThanSecond =
          secondDist === null ||
          FP.Lt(distSq, secondDist) ||
          (FP.Eq(distSq, secondDist) && candidate.id < (secondId ?? Infinity));
        if (betterThanSecond) {
          secondId = candidate.id;
          secondDist = distSq;
        }
      }
    }

    return [firstId, secondId];
  }

  private getSimulationState(): SimulationStateComponent | undefined {
    const [entity] = this.entityManager.queryEntities(ComponentType.SimulationState);
    return entity?.getComponent<SimulationStateComponent>(ComponentType.SimulationState);
  }
}
