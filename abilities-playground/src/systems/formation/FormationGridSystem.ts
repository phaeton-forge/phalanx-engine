import * as THREE from 'three';
import type { TeamId } from '../../components';
import type { UnitFactory } from '../../units/UnitFactory';
import type { UnitType } from '../../units/UnitType';
import { FormationGridData } from './FormationGridData';
import { FormationGridRenderer } from './FormationGridRenderer';
import { FormationHoverPreview } from './FormationHoverPreview';
import { FormationInputHandler } from './FormationInputHandler';

export interface FormationGridSystemCallbacks {
  onPlaceUnit?: (
    playerId: string,
    unitType: UnitType,
    gridX: number,
    gridZ: number
  ) => void;
}

/**
 * FormationGridSystem - Local Three.js façade for the formation grid.
 *
 * Composes the engine-agnostic grid data, the Three.js renderer, the hover
 * preview, and the pointer input handler. It has no simulation authority;
 * authoritative placement lives in the deterministic FormationSystem.
 */
export class FormationGridSystem {
  private readonly gridData: FormationGridData;
  private readonly renderer: FormationGridRenderer;
  private readonly hoverPreview: FormationHoverPreview;
  private readonly inputHandler: FormationInputHandler;
  private readonly unitFactory: UnitFactory;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    unitFactory: UnitFactory,
    canvas?: HTMLCanvasElement,
    callbacks: FormationGridSystemCallbacks = {}
  ) {
    this.unitFactory = unitFactory;
    this.gridData = new FormationGridData();
    this.renderer = new FormationGridRenderer(scene, unitFactory);
    this.hoverPreview = new FormationHoverPreview(scene, unitFactory);

    this.inputHandler = new FormationInputHandler(
      canvas ?? document.createElement('canvas'),
      camera,
      this.gridData,
      this.renderer,
      this.hoverPreview,
      {
        onPlaceUnit: callbacks.onPlaceUnit,
      }
    );
  }

  /**
   * Initialize the visual and data grid for a player.
   */
  initializeGrid(playerId: string, team: TeamId): void {
    const grid = this.gridData.initializeGrid(playerId, team);
    this.renderer.initializeGrid(playerId, grid);
  }

  /**
   * Start dragging a unit type from the palette.
   */
  startTouchDrag(playerId: string, unitType: UnitType): void {
    this.inputHandler.startTouchDrag(playerId, unitType);
  }

  /**
   * Update a drag at screen coordinates.
   */
  updateTouchDrag(clientX: number, clientY: number): void {
    this.inputHandler.updateTouchDrag(clientX, clientY);
  }

  /**
   * End the current drag. Placement (if valid) is emitted via the onPlaceUnit callback.
   */
  endTouchDrag(): void {
    this.inputHandler.endTouchDrag();
  }

  /**
   * Cancel the current drag without placing.
   */
  cancelTouchDrag(): void {
    this.inputHandler.endTouchDrag();
  }

  /**
   * Returns true if a drag is currently active.
   */
  isTouchDragActive(): boolean {
    return this.inputHandler.isTouchDragActive();
  }

  /**
   * Place a unit locally (updates preview mesh and data layer).
   */
  placeUnit(
    playerId: string,
    gridX: number,
    gridZ: number,
    unitType: UnitType
  ): boolean {
    const success = this.gridData.placeUnit(playerId, gridX, gridZ, unitType);
    if (!success) return false;

    const grid = this.gridData.getGrid(playerId);
    if (!grid) return false;

    const worldPos = this.gridData.getWorldPosWithOffset(
      playerId,
      gridX,
      gridZ,
      unitType
    );
    if (worldPos) {
      this.renderer.addUnitPreview(
        playerId,
        gridX,
        gridZ,
        unitType,
        grid,
        worldPos
      );
    }

    return true;
  }

  /**
   * Move a unit locally.
   */
  moveUnit(
    playerId: string,
    fromGridX: number,
    fromGridZ: number,
    toGridX: number,
    toGridZ: number
  ): boolean {
    const result = this.gridData.moveUnit(
      playerId,
      fromGridX,
      fromGridZ,
      toGridX,
      toGridZ
    );
    if (!result.success || !result.unitType) return false;

    const unitType = result.unitType;
    const worldPos = this.gridData.getWorldPosWithOffset(
      playerId,
      toGridX,
      toGridZ,
      unitType
    );
    if (worldPos) {
      worldPos.y = this.unitFactory.getDefinition(unitType).heightOffset;
      this.renderer.moveUnitPreview(
        playerId,
        fromGridX,
        fromGridZ,
        toGridX,
        toGridZ,
        worldPos
      );
    }

    return true;
  }

  /**
   * Remove a unit locally.
   */
  removeUnit(playerId: string, gridX: number, gridZ: number): boolean {
    const result = this.gridData.removeUnit(playerId, gridX, gridZ);
    if (!result.success || !result.unitType) return false;

    this.renderer.removeUnitPreview(playerId, result.originX, result.originZ);
    return true;
  }

  /**
   * Convert a world position to grid coordinates for a player.
   */
  worldToGrid(
    playerId: string,
    worldPos: THREE.Vector3
  ): { x: number; z: number } | null {
    return this.gridData.worldToGrid(playerId, worldPos);
  }

  /**
   * Convert grid coordinates to a world position for a player.
   */
  gridToWorld(
    playerId: string,
    gridX: number,
    gridZ: number
  ): THREE.Vector3 | null {
    return this.gridData.gridToWorld(playerId, gridX, gridZ);
  }

  /**
   * Check whether a unit can be placed at a grid cell.
   */
  canPlaceUnit(
    playerId: string,
    gridX: number,
    gridZ: number,
    unitType: UnitType
  ): boolean {
    return this.gridData.canPlaceUnit(playerId, gridX, gridZ, unitType);
  }

  /**
   * Dispose all local Three.js and data resources.
   */
  dispose(): void {
    this.inputHandler.dispose();
    this.hoverPreview.dispose();
    this.renderer.dispose();
    this.gridData.dispose();
  }
}
