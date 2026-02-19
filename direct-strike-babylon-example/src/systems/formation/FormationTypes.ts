import { Mesh, Vector3 } from '@babylonjs/core';
import { TeamTag } from '../../enums/TeamTag';

/**
 * Unit type for formation placement
 */
export type FormationUnitType = 'sphere' | 'mutant' | 'prisma' | 'lance';

/**
 * Represents a cell in the formation grid
 */
export interface GridCell {
  x: number;
  z: number;
  occupied: boolean;
  unitType: FormationUnitType | null;
  previewMesh: Mesh | null;
}

/**
 * Formation grid state for a player
 */
export interface FormationGrid {
  playerId: string;
  team: TeamTag;
  cells: GridCell[][];
  gridWidth: number; // Number of cells wide
  gridHeight: number; // Number of cells tall
  cellSize: number; // Size of each cell in world units
  centerX: number; // World X position of grid center
  centerZ: number; // World Z position of grid center
  // All units placed on the grid (persistent across waves)
  placedUnits: PlacedUnit[];
  // Units that were placed but not yet synced (for backward compatibility)
  pendingUnits: PlacedUnit[];
}

/**
 * Represents a unit placed on the grid
 */
export interface PlacedUnit {
  unitType: FormationUnitType;
  gridX: number;
  gridZ: number;
}

/**
 * Grid coordinates
 */
export interface GridCoords {
  x: number;
  z: number;
}

/**
 * Callback type for creating units
 */
export type CreateUnitCallback = (
  unitType: FormationUnitType,
  team: TeamTag,
  position: Vector3
) => { id: number; position: Vector3 };

/**
 * Callback type for checking affordability
 */
export type CanAffordCallback = (
  playerId: string,
  unitType: FormationUnitType
) => boolean;
