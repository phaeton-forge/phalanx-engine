import { GameSystem } from 'phalanx-ecs';
import type { CommandsBatch } from 'phalanx-ecs';
import { ComponentType, SimulationStateComponent } from '../components';

export class StartSimulationSystem extends GameSystem {
  processCommands(commandsBatch: CommandsBatch): void {
    const state = this.getSimulationState();
    if (!state || state.active) return;

    const sortedPlayerIds = Object.keys(commandsBatch.commands).sort();
    for (const playerId of sortedPlayerIds) {
      const commands = commandsBatch.commands[playerId] ?? [];
      for (const command of commands) {
        if (command.type !== 'start-simulation') continue;
        state.active = true;
        state.startedByPlayerId = command.playerId ?? playerId;
        return;
      }
    }
  }

  isActive(): boolean {
    return this.getSimulationState()?.active ?? false;
  }

  private getSimulationState(): SimulationStateComponent | undefined {
    const [stateEntity] = this.entityManager.queryEntities(
      ComponentType.SimulationState,
    );
    return stateEntity?.getComponent<SimulationStateComponent>(
      ComponentType.SimulationState,
    );
  }
}
