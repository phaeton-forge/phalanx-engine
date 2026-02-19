import { Vector3 } from '@babylonjs/core';
import { TeamTag } from '../../enums/TeamTag';
import { arenaParams } from '../../config/constants';
import { UnitGridSize } from '../../components';
import type {
  FormationUnitType,
  FormationGrid,
  GridCell,
  GridCoords,
  PlacedUnit,
} from './FormationTypes';

/**
 * FormationGridData - Manages the data state of formation grids
 * Responsible for grid initialization, coordinate conversions, and unit placement logic
 */
export class FormationGridData {
  private grids: Map<string, FormationGrid> = new Map();

  /**
   * Get the grid size (width and depth) for a unit type
   * Uses the centralized UnitGridSize configuration
   */
  public getUnitGridSize(unitType: FormationUnitType): {
    width: number;
    depth: number;
  } {
    const size = UnitGridSize[unitType];
    return { width: size.width, depth: size.height };
  }

  /**
   * Initialize formation grid for a player
   */
  public initializeGrid(playerId: string, team: TeamTag): FormationGrid {
    const gridConfig = arenaParams.formationGrid;
    const teamConfig =
      team === TeamTag.Team1 ? arenaParams.teamA : arenaParams.teamB;

    const gridWidth = 10; // 10 cells wide
    const gridHeight = 20; // 20 cells tall
    const cellSize = gridConfig.gridSpacing;

    // Initialize cells
    const cells: GridCell[][] = [];
    for (let x = 0; x < gridWidth; x++) {
      cells[x] = [];
      for (let z = 0; z < gridHeight; z++) {
        cells[x][z] = {
          x,
          z,
          occupied: false,
          unitType: null,
          previewMesh: null,
        };
      }
    }

    const grid: FormationGrid = {
      playerId,
      team,
      cells,
      gridWidth,
      gridHeight,
      cellSize,
      centerX: teamConfig.formationGridCenter.x,
      centerZ: teamConfig.formationGridCenter.z,
      placedUnits: [],
      pendingUnits: [],
    };

    this.grids.set(playerId, grid);
    return grid;
  }

  /**
   * Get the grid for a player
   */
  public getGrid(playerId: string): FormationGrid | undefined {
    return this.grids.get(playerId);
  }

  /**
   * Get all grids
   */
  public getAllGrids(): Map<string, FormationGrid> {
    return this.grids;
  }

  /**
   * Convert world position to grid coordinates
   */
  public worldToGrid(playerId: string, worldPos: Vector3): GridCoords | null {
    const grid = this.grids.get(playerId);
    if (!grid) return null;

    const halfWidth = (grid.gridWidth * grid.cellSize) / 2;
    const halfHeight = (grid.gridHeight * grid.cellSize) / 2;

    const localX = worldPos.x - (grid.centerX - halfWidth);
    const localZ = worldPos.z - (grid.centerZ - halfHeight);

    const gridX = Math.floor(localX / grid.cellSize);
    const gridZ = Math.floor(localZ / grid.cellSize);

    if (
      gridX < 0 ||
      gridX >= grid.gridWidth ||
      gridZ < 0 ||
      gridZ >= grid.gridHeight
    ) {
      return null;
    }

    return { x: gridX, z: gridZ };
  }

  /**
   * Convert grid coordinates to world position
   */
  public gridToWorld(
    playerId: string,
    gridX: number,
    gridZ: number
  ): Vector3 | null {
    const grid = this.grids.get(playerId);
    if (!grid) return null;

    const halfWidth = (grid.gridWidth * grid.cellSize) / 2;
    const halfHeight = (grid.gridHeight * grid.cellSize) / 2;

    const worldX = grid.centerX - halfWidth + (gridX + 0.5) * grid.cellSize;
    const worldZ = grid.centerZ - halfHeight + (gridZ + 0.5) * grid.cellSize;

    return new Vector3(worldX, 1, worldZ);
  }

  /**
   * Get world position with multi-cell unit offset
   */
  public getWorldPosWithOffset(
    playerId: string,
    gridX: number,
    gridZ: number,
    unitType: FormationUnitType
  ): Vector3 | null {
    const grid = this.grids.get(playerId);
    if (!grid) return null;

    const worldPos = this.gridToWorld(playerId, gridX, gridZ);
    if (!worldPos) return null;

    const { width, depth } = this.getUnitGridSize(unitType);

    // Offset for larger units (center of multi-cell units)
    if (width > 1) {
      worldPos.x += (grid.cellSize * (width - 1)) / 2;
    }
    if (depth > 1) {
      worldPos.z += (grid.cellSize * (depth - 1)) / 2;
    }

    return worldPos;
  }

