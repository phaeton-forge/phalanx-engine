import { GameSystem } from '@phalanx-engine/ecs';
import type { CommandsBatch } from '@phalanx-engine/ecs';
import { arenaParams } from '../config/constants';
import {
  ComponentType,
  SimulationStateComponent,
  type TeamId,
} from '../components';
import { FormationGridData } from './formation';
import type { UnitFactory } from '../units';
import type { UnitType } from '../units';

interface FormationPlayer {
  playerId: string;
  team: TeamId;
}

interface FormationPlaceCommand {
  playerId?: string;
  type: UnitType;
  gridX: number;
  gridZ: number;
}

interface FormationMoveCommand {
  playerId?: string;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
}

interface FormationRemoveCommand {
  playerId?: string;
  gridX: number;
  gridZ: number;
}

/**
 * FormationSystem — deterministic authority for formation placement and deployment.
 *
 * Mirrors local {@link FormationGridData} state inside the simulation world.
 * Placement, move, remove, and ready commands flow through the lockstep command
 * stream so both clients apply identical mutations and reach deploy() on the same tick.
 *
 * When every registered player has sent `formation-ready`, deploy() spawns battle
 * units in front of each grid (sorted by gridZ then gridX) and activates the sim.
 */
export class FormationSystem extends GameSystem {
  private readonly unitFactory: UnitFactory;
  private readonly gridData = new FormationGridData();
  private readonly players = new Map<string, FormationPlayer>();
  private readonly ready = new Set<string>();
  private deployed = false;

  constructor(unitFactory: UnitFactory) {
    super();
    this.unitFactory = unitFactory;
  }

  /**
   * Register a player with their team. Must be called for every participant
   * before commands for that playerId are processed.
   */
  registerPlayer(playerId: string, team: TeamId): void {
    if (this.players.has(playerId)) return;
    this.players.set(playerId, { playerId, team });
    this.gridData.initializeGrid(playerId, team);
  }

  /**
   * Reset the formation authority back to the deployment phase.
   * Keeps the existing placed formations so players can adjust them; only the
   * ready/deployed state is cleared so they can ready up again.
   */
  reset(): void {
    this.deployed = false;
    this.ready.clear();
  }

  /**
   * Process a batch of lockstep commands. Formation mutations and the ready
   * signal are applied here; battle units spawn only after all players ready.
   */
  processCommands(commandsBatch: CommandsBatch): void {
    if (this.deployed) return;

    const state = this.getSimulationState();
    if (!state || state.active) return;

    const sortedPlayerIds = Object.keys(commandsBatch.commands).sort();
    for (const playerId of sortedPlayerIds) {
      const commands = commandsBatch.commands[playerId] ?? [];
      for (const command of commands) {
        this.processCommand(
          command.type,
          command.data,
          command.playerId ?? playerId
        );
      }
    }

    if (this.players.size > 0 && this.ready.size >= this.players.size) {
      this.deploy(state);
    }
  }

  private processCommand(type: string, data: unknown, playerId: string): void {
    if (!this.players.has(playerId)) return;

    switch (type) {
      case 'formation-place': {
        const cmd = data as Partial<FormationPlaceCommand>;
        if (
          (cmd.type !== 'sphere' &&
            cmd.type !== 'cube' &&
            cmd.type !== 'support' &&
            cmd.type !== 'rocket' &&
            cmd.type !== 'volt' &&
            cmd.type !== 'plasmaTank' &&
            cmd.type !== 'sau') ||
          typeof cmd.gridX !== 'number' ||
          !Number.isInteger(cmd.gridX) ||
          typeof cmd.gridZ !== 'number' ||
          !Number.isInteger(cmd.gridZ)
        ) {
          break;
        }
        this.gridData.placeUnit(playerId, cmd.gridX, cmd.gridZ, cmd.type);
        break;
      }
      case 'formation-move': {
        const cmd = data as Partial<FormationMoveCommand>;
        if (
          typeof cmd.fromX !== 'number' ||
          !Number.isInteger(cmd.fromX) ||
          typeof cmd.fromZ !== 'number' ||
          !Number.isInteger(cmd.fromZ) ||
          typeof cmd.toX !== 'number' ||
          !Number.isInteger(cmd.toX) ||
          typeof cmd.toZ !== 'number' ||
          !Number.isInteger(cmd.toZ)
        ) {
          break;
        }
        this.gridData.moveUnit(
          playerId,
          cmd.fromX,
          cmd.fromZ,
          cmd.toX,
          cmd.toZ
        );
        break;
      }
      case 'formation-remove': {
        const cmd = data as Partial<FormationRemoveCommand>;
        if (
          typeof cmd.gridX !== 'number' ||
          !Number.isInteger(cmd.gridX) ||
          typeof cmd.gridZ !== 'number' ||
          !Number.isInteger(cmd.gridZ)
        ) {
          break;
        }
        this.gridData.removeUnit(playerId, cmd.gridX, cmd.gridZ);
        break;
      }
      case 'formation-ready': {
        this.ready.add(playerId);
        break;
      }
    }
  }

  private deploy(state: SimulationStateComponent): void {
    if (this.deployed) return;
    this.deployed = true;

    const sortedPlayerIds = Array.from(this.players.keys()).sort();
    for (const playerId of sortedPlayerIds) {
      const { team } = this.players.get(playerId)!;
      const placedUnits = this.gridData.getPlacedUnits(playerId);
      const sorted = [...placedUnits].sort((a, b) => {
        if (a.gridZ !== b.gridZ) return a.gridZ - b.gridZ;
        return a.gridX - b.gridX;
      });

      const forwardZ = team === 0 ? 1 : -1;
      const { gridHeight, cellSize } = arenaParams.formationGrid;
      const halfDepth = (gridHeight * cellSize) / 2;
      const deployGap = arenaParams.formationGrid.deployGap ?? 0;
      const zOffset = (halfDepth + deployGap) * forwardZ;

      for (const unit of sorted) {
        const worldPos = this.gridData.getWorldPosWithOffset(
          playerId,
          unit.gridX,
          unit.gridZ,
          unit.unitType
        );
        if (!worldPos) continue;

        const def = this.unitFactory.getDefinition(unit.unitType);
        const pos = {
          x: worldPos.x,
          y: def.heightOffset,
          z: worldPos.z + zOffset,
        };

        const entity = this.unitFactory.spawnBattleUnit(
          unit.unitType,
          team,
          pos
        );
        this.entityManager.addEntity(entity);

        if (def.aura && this.abilities) {
          this.abilities.activateAbility(entity.id, 'Ability.HealAura');
        }
      }
    }

    state.active = true;
  }

  private getSimulationState(): SimulationStateComponent | undefined {
    const [stateEntity] = this.entityManager.queryEntities(
      ComponentType.SimulationState
    );
    return stateEntity?.getComponent<SimulationStateComponent>(
      ComponentType.SimulationState
    );
  }
}
