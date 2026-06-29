import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { FormationGridRenderer } from './FormationGridRenderer';
import { FormationGridData } from './FormationGridData';
import { UnitFactory } from '../../units/UnitFactory';
import { UnitType } from '../../units/UnitType';

const PLAYER_ID = 'player-1';
const TEAM = 0 as const;

describe('FormationGridRenderer', () => {
  let scene: THREE.Scene;
  let gridData: FormationGridData;
  let renderer: FormationGridRenderer;

  beforeEach(() => {
    scene = new THREE.Scene();
    gridData = new FormationGridData();
    const abilities =
      {} as unknown as import('@phalanx-engine/abilities').AbilitySystem;
    const unitFactory = new UnitFactory(scene, abilities);
    renderer = new FormationGridRenderer(scene, unitFactory);
  });

  it('tags preview roots with playerId, grid origin, and isUnitPreview flag', () => {
    const grid = gridData.initializeGrid(PLAYER_ID, TEAM);
    renderer.initializeGrid(PLAYER_ID, grid);

    const worldPos = gridData.getWorldPosWithOffset(
      PLAYER_ID,
      2,
      3,
      UnitType.Sphere
    )!;
    renderer.addUnitPreview(PLAYER_ID, 2, 3, UnitType.Sphere, grid, worldPos);

    const targets = renderer.unitPreviewTargets;
    expect(targets).toHaveLength(1);
    expect(targets[0].userData).toEqual({
      playerId: PLAYER_ID,
      gridX: 2,
      gridZ: 3,
      isUnitPreview: true,
    });
  });

  it('exposes all placed unit previews as raycast targets', () => {
    const grid = gridData.initializeGrid(PLAYER_ID, TEAM);
    renderer.initializeGrid(PLAYER_ID, grid);

    const pos1 = gridData.getWorldPosWithOffset(
      PLAYER_ID,
      0,
      0,
      UnitType.Sphere
    )!;
    renderer.addUnitPreview(PLAYER_ID, 0, 0, UnitType.Sphere, grid, pos1);

    const pos2 = gridData.getWorldPosWithOffset(
      PLAYER_ID,
      1,
      1,
      UnitType.Support
    )!;
    renderer.addUnitPreview(PLAYER_ID, 1, 1, UnitType.Support, grid, pos2);

    expect(renderer.unitPreviewTargets).toHaveLength(2);
  });

  it('removes a preview from unitPreviewTargets after removal', () => {
    const grid = gridData.initializeGrid(PLAYER_ID, TEAM);
    renderer.initializeGrid(PLAYER_ID, grid);

    const worldPos = gridData.getWorldPosWithOffset(
      PLAYER_ID,
      2,
      3,
      UnitType.Sphere
    )!;
    renderer.addUnitPreview(PLAYER_ID, 2, 3, UnitType.Sphere, grid, worldPos);
    expect(renderer.unitPreviewTargets).toHaveLength(1);

    renderer.removeUnitPreview(PLAYER_ID, 2, 3);
    expect(renderer.unitPreviewTargets).toHaveLength(0);
  });

  it('updates preview userData after moving a unit', () => {
    const grid = gridData.initializeGrid(PLAYER_ID, TEAM);
    renderer.initializeGrid(PLAYER_ID, grid);

    const fromPos = gridData.getWorldPosWithOffset(
      PLAYER_ID,
      1,
      1,
      UnitType.Sphere
    )!;
    renderer.addUnitPreview(PLAYER_ID, 1, 1, UnitType.Sphere, grid, fromPos);

    const toPos = gridData.getWorldPosWithOffset(
      PLAYER_ID,
      4,
      4,
      UnitType.Sphere
    )!;
    renderer.moveUnitPreview(PLAYER_ID, 1, 1, 4, 4, toPos);

    const targets = renderer.unitPreviewTargets;
    expect(targets).toHaveLength(1);
    expect(targets[0].userData).toEqual({
      playerId: PLAYER_ID,
      gridX: 4,
      gridZ: 4,
      isUnitPreview: true,
    });
  });
});
