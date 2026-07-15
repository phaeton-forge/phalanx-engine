import * as THREE from 'three';
import { arenaParams } from '../../config/constants';
import type { TeamId } from '../../components';
import { UNIT_GRID_SIZE, type UnitType, type UnitGridSize } from '../../units';
import type {
  FormationGrid,
  GridCell,
  GridCoords,
  PlacedUnit,
} from './FormationTypes';

/**
 * FormationGridData - Manages the data state of formation grids.
 * Pure math/state: no renderer, no input, no ECS. The authoritative mirror of this
 * data lives in the deterministic FormationSystem; this class is safe for local UI.
 */
export class FormationGridData {
  private grids: Map<string, FormationGrid> = new Map();

  /**
   * Get the grid footprint (width along X, depth along Z) for a unit type.
   */
  public getUnitGridSize(unitType: UnitType): UnitGridSize {
    return UNIT_GRID_SIZE[unitType];
  }

  /**
   * Initialize a formation grid for a player.
   * The grid is centered on the team's spawn line, facing the enemy along Z.
   */
  public initializeGrid(playerId: string, team: TeamId): FormationGrid {
    const { gridWidth, gridHeight, cellSize } = arenaParams.formationGrid;

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
      centerX: 0,
      centerZ: team === 0 ? arenaParams.team1SpawnZ : arenaParams.team2SpawnZ,
      placedUnits: [],
      pendingUnits: [],
    };

