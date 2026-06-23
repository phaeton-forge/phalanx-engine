import type { PlayerCommand } from '@phalanx-engine/ecs';

/**
 * Network command types for the lockstep synchronization system
 * All game commands are sent through the network and executed deterministically
 */

/**
 * Move command data - directs an entity to a target position
 */
export interface MoveCommandData {
  entityId: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

/**
 * Network move command
 */
export interface NetworkMoveCommand extends PlayerCommand {
  type: 'move';
  data: MoveCommandData;
}

/**
 * Place unit command data - places a unit on the formation grid
 */
export interface PlaceUnitCommandData {
  unitType: 'sphere' | 'mutant' | 'prisma' | 'lance';
  gridX: number;
  gridZ: number;
}

/**
 * Network place unit command
 */
export interface NetworkPlaceUnitCommand extends PlayerCommand {
  type: 'placeUnit';
  data: PlaceUnitCommandData;
}

/**
 * Deploy units command data - deploys all pending units from formation grid
 */
export interface DeployUnitsCommandData {
  playerId: string;
}

/**
 * Network deploy units command
 */
export interface NetworkDeployUnitsCommand extends PlayerCommand {
  type: 'deployUnits';
  data: DeployUnitsCommandData;
}

/**
 * Move grid unit command data - moves a unit from one grid cell to another
 */
export interface MoveGridUnitCommandData {
  fromGridX: number;
  fromGridZ: number;
  toGridX: number;
  toGridZ: number;
}

/**
 * Network move grid unit command
 */
export interface NetworkMoveGridUnitCommand extends PlayerCommand {
  type: 'moveGridUnit';
  data: MoveGridUnitCommandData;
}

/**
 * Union type of all network commands
 */
export type NetworkCommand =
  | NetworkMoveCommand
  | NetworkPlaceUnitCommand
  | NetworkDeployUnitsCommand
  | NetworkMoveGridUnitCommand;
