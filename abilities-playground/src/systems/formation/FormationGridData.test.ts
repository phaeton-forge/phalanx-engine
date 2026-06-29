import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { FormationGridData } from './FormationGridData';
import { UnitType } from '../../units/UnitType';
import { arenaParams } from '../../config/constants';

const PLAYER_ID = 'player-1';
const TEAM = 0 as const;

describe('FormationGridData', () => {
  let data: FormationGridData;

  beforeEach(() => {
    data = new FormationGridData();
    data.initializeGrid(PLAYER_ID, TEAM);
  });

  describe('grid initialization', () => {
    it('creates a grid with the configured width, height, and cell size', () => {
      const grid = data.getGrid(PLAYER_ID)!;
      expect(grid.gridWidth).toBe(arenaParams.formationGrid.gridWidth);
      expect(grid.gridHeight).toBe(arenaParams.formationGrid.gridHeight);
      expect(grid.cellSize).toBe(arenaParams.formationGrid.cellSize);
      expect(grid.cells.length).toBe(grid.gridWidth);
      expect(grid.cells[0].length).toBe(grid.gridHeight);
    });

    it('centers the grid on the team spawn line', () => {
      const grid = data.getGrid(PLAYER_ID)!;
      expect(grid.centerX).toBe(0);
      expect(grid.centerZ).toBe(arenaParams.team1SpawnZ);
    });
  });

  describe('coordinate conversion', () => {
    it('round-trips grid coordinates through world space', () => {
      const grid = data.getGrid(PLAYER_ID)!;
      for (const x of [0, 5, grid.gridWidth - 1]) {
        for (const z of [0, 3, grid.gridHeight - 1]) {
          const worldPos = data.gridToWorld(PLAYER_ID, x, z)!;
          const gridCoords = data.worldToGrid(PLAYER_ID, worldPos)!;
          expect(gridCoords).toEqual({ x, z });
        }
      }
    });

    it('returns null for world positions outside the grid', () => {
      const grid = data.getGrid(PLAYER_ID)!;
      const halfWidth = (grid.gridWidth * grid.cellSize) / 2;
      const halfDepth = (grid.gridHeight * grid.cellSize) / 2;

      expect(
        data.worldToGrid(
          PLAYER_ID,
          new THREE.Vector3(grid.centerX + halfWidth + 1, 0, grid.centerZ)
        )
      ).toBeNull();
      expect(
        data.worldToGrid(
          PLAYER_ID,
          new THREE.Vector3(grid.centerX - halfWidth - 1, 0, grid.centerZ)
        )
      ).toBeNull();
      expect(
        data.worldToGrid(
          PLAYER_ID,
          new THREE.Vector3(grid.centerX, 0, grid.centerZ + halfDepth + 1)
        )
      ).toBeNull();
      expect(
        data.worldToGrid(
          PLAYER_ID,
          new THREE.Vector3(grid.centerX, 0, grid.centerZ - halfDepth - 1)
        )
      ).toBeNull();
    });

    it('centers multi-cell units via getWorldPosWithOffset', () => {
      const cubeCenter = data.getWorldPosWithOffset(
        PLAYER_ID,
        0,
        0,
        UnitType.Cube
      )!;
      const cell0 = data.gridToWorld(PLAYER_ID, 0, 0)!;
      const cell1 = data.gridToWorld(PLAYER_ID, 1, 1)!;

      expect(cubeCenter.x).toBeCloseTo((cell0.x + cell1.x) / 2);
      expect(cubeCenter.z).toBeCloseTo((cell0.z + cell1.z) / 2);
    });
  });

  describe('1x1 units', () => {
    it('places a sphere', () => {
      expect(data.placeUnit(PLAYER_ID, 0, 0, UnitType.Sphere)).toBe(true);
      expect(data.getPlacedUnitCount(PLAYER_ID)).toBe(1);
      expect(data.getPlacedUnits(PLAYER_ID)[0]).toEqual({
        unitType: UnitType.Sphere,
        gridX: 0,
        gridZ: 0,
      });
      expect(data.getGrid(PLAYER_ID)!.cells[0][0].occupied).toBe(true);
    });

    it('places a support unit', () => {
      expect(data.placeUnit(PLAYER_ID, 5, 2, UnitType.Support)).toBe(true);
      expect(data.getGrid(PLAYER_ID)!.cells[5][2].unitType).toBe(
        UnitType.Support
      );
    });

    it('rejects placement out of bounds', () => {
      expect(data.placeUnit(PLAYER_ID, -1, 0, UnitType.Sphere)).toBe(false);
      expect(data.placeUnit(PLAYER_ID, 0, -1, UnitType.Sphere)).toBe(false);
      const grid = data.getGrid(PLAYER_ID)!;
      expect(
        data.placeUnit(PLAYER_ID, grid.gridWidth, 0, UnitType.Sphere)
      ).toBe(false);
      expect(
        data.placeUnit(PLAYER_ID, 0, grid.gridHeight, UnitType.Sphere)
      ).toBe(false);
    });
  });

  describe('2x1 unit (Rocket)', () => {
    it('places and occupies both cells', () => {
      expect(data.placeUnit(PLAYER_ID, 2, 2, UnitType.Rocket)).toBe(true);
      const grid = data.getGrid(PLAYER_ID)!;
      expect(grid.cells[2][2].occupied).toBe(true);
      expect(grid.cells[3][2].occupied).toBe(true);
      expect(grid.cells[2][2].unitType).toBe(UnitType.Rocket);
      expect(grid.cells[3][2].unitType).toBe(UnitType.Rocket);
      expect(grid.cells[2][3].occupied).toBe(false);
    });

    it('rejects placement when part of the footprint is out of bounds', () => {
      const grid = data.getGrid(PLAYER_ID)!;
      expect(
        data.placeUnit(PLAYER_ID, grid.gridWidth - 1, 0, UnitType.Rocket)
      ).toBe(false);
    });

    it('finds the origin from either occupied cell', () => {
      data.placeUnit(PLAYER_ID, 4, 1, UnitType.Rocket);
      expect(data.findUnitOrigin(PLAYER_ID, 4, 1)).toEqual({ x: 4, z: 1 });
      expect(data.findUnitOrigin(PLAYER_ID, 5, 1)).toEqual({ x: 4, z: 1 });
    });
  });

  describe('2x2 unit (Cube)', () => {
    it('places and occupies all four cells', () => {
      expect(data.placeUnit(PLAYER_ID, 1, 1, UnitType.Cube)).toBe(true);
      const grid = data.getGrid(PLAYER_ID)!;
      for (let dx = 0; dx < 2; dx++) {
        for (let dz = 0; dz < 2; dz++) {
          expect(grid.cells[1 + dx][1 + dz].occupied).toBe(true);
          expect(grid.cells[1 + dx][1 + dz].unitType).toBe(UnitType.Cube);
        }
      }
    });

    it('rejects placement near the grid edge', () => {
      const grid = data.getGrid(PLAYER_ID)!;
      expect(
        data.placeUnit(PLAYER_ID, grid.gridWidth - 1, 0, UnitType.Cube)
      ).toBe(false);
      expect(
        data.placeUnit(PLAYER_ID, 0, grid.gridHeight - 1, UnitType.Cube)
      ).toBe(false);
    });

    it('finds the origin from any occupied cell', () => {
      data.placeUnit(PLAYER_ID, 3, 3, UnitType.Cube);
      for (let dx = 0; dx < 2; dx++) {
        for (let dz = 0; dz < 2; dz++) {
          expect(data.findUnitOrigin(PLAYER_ID, 3 + dx, 3 + dz)).toEqual({
            x: 3,
            z: 3,
          });
        }
      }
    });
  });

  describe('occupancy rejection', () => {
    it('blocks overlapping a 1x1 unit', () => {
      data.placeUnit(PLAYER_ID, 2, 2, UnitType.Sphere);
      expect(data.placeUnit(PLAYER_ID, 2, 2, UnitType.Support)).toBe(false);
    });

    it('blocks overlapping a 2x1 unit', () => {
      data.placeUnit(PLAYER_ID, 2, 2, UnitType.Rocket);
      expect(data.placeUnit(PLAYER_ID, 3, 2, UnitType.Sphere)).toBe(false);
      expect(data.placeUnit(PLAYER_ID, 4, 2, UnitType.Sphere)).toBe(true);
      // Rocket occupies (2,2)-(3,2), so (2,3) is free.
      expect(data.placeUnit(PLAYER_ID, 2, 3, UnitType.Sphere)).toBe(true);
    });

    it('blocks overlapping a 2x2 unit', () => {
      data.placeUnit(PLAYER_ID, 2, 2, UnitType.Cube);
      expect(data.placeUnit(PLAYER_ID, 3, 3, UnitType.Sphere)).toBe(false);
      expect(data.placeUnit(PLAYER_ID, 1, 2, UnitType.Rocket)).toBe(false);
    });
  });

  describe('moving units', () => {
    it('moves a 1x1 unit', () => {
      data.placeUnit(PLAYER_ID, 0, 0, UnitType.Sphere);
      const result = data.moveUnit(PLAYER_ID, 0, 0, 5, 5);
      expect(result.success).toBe(true);
      expect(result.unitType).toBe(UnitType.Sphere);

      const grid = data.getGrid(PLAYER_ID)!;
      expect(grid.cells[0][0].occupied).toBe(false);
      expect(grid.cells[5][5].occupied).toBe(true);
      expect(grid.placedUnits[0]).toEqual({
        unitType: UnitType.Sphere,
        gridX: 5,
        gridZ: 5,
      });
    });

    it('moves a multi-cell unit and clears old cells', () => {
      data.placeUnit(PLAYER_ID, 0, 0, UnitType.Cube);
      const result = data.moveUnit(PLAYER_ID, 0, 0, 4, 4);
      expect(result.success).toBe(true);

      const grid = data.getGrid(PLAYER_ID)!;
      expect(grid.cells[0][0].occupied).toBe(false);
      expect(grid.cells[1][1].occupied).toBe(false);
      expect(grid.cells[4][4].occupied).toBe(true);
      expect(grid.cells[5][5].occupied).toBe(true);
    });

    it('rejects moves that collide with another unit', () => {
      data.placeUnit(PLAYER_ID, 0, 0, UnitType.Sphere);
      data.placeUnit(PLAYER_ID, 1, 0, UnitType.Sphere);
      const result = data.moveUnit(PLAYER_ID, 0, 0, 1, 0);
      expect(result.success).toBe(false);
    });

    it('allows moving a 2x2 unit one cell within its own footprint', () => {
      data.placeUnit(PLAYER_ID, 0, 0, UnitType.Cube);
      const result = data.moveUnit(PLAYER_ID, 0, 0, 1, 1);
      expect(result.success).toBe(true);
    });
  });

  describe('removing units', () => {
    it('removes a 1x1 unit', () => {
      data.placeUnit(PLAYER_ID, 2, 2, UnitType.Sphere);
      const result = data.removeUnit(PLAYER_ID, 2, 2);
      expect(result.success).toBe(true);
      expect(result.unitType).toBe(UnitType.Sphere);
      expect(data.getPlacedUnitCount(PLAYER_ID)).toBe(0);
      expect(data.getGrid(PLAYER_ID)!.cells[2][2].occupied).toBe(false);
    });

    it('removes a 2x2 unit from any occupied cell', () => {
      data.placeUnit(PLAYER_ID, 3, 3, UnitType.Cube);
      const result = data.removeUnit(PLAYER_ID, 4, 4);
      expect(result.success).toBe(true);
      expect(result.unitType).toBe(UnitType.Cube);
      expect(result.originX).toBe(3);
      expect(result.originZ).toBe(3);

      const grid = data.getGrid(PLAYER_ID)!;
      for (let dx = 0; dx < 2; dx++) {
        for (let dz = 0; dz < 2; dz++) {
          expect(grid.cells[3 + dx][3 + dz].occupied).toBe(false);
        }
      }
    });

    it('returns failure when removing an empty cell', () => {
      const result = data.removeUnit(PLAYER_ID, 0, 0);
      expect(result.success).toBe(false);
    });
  });
});