    this.grids.set(playerId, grid);
    return grid;
  }

  /**
   * Get the grid for a player.
   */
  public getGrid(playerId: string): FormationGrid | undefined {
    return this.grids.get(playerId);
  }

  /**
   * Get all grids.
   */
  public getAllGrids(): Map<string, FormationGrid> {
    return this.grids;
  }

  /**
   * Convert a world position to integer grid coordinates.
   * Returns null when the position is outside the grid.
   */
  public worldToGrid(
    playerId: string,
    worldPos: THREE.Vector3
  ): GridCoords | null {
    const grid = this.grids.get(playerId);
    if (!grid) return null;

    const halfWidth = (grid.gridWidth * grid.cellSize) / 2;
    const halfDepth = (grid.gridHeight * grid.cellSize) / 2;

    const localX = worldPos.x - (grid.centerX - halfWidth);
    const localZ = worldPos.z - (grid.centerZ - halfDepth);

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
   * Convert integer grid coordinates to the world position of the cell center.
   */
  public gridToWorld(
    playerId: string,
    gridX: number,
    gridZ: number
  ): THREE.Vector3 | null {
    const grid = this.grids.get(playerId);
    if (!grid) return null;

    const halfWidth = (grid.gridWidth * grid.cellSize) / 2;
    const halfDepth = (grid.gridHeight * grid.cellSize) / 2;

    const worldX = grid.centerX - halfWidth + (gridX + 0.5) * grid.cellSize;
    const worldZ = grid.centerZ - halfDepth + (gridZ + 0.5) * grid.cellSize;

    return new THREE.Vector3(worldX, 0, worldZ);
  }

  /**
   * Get the world position for a unit's origin cell, offset to the visual center
   * of multi-cell footprints.
   */
  public getWorldPosWithOffset(
    playerId: string,
    gridX: number,
    gridZ: number,
    unitType: UnitType
  ): THREE.Vector3 | null {
    const grid = this.grids.get(playerId);
    if (!grid) return null;

    const worldPos = this.gridToWorld(playerId, gridX, gridZ);
    if (!worldPos) return null;

    const { width, depth } = this.getUnitGridSize(unitType);

    if (width > 1) {
      worldPos.x += (grid.cellSize * (width - 1)) / 2;
    }
    if (depth > 1) {
      worldPos.z += (grid.cellSize * (depth - 1)) / 2;
    }

    return worldPos;
  }

  /**
   * Check whether a unit can be placed with its origin at (gridX, gridZ).
   */
  public canPlaceUnit(
    playerId: string,
    gridX: number,
    gridZ: number,
    unitType: UnitType
  ): boolean {
    const grid = this.grids.get(playerId);
    if (!grid) return false;

    const { width, depth } = this.getUnitGridSize(unitType);

    if (gridX < 0 || gridX + width > grid.gridWidth) return false;
    if (gridZ < 0 || gridZ + depth > grid.gridHeight) return false;

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
   * Check whether a unit can be moved from one position to another.
   * Target cells must be empty, except for cells already occupied by the moving unit.
   */
  public canMoveUnit(
    playerId: string,
    fromGridX: number,
    fromGridZ: number,
    toGridX: number,
    toGridZ: number,
    unitType: UnitType
  ): boolean {
    const grid = this.grids.get(playerId);
    if (!grid) return false;

    const { width, depth } = this.getUnitGridSize(unitType);

    if (toGridX < 0 || toGridX + width > grid.gridWidth) return false;
    if (toGridZ < 0 || toGridZ + depth > grid.gridHeight) return false;

    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < depth; dz++) {
        const targetCell = grid.cells[toGridX + dx][toGridZ + dz];
        if (targetCell.occupied) {
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
   * Find the origin cell (minimum X/Z corner) of the unit occupying (gridX, gridZ).
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
      case 'support':
      case 'volt':
      case 'drone':
        return { x: gridX, z: gridZ };
      case 'rocket':
        return this.findRocketOrigin(grid, gridX, gridZ);
      case 'cube':
        return this.findCubeOrigin(grid, gridX, gridZ);
      default:
        return null;
    }
  }

  /**
   * Find the origin of a Rocket (2x1 footprint) — the left cell of the 2x1 area.
   */
  private findRocketOrigin(
    grid: FormationGrid,
    gridX: number,
    gridZ: number
  ): GridCoords | null {
    for (let dx = 0; dx >= -1; dx--) {
      const checkX = gridX + dx;
      if (checkX >= 0) {
        const checkCell = grid.cells[checkX]?.[gridZ];
        if (checkCell?.unitType === 'rocket') {
          const isOrigin =
            checkX + 1 < grid.gridWidth &&
            grid.cells[checkX][gridZ]?.unitType === 'rocket' &&
            grid.cells[checkX + 1][gridZ]?.unitType === 'rocket';

          if (
            isOrigin &&
            grid.placedUnits.some(
              (u) =>
                u.gridX === checkX &&
                u.gridZ === gridZ &&
                u.unitType === 'rocket'
            )
          ) {
            return { x: checkX, z: gridZ };
          }
        }
      }
    }

    return this.findOriginFromPlacedUnits(grid, gridX, gridZ, 'rocket');
  }

  /**
   * Find the origin of a Cube (2x2 footprint) — the minimum X/Z corner.
   */
  private findCubeOrigin(
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
          if (checkCell?.unitType === 'cube') {
            const isOrigin =
              checkX + 1 < grid.gridWidth &&
              checkZ + 1 < grid.gridHeight &&
              grid.cells[checkX][checkZ]?.unitType === 'cube' &&
              grid.cells[checkX + 1][checkZ]?.unitType === 'cube' &&
              grid.cells[checkX][checkZ + 1]?.unitType === 'cube' &&
              grid.cells[checkX + 1][checkZ + 1]?.unitType === 'cube';

            if (
              isOrigin &&
              grid.placedUnits.some(
                (u) =>
                  u.gridX === checkX &&
                  u.gridZ === checkZ &&
                  u.unitType === 'cube'
              )
            ) {
              return { x: checkX, z: checkZ };
            }
          }
        }
      }
    }

    return this.findOriginFromPlacedUnits(grid, gridX, gridZ, 'cube');
  }

  /**
   * Fallback: locate the unit origin from the placedUnits array.
   */
  private findOriginFromPlacedUnits(
    grid: FormationGrid,
    gridX: number,
    gridZ: number,
    unitType: UnitType
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
   * Place a unit on the grid. Returns true on success.
   */
  public placeUnit(
    playerId: string,
    gridX: number,
    gridZ: number,
    unitType: UnitType
  ): boolean {
    if (!this.canPlaceUnit(playerId, gridX, gridZ, unitType)) {
      return false;
    }

    const grid = this.grids.get(playerId);
    if (!grid) return false;

    const { width, depth } = this.getUnitGridSize(unitType);

    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < depth; dz++) {
        grid.cells[gridX + dx][gridZ + dz].occupied = true;
        grid.cells[gridX + dx][gridZ + dz].unitType = unitType;
      }
    }

    const unitInfo: PlacedUnit = { unitType, gridX, gridZ };
    grid.placedUnits.push(unitInfo);
    grid.pendingUnits.push(unitInfo);

    return true;
  }

  /**
   * Move a unit from one grid position to another.
   */
  public moveUnit(
    playerId: string,
    fromGridX: number,
    fromGridZ: number,
    toGridX: number,
    toGridZ: number
  ): { success: boolean; unitType: UnitType | null } {
    const grid = this.grids.get(playerId);
    if (!grid) return { success: false, unitType: null };

    const cell = grid.cells[fromGridX]?.[fromGridZ];
    if (!cell?.occupied || !cell.unitType) {
      return { success: false, unitType: null };
    }

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

    // Clear old cells.
    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < depth; dz++) {
        const cx = fromGridX + dx;
        const cz = fromGridZ + dz;
        grid.cells[cx][cz].occupied = false;
        grid.cells[cx][cz].unitType = null;
        this.disposePreviewMesh(grid.cells[cx][cz].previewMesh);
        grid.cells[cx][cz].previewMesh = null;
      }
    }

    // Mark new cells as occupied.
    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < depth; dz++) {
        grid.cells[toGridX + dx][toGridZ + dz].occupied = true;
        grid.cells[toGridX + dx][toGridZ + dz].unitType = unitType;
      }
    }

    // Update placedUnits.
    const placedIndex = grid.placedUnits.findIndex(
      (u) => u.gridX === fromGridX && u.gridZ === fromGridZ
    );
    if (placedIndex !== -1) {
      grid.placedUnits[placedIndex].gridX = toGridX;
      grid.placedUnits[placedIndex].gridZ = toGridZ;
    }

    // Update pendingUnits.
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
   * Remove a unit from the grid. Returns the origin and unit type on success.
   */
  public removeUnit(
    playerId: string,
    gridX: number,
    gridZ: number
  ): {
    success: boolean;
    originX: number;
    originZ: number;
    unitType: UnitType | null;
  } {
    const grid = this.grids.get(playerId);
    if (!grid) {
      return { success: false, originX: 0, originZ: 0, unitType: null };
    }

    const cell = grid.cells[gridX]?.[gridZ];
    if (!cell || !cell.occupied) {
      return { success: false, originX: 0, originZ: 0, unitType: null };
    }

    const unitType = cell.unitType;
    if (!unitType) {
      return { success: false, originX: 0, originZ: 0, unitType: null };
    }

    const origin = this.findUnitOrigin(playerId, gridX, gridZ);
    if (!origin) {
      return { success: false, originX: 0, originZ: 0, unitType: null };
    }

    const originX = origin.x;
    const originZ = origin.z;

    const { width, depth } = this.getUnitGridSize(unitType);

    // Clear cells.
    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < depth; dz++) {
        const cx = originX + dx;
        const cz = originZ + dz;
        if (cx < grid.gridWidth && cz < grid.gridHeight) {
          grid.cells[cx][cz].occupied = false;
          grid.cells[cx][cz].unitType = null;
          this.disposePreviewMesh(grid.cells[cx][cz].previewMesh);
          grid.cells[cx][cz].previewMesh = null;
        }
      }
    }

    // Remove from pending units.
    const pendingIndex = grid.pendingUnits.findIndex(
      (u) => u.gridX === originX && u.gridZ === originZ
    );
    if (pendingIndex !== -1) {
      grid.pendingUnits.splice(pendingIndex, 1);
    }

    // Remove from placed units.
    const placedIndex = grid.placedUnits.findIndex(
      (u) => u.gridX === originX && u.gridZ === originZ
    );
    if (placedIndex !== -1) {
      grid.placedUnits.splice(placedIndex, 1);
    }

    return { success: true, originX, originZ, unitType };
  }

  /**
   * Clear the pending-units list after a sync/commit.
   */
  public clearPendingUnits(playerId: string): void {
    const grid = this.grids.get(playerId);
    if (grid) {
      grid.pendingUnits = [];
    }
  }

  /**
   * Get pending units for a player.
   */
  public getPendingUnits(playerId: string): PlacedUnit[] {
    return this.grids.get(playerId)?.pendingUnits ?? [];
  }

  /**
   * Get all placed units for a player.
   */
  public getPlacedUnits(playerId: string): PlacedUnit[] {
    return this.grids.get(playerId)?.placedUnits ?? [];
  }

  /**
   * Get the count of placed units for a player.
   */
  public getPlacedUnitCount(playerId: string): number {
    return this.grids.get(playerId)?.placedUnits.length ?? 0;
  }

  /**
   * Assign a preview mesh to a cell. The data layer only stores the reference;
   * the renderer owns scene lifetime.
   */
  public setCellPreviewMesh(
    playerId: string,
    gridX: number,
    gridZ: number,
    mesh: THREE.Object3D
  ): void {
    const grid = this.grids.get(playerId);
    if (grid && grid.cells[gridX]?.[gridZ]) {
      grid.cells[gridX][gridZ].previewMesh = mesh;
    }
  }

  /**
   * Dispose all grids and release stored preview meshes.
   */
  public dispose(): void {
    for (const grid of this.grids.values()) {
      for (const row of grid.cells) {
        for (const cell of row) {
          this.disposePreviewMesh(cell.previewMesh);
        }
      }
    }
    this.grids.clear();
  }

  private disposePreviewMesh(mesh: THREE.Object3D | null): void {
    if (!mesh) return;

    // Dispose any Mesh-level geometry/material resources. Object3D itself has no dispose().
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];
        materials.forEach((material) => material?.dispose());
      }
    });
  }
}