  /**
   * Check if a position is valid for placing a unit
   */
  public canPlaceUnit(
    playerId: string,
    gridX: number,
    gridZ: number,
    unitType: FormationUnitType
  ): boolean {
    const grid = this.grids.get(playerId);
    if (!grid) return false;

    const { width, depth } = this.getUnitGridSize(unitType);

    // Check bounds
    if (gridX < 0 || gridX + width > grid.gridWidth) return false;
    if (gridZ < 0 || gridZ + depth > grid.gridHeight) return false;

    // Check if cells are occupied
    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < depth; dz++) {
        if (grid.cells[gridX + dx][gridZ + dz].occupied) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Check if a unit can be moved from one position to another
   * The target cells must be empty (excluding the unit being moved)
   */
  public canMoveUnit(
    playerId: string,
    fromGridX: number,
    fromGridZ: number,
    toGridX: number,
    toGridZ: number,
    unitType: FormationUnitType
  ): boolean {
    const grid = this.grids.get(playerId);
    if (!grid) return false;

    const { width, depth } = this.getUnitGridSize(unitType);

    // Check bounds for target position
    if (toGridX < 0 || toGridX + width > grid.gridWidth) return false;
    if (toGridZ < 0 || toGridZ + depth > grid.gridHeight) return false;

    // Check if target cells are occupied (ignoring cells occupied by the unit being moved)
    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < depth; dz++) {
        const targetCell = grid.cells[toGridX + dx][toGridZ + dz];
        if (targetCell.occupied) {
          // Check if this cell is part of the source unit
          const isPartOfSource =
            toGridX + dx >= fromGridX &&
            toGridX + dx < fromGridX + width &&
            toGridZ + dz >= fromGridZ &&
            toGridZ + dz < fromGridZ + depth;
          if (!isPartOfSource) {
            return false;
          }
        }
      }
    }

