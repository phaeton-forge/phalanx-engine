import { GameSystem } from '@phalanx-engine/ecs';
import type { SoAComponentStore, SystemContext } from '@phalanx-engine/ecs';
import type { AbilitySystem } from '@phalanx-engine/abilities';
import { FP } from '@phalanx-engine/math';
import { PhysicsWorld, TransformSoASchema } from '@phalanx-engine/physics';
import {
  CUBE_MAX_BEAM_TARGETS,
  CUBE_SLOW_TAG,
  CUBE_SPEED_BUFF_TAG,
} from '../config/abilityDefinitions';
import { GameRandom } from '../core/GameRandom';
import {
  ComponentType,
  CubeStateComponent,
  SimulationStateComponent,
  StatsComponent,
  TeamComponent,
  UnitTypeComponent,
} from '../components';

const EFFECT_CUBE_SLOW = 'Effect.Cube.SlowDebuff';
const EFFECT_CUBE_SPEED_BUFF = 'Effect.Cube.SpeedBuff';

/**
 * Cube units maintain up to two enemy slow-beams and two ally speed-beams
 * within their detection radius. Targets are picked deterministically via
 * {@link GameRandom}; effects are applied/removed through phalanx-abilities.
 *
 * Range queries use {@link PhysicsWorld.spatialGrid.queryRadius} — distance is
 * filtered inside the spatial grid (deterministic, id-sorted); game code only
 * applies team/alive/auto-attack/target-state filters on top.
 */
export class CubeTargetingSystem extends GameSystem {
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
    if (!GameRandom.isInitialized()) return;

    const physics = this.physics as PhysicsWorld | undefined;
    if (!physics) return;

    const cubes = this.entityManager.queryEntities(
      ComponentType.CubeState,
      ComponentType.UnitStats,
      ComponentType.Team,
      ComponentType.UnitType,
      ComponentType.Transform,
    );

    for (const cube of cubes) {
      const stats = cube.getComponent<StatsComponent>(ComponentType.UnitStats);
      const cubeState = cube.getComponent<CubeStateComponent>(ComponentType.CubeState);
      const team = cube.getComponent<TeamComponent>(ComponentType.Team);
      const unitType = cube.getComponent<UnitTypeComponent>(ComponentType.UnitType);
      if (!stats || !cubeState || !team || !unitType) continue;

      if (!stats.alive) {
        this.releaseAllTargets(cubeState);
        continue;
      }

      const cubeIndex = this.transformStore.indexOf(cube.id);
      if (cubeIndex === -1) continue;

      const cubeX = FP.FromRaw(this.transformStore.arrays.fpPositionX[cubeIndex]);
      const cubeZ = FP.FromRaw(this.transformStore.arrays.fpPositionZ[cubeIndex]);

      const nearbyIds = physics.spatialGrid.queryRadius(
        cubeX,
        cubeZ,
        unitType.detectionRadius,
      );
      const nearbySet = new Set(nearbyIds);

      this.validateTargets(
        cubeState.enemyTargets,
        CUBE_SLOW_TAG,
        nearbySet,
        (targetTeam) => targetTeam !== team.teamId,
      );

      this.validateTargets(
        cubeState.allyTargets,
        CUBE_SPEED_BUFF_TAG,
        nearbySet,
        (targetTeam) => targetTeam === team.teamId,
      );

      this.acquireTargets(
        cube.id,
        cubeState.enemyTargets,
        EFFECT_CUBE_SLOW,
        team.teamId,
        nearbyIds,
        false,
      );

      this.acquireTargets(
        cube.id,
        cubeState.allyTargets,
        EFFECT_CUBE_SPEED_BUFF,
        team.teamId,
        nearbyIds,
        true,
      );
    }
  }

  private validateTargets(
    targets: number[],
    grantedTag: string,
    nearbySet: ReadonlySet<number>,
    teamFilter: (targetTeam: number) => boolean,
  ): void {
    for (let i = targets.length - 1; i >= 0; i--) {
      const targetId = targets[i];
      if (!this.isValidTarget(targetId, nearbySet, teamFilter)) {
        targets.splice(i, 1);
        this._abilities.removeEffectsByTag(targetId, grantedTag);
        continue;
      }

      if (!this._abilities.hasTag(targetId, grantedTag)) {
        targets.splice(i, 1);
      }
    }
  }

  private acquireTargets(
    cubeId: number,
    targets: number[],
    effectId: string,
    cubeTeamId: number,
    nearbyIds: readonly number[],
    allies: boolean,
  ): void {
    while (targets.length < CUBE_MAX_BEAM_TARGETS) {
      const candidates = this.collectCandidates(
        cubeId,
        cubeTeamId,
        nearbyIds,
        targets,
        allies,
      );
      if (candidates.length === 0) break;

      const picked = GameRandom.rng.pick(candidates);
      targets.push(picked);
      this._abilities.applyEffect(picked, effectId, cubeId);
    }
  }

  private collectCandidates(
    cubeId: number,
    cubeTeamId: number,
    nearbyIds: readonly number[],
    alreadyTargeted: readonly number[],
    allies: boolean,
  ): number[] {
    const candidates: number[] = [];

    for (const unitId of nearbyIds) {
      if (unitId === cubeId) continue;
      if (alreadyTargeted.includes(unitId)) continue;

      const unit = this.entityManager.getEntity(unitId);
      if (!unit) continue;

      const stats = unit.getComponent<StatsComponent>(ComponentType.UnitStats);
      const team = unit.getComponent<TeamComponent>(ComponentType.Team);
      if (!stats?.alive || !team) continue;
      if (!unit.hasComponent(ComponentType.AutoAttackTimer)) continue;

      const isAlly = team.teamId === cubeTeamId;
      if (allies !== isAlly) continue;

      candidates.push(unitId);
    }

    // queryRadius returns id-sorted results; preserve order for determinism.
    return candidates;
  }

  private isValidTarget(
    targetId: number,
    nearbySet: ReadonlySet<number>,
    teamFilter: (targetTeam: number) => boolean,
  ): boolean {
    if (!nearbySet.has(targetId)) return false;

    const entity = this.entityManager.getEntity(targetId);
    if (!entity) return false;

    const stats = entity.getComponent<StatsComponent>(ComponentType.UnitStats);
    const team = entity.getComponent<TeamComponent>(ComponentType.Team);
    if (!stats?.alive || !team || !teamFilter(team.teamId)) return false;
    if (!entity.hasComponent(ComponentType.AutoAttackTimer)) return false;

    return true;
  }

  private releaseAllTargets(cubeState: CubeStateComponent): void {
    for (const targetId of cubeState.enemyTargets) {
      this._abilities.removeEffectsByTag(targetId, CUBE_SLOW_TAG);
    }
    for (const targetId of cubeState.allyTargets) {
      this._abilities.removeEffectsByTag(targetId, CUBE_SPEED_BUFF_TAG);
    }
    cubeState.enemyTargets.length = 0;
    cubeState.allyTargets.length = 0;
  }

  private getSimulationState(): SimulationStateComponent | undefined {
    const [entity] = this.entityManager.queryEntities(ComponentType.SimulationState);
    return entity?.getComponent<SimulationStateComponent>(ComponentType.SimulationState);
  }
}
