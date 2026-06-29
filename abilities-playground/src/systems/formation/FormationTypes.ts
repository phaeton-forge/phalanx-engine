import type * as THREE from 'three';
import type { TeamId } from '../../components';
import type { UnitType } from '../../units/UnitType';

/**
 * Represents a cell in the formation grid.
 * The preview mesh is purely cosmetic and stored only for local presentation.
 */
export interface GridCell {
  x: number;
  z: number;
  occupied: boolean;
  unitType: UnitType | null;
  previewMesh: THREE.Object3D | null;
}

/**
 * Formation grid state for a player.
 */
export interface FormationGrid {
  playerId: string;
  team: TeamId;
  cells: GridCell[][];
  /** Number of cells along the X axis. */
  gridWidth: number;
  /** Number of cells along the Z axis (depth toward the enemy). */
  gridHeight: number;
  /** Size of each cell in world units. */
  cellSize: number;
  /** World X position of the grid center. */
  centerX: number;
  /** World Z position of the grid center (on the team's spawn line). */
  centerZ: number;
  /** All units currently placed on the grid. */
  placedUnits: PlacedUnit[];
  /** Units placed but not yet synced (kept for parity with the direct-strike data layer). */
  pendingUnits: PlacedUnit[];
}

/**
 * A unit placed on the grid.
 */
export interface PlacedUnit {
  unitType: UnitType;
  gridX: number;
  gridZ: number;
}

/**
 * Integer grid coordinates.
 */
export interface GridCoords {
  x: number;
  z: number;
}
