import { Vector3 } from '@babylonjs/core';
import type { PhalanxClient } from '@phalanx-engine/client';
import type {
  EventBus,
  CommandsBatch,
  PlayerCommand,
} from '@phalanx-engine/ecs';
import type { MovementSystem } from '../systems/MovementSystem';
import type { FormationGridSystem } from '../systems/FormationGridSystem';
import { TeamTag } from '../enums/TeamTag';
import { GameEvents, createEvent } from '../events';
import type {
  NetworkCommand,
  NetworkMoveCommand,
  NetworkPlaceUnitCommand,
  NetworkMoveGridUnitCommand,
} from './NetworkCommands';

/**
 * Callbacks for LockstepManager to interact with the game
 */
export interface LockstepCallbacks {
  /** Called when cleanup is needed after simulation tick */
  onCleanupNeeded: () => void;
  /** Called to show a notification to the user */
  onNotification: (message: string, type: 'info' | 'warning') => void;
  /** Called to update the commit button UI */
  onCommitButtonUpdate: () => void;
  /** Get the local player's team */
  getLocalTeam: () => TeamTag;
  /** Get the local player's ID */
  getLocalPlayerId: () => string;
}

/**
 * Systems required by LockstepManager for command execution
 * Note: Tick processing is now delegated to SystemRegistry
 */
export interface LockstepSystems {
  movementSystem: MovementSystem;
  formationGridSystem: FormationGridSystem;
  eventBus: EventBus;
}

/**
 * LockstepManager - Handles deterministic command execution
 *
 * Responsible for:
 * - Executing commands received from the network
 * - Sending local commands to the server
 *
 * Tick processing is handled automatically by GameWorld (via lifecycle hooks).
 * Network synchronization and timing are delegated to PhalanxClient.
 */
export class LockstepManager {
  private systems: LockstepSystems;
  private callbacks: LockstepCallbacks;
  private client: PhalanxClient;

  constructor(
    client: PhalanxClient,
    systems: LockstepSystems,
    callbacks: LockstepCallbacks
  ) {
    this.client = client;
    this.systems = systems;
    this.callbacks = callbacks;
  }

  /**
   * Process a tick with commands from all players
   * This is called via GameWorld's beforeTick hook, before tick systems run.
   */
  public processTick(_tick: number, commandsBatch: CommandsBatch): void {
    // Flatten commands from all players in deterministic order
    // Sort player IDs to ensure consistent command ordering across all clients
    const allCommands: PlayerCommand[] = [];
    const sortedPlayerIds = Object.keys(commandsBatch.commands).sort();
    for (const playerId of sortedPlayerIds) {
      allCommands.push(...commandsBatch.commands[playerId]);
    }

    // Execute all commands for this tick
    this.executeTickCommands(allCommands);
  }

  /**
   * Cleanup destroyed entities after tick processing.
   * Called via GameWorld's afterTick hook, after tick systems have run.
   */
  public cleanup(): void {
    this.callbacks.onCleanupNeeded();
  }

  /**
   * Queue a command to be sent to the server
   * Commands are automatically flushed by PhalanxClient each frame
   */
  public queueCommand(command: NetworkCommand): void {
    this.client.sendCommand(command.type, command.data);
  }

  /**
   * Execute all commands for a single tick
   * Commands from ALL players are executed - no skipping of "own" commands
   */
  public executeTickCommands(commands: PlayerCommand[]): void {
    for (const cmd of commands) {
      this.executeCommand(cmd);
    }
  }

  /**
   * Execute a single command by dispatching to the appropriate handler
   */
  private executeCommand(cmd: PlayerCommand): void {
    switch (cmd.type) {
      case 'move':
        this.handleMoveCommand(cmd as NetworkMoveCommand);
        break;
      case 'placeUnit':
        this.handlePlaceUnitCommand(cmd as NetworkPlaceUnitCommand);
        break;
      case 'deployUnits':
        this.handleDeployUnitsCommand(cmd);
        break;
      case 'moveGridUnit':
        this.handleMoveGridUnitCommand(cmd as NetworkMoveGridUnitCommand);
        break;
      default:
        console.warn(`[Lockstep] Unknown command type: ${cmd.type}`);
    }
  }

  /**
   * Extract playerId from command, logging a warning if missing
   */
  private getCommandPlayerId(
    cmd: PlayerCommand,
    commandType: string
  ): string | null {
    const playerId = cmd.playerId;
    if (!playerId) {
      console.warn(
        `[Lockstep] ${commandType} command missing playerId:`,
        JSON.stringify(cmd)
      );
      return null;
    }
    return playerId;
  }

  /**
   * Determine team for a player based on whether they are local or opponent
   */
  private getTeamForPlayer(playerId: string): TeamTag {
    const localTeam = this.callbacks.getLocalTeam();
    const localPlayerId = this.callbacks.getLocalPlayerId();
    return playerId === localPlayerId
      ? localTeam
      : localTeam === TeamTag.Team1
        ? TeamTag.Team2
        : TeamTag.Team1;
  }

  /**
   * Handle move command - directs an entity to a target position
   */
  private handleMoveCommand(cmd: NetworkMoveCommand): void {
    const { entityId, targetX, targetY, targetZ } = cmd.data;
    this.systems.movementSystem.moveEntityTo(
      entityId,
      new Vector3(targetX, targetY, targetZ)
    );
  }

  /**
   * Handle place unit command - places a unit on the formation grid
   */
  private handlePlaceUnitCommand(cmd: NetworkPlaceUnitCommand): void {
    const playerId = this.getCommandPlayerId(cmd, 'placeUnit');
    if (!playerId) return;

    const { unitType, gridX, gridZ } = cmd.data;
    if (
      this.systems.formationGridSystem.placeUnit(
        playerId,
        gridX,
        gridZ,
        unitType
      )
    ) {
      const team = this.getTeamForPlayer(playerId);

      this.systems.eventBus.emit(GameEvents.UNIT_PURCHASE_REQUESTED, {
        ...createEvent(),
        playerId,
        team,
        unitType,
        gridPosition: { x: gridX, z: gridZ },
      });
    }
  }

  /**
   * Handle deploy units command - commits all pending units from formation grid
   */
  private handleDeployUnitsCommand(cmd: PlayerCommand): void {
    const playerId = this.getCommandPlayerId(cmd, 'deployUnits');
    if (!playerId) return;
    const unitCount =
      this.systems.formationGridSystem.commitFormation(playerId);

    if (playerId === this.callbacks.getLocalPlayerId()) {
      if (unitCount > 0) {
        this.callbacks.onNotification(`Deployed ${unitCount} units!`, 'info');
      }
      this.callbacks.onCommitButtonUpdate();
    }
  }

  /**
   * Handle move grid unit command - moves a unit from one grid cell to another
   */
  private handleMoveGridUnitCommand(cmd: NetworkMoveGridUnitCommand): void {
    const playerId = this.getCommandPlayerId(cmd, 'moveGridUnit');
    if (!playerId) return;

    const { fromGridX, fromGridZ, toGridX, toGridZ } = cmd.data;

    this.systems.formationGridSystem.moveUnit(
      playerId,
      fromGridX,
      fromGridZ,
      toGridX,
      toGridZ
    );
  }
}