    return true;
  }

  /**
   * Find the origin cell (top-left corner) of a unit at a given position
   */
  public findUnitOrigin(
    playerId: string,
    gridX: number,
    gridZ: number
  ): GridCoords | null {
    const grid = this.grids.get(playerId);
    if (!grid) return null;

    const cell = grid.cells[gridX]?.[gridZ];
    if (!cell?.occupied || !cell.unitType) return null;

    const unitType = cell.unitType;

    switch (unitType) {
      case 'sphere':
      case 'mutant':
        return { x: gridX, z: gridZ };
      case 'lance':
        return this.findLanceOrigin(grid, gridX, gridZ);
      case 'prisma':
        return this.findPrismaOrigin(grid, gridX, gridZ);
      default:
        return null;
    }
  }

  /**
   * Find origin for lance unit (2x1) - finds the left cell of the 2x1 area
   */
  private findLanceOrigin(
    grid: FormationGrid,
    gridX: number,
    gridZ: number
  ): GridCoords | null {
    // Lance is 2x1 (2 cells wide along X, 1 cell deep along Z)
    for (let dx = 0; dx >= -1; dx--) {
      const checkX = gridX + dx;
      if (checkX >= 0) {
        const checkCell = grid.cells[checkX]?.[gridZ];
        if (checkCell?.unitType === 'lance') {
          const isOrigin =
            checkX + 1 < grid.gridWidth &&
            grid.cells[checkX][gridZ]?.unitType === 'lance' &&
            grid.cells[checkX + 1][gridZ]?.unitType === 'lance';

          if (isOrigin) {
            const hasPlacedUnit = grid.placedUnits.some(
              (u) =>
                u.gridX === checkX &&
                u.gridZ === gridZ &&
                u.unitType === 'lance'
            );
            if (hasPlacedUnit) {
              return { x: checkX, z: gridZ };
            }
          }
        }
      }
    }

    return this.findOriginFromPlacedUnits(grid, gridX, gridZ, 'lance');
  }

  /**
   * Find origin for prisma unit (2x2) - finds the top-left corner of the 2x2 area
   */
  private findPrismaOrigin(
    grid: FormationGrid,
    gridX: number,
    gridZ: number
  ): GridCoords | null {
    for (let dx = 0; dx >= -1; dx--) {
      for (let dz = 0; dz >= -1; dz--) {
        const checkX = gridX + dx;
        const checkZ = gridZ + dz;
        if (checkX >= 0 && checkZ >= 0) {
          const checkCell = grid.cells[checkX]?.[checkZ];
          if (checkCell?.unitType === 'prisma') {
            const isOrigin =
              checkX + 1 < grid.gridWidth &&
              checkZ + 1 < grid.gridHeight &&
              grid.cells[checkX][checkZ]?.unitType === 'prisma' &&
              grid.cells[checkX + 1][checkZ]?.unitType === 'prisma' &&
              grid.cells[checkX][checkZ + 1]?.unitType === 'prisma' &&
              grid.cells[checkX + 1][checkZ + 1]?.unitType === 'prisma';

            if (isOrigin) {
              const hasPlacedUnit = grid.placedUnits.some(
                (u) =>
                  u.gridX === checkX &&
                  u.gridZ === checkZ &&
                  u.unitType === 'prisma'
              );
              if (hasPlacedUnit) {
                return { x: checkX, z: checkZ };
              }
            }
          }
        }
      }
    }

    return this.findOriginFromPlacedUnits(grid, gridX, gridZ, 'prisma');
  }

  /**
   * Fallback method to find unit origin from placedUnits array
   */
  private findOriginFromPlacedUnits(
    grid: FormationGrid,
    gridX: number,
    gridZ: number,
    unitType: FormationUnitType
  ): GridCoords | null {
    const { width, depth } = this.getUnitGridSize(unitType);

    for (const unit of grid.placedUnits) {
      if (unit.unitType === unitType) {
        if (
          gridX >= unit.gridX &&
          gridX < unit.gridX + width &&
          gridZ >= unit.gridZ &&
          gridZ < unit.gridZ + depth
        ) {
          return { x: unit.gridX, z: unit.gridZ };
        }
      }
    }

    return null;
  }

  /**
   * Place a unit on the formation grid (data only)
   */
  public placeUnit(
    playerId: string,
    gridX: number,
    gridZ: number,
    unitType: FormationUnitType
  ): boolean {
    if (!this.canPlaceUnit(playerId, gridX, gridZ, unitType)) {
      return false;
    }

    const grid = this.grids.get(playerId);
    if (!grid) return false;

    const { width, depth } = this.getUnitGridSize(unitType);

    // Mark cells as occupied
    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < depth; dz++) {
        grid.cells[gridX + dx][gridZ + dz].occupied = true;
        grid.cells[gridX + dx][gridZ + dz].unitType = unitType;
      }
    }

    // Add to placed units and pending units
    const unitInfo: PlacedUnit = { unitType, gridX, gridZ };
    grid.placedUnits.push(unitInfo);
    grid.pendingUnits.push(unitInfo);

    return true;
  }

  /**
   * Move a unit from one grid position to another (data only)
   */
  public moveUnit(
    playerId: string,
    fromGridX: number,
    fromGridZ: number,
    toGridX: number,
    toGridZ: number
  ): { success: boolean; unitType: FormationUnitType | null } {
    const grid = this.grids.get(playerId);
    if (!grid) return { success: false, unitType: null };

    const cell = grid.cells[fromGridX]?.[fromGridZ];
    if (!cell?.occupied || !cell.unitType)
      return { success: false, unitType: null };

    const unitType = cell.unitType;

    if (
      !this.canMoveUnit(
        playerId,
        fromGridX,
        fromGridZ,
        toGridX,
        toGridZ,
        unitType
      )
    ) {
      return { success: false, unitType: null };
    }

    const { width, depth } = this.getUnitGridSize(unitType);

    // Clear old cells
    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < depth; dz++) {
        const cx = fromGridX + dx;
        const cz = fromGridZ + dz;
        grid.cells[cx][cz].occupied = false;
        grid.cells[cx][cz].unitType = null;
        if (grid.cells[cx][cz].previewMesh) {
          grid.cells[cx][cz].previewMesh.dispose();
          grid.cells[cx][cz].previewMesh = null;
        }
      }
    }

    // Mark new cells as occupied
    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < depth; dz++) {
        grid.cells[toGridX + dx][toGridZ + dz].occupied = true;
        grid.cells[toGridX + dx][toGridZ + dz].unitType = unitType;
      }
    }

    // Update placedUnits
    const placedIndex = grid.placedUnits.findIndex(
      (u) => u.gridX === fromGridX && u.gridZ === fromGridZ
    );
    if (placedIndex !== -1) {
      grid.placedUnits[placedIndex].gridX = toGridX;
      grid.placedUnits[placedIndex].gridZ = toGridZ;
    }

    // Update pendingUnits
    const pendingIndex = grid.pendingUnits.findIndex(
      (u) => u.gridX === fromGridX && u.gridZ === fromGridZ
    );
    if (pendingIndex !== -1) {
      grid.pendingUnits[pendingIndex].gridX = toGridX;
      grid.pendingUnits[pendingIndex].gridZ = toGridZ;
    }

    return { success: true, unitType };
  }

  /**
   * Remove a unit from the formation grid (data only)
   */
  public removeUnit(
    playerId: string,
    gridX: number,
    gridZ: number
  ): {
    success: boolean;
    originX: number;
    originZ: number;
    unitType: FormationUnitType | null;
  } {
    const grid = this.grids.get(playerId);
    if (!grid)
      return { success: false, originX: 0, originZ: 0, unitType: null };

    const cell = grid.cells[gridX]?.[gridZ];
    if (!cell || !cell.occupied)
      return { success: false, originX: 0, originZ: 0, unitType: null };

    const unitType = cell.unitType;
    if (!unitType)
      return { success: false, originX: 0, originZ: 0, unitType: null };

    // Find the origin cell
    const origin = this.findUnitOrigin(playerId, gridX, gridZ);
    if (!origin)
      return { success: false, originX: 0, originZ: 0, unitType: null };

    const originX = origin.x;
    const originZ = origin.z;

    const { width, depth } = this.getUnitGridSize(unitType);

    // Clear cells
    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < depth; dz++) {
        const cx = originX + dx;
        const cz = originZ + dz;
        if (cx < grid.gridWidth && cz < grid.gridHeight) {
          grid.cells[cx][cz].occupied = false;
          grid.cells[cx][cz].unitType = null;
          if (grid.cells[cx][cz].previewMesh) {
            grid.cells[cx][cz].previewMesh.dispose();
            grid.cells[cx][cz].previewMesh = null;
          }
        }
      }
    }

    // Remove from pending units
    const index = grid.pendingUnits.findIndex(
      (u) => u.gridX === originX && u.gridZ === originZ
    );
    if (index !== -1) {
      grid.pendingUnits.splice(index, 1);
    }

    // Remove from placed units
    const placedIndex = grid.placedUnits.findIndex(
      (u) => u.gridX === originX && u.gridZ === originZ
    );
    if (placedIndex !== -1) {
      grid.placedUnits.splice(placedIndex, 1);
    }

    return { success: true, originX, originZ, unitType };
  }

  /**
   * Clear pending units after commit (they've been synced)
   */
  public clearPendingUnits(playerId: string): void {
    const grid = this.grids.get(playerId);
    if (grid) {
      grid.pendingUnits = [];
    }
  }

  /**
   * Get the pending units for a player
   */
  public getPendingUnits(playerId: string): PlacedUnit[] {
    return this.grids.get(playerId)?.pendingUnits ?? [];
  }

  /**
   * Get all placed units for a player
   */
  public getPlacedUnits(playerId: string): PlacedUnit[] {
    return this.grids.get(playerId)?.placedUnits ?? [];
  }

  /**
   * Get the count of placed units for a player
   */
  public getPlacedUnitCount(playerId: string): number {
    return this.grids.get(playerId)?.placedUnits.length ?? 0;
  }

  /**
   * Set preview mesh for a cell
   */
  public setCellPreviewMesh(
    playerId: string,
    gridX: number,
    gridZ: number,
    mesh: import('@babylonjs/core').Mesh
  ): void {
    const grid = this.grids.get(playerId);
    if (grid && grid.cells[gridX]?.[gridZ]) {
      grid.cells[gridX][gridZ].previewMesh = mesh;
    }
  }

  /**
   * Cleanup
   */
  public dispose(): void {
    // Dispose preview meshes in cells
    for (const grid of this.grids.values()) {
      for (const row of grid.cells) {
        for (const cell of row) {
          if (cell.previewMesh) {
            cell.previewMesh.dispose();
          }
        }
      }
    }
    this.grids.clear();
  }
}
