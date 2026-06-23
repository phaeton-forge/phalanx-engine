import { Vector3, Mesh } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import type { SystemContext } from '@phalanx-engine/ecs';
import { GameSystem } from '@phalanx-engine/ecs';
import { GameEvents, createEvent } from '../events';
import { TeamTag } from '../enums/TeamTag';
import {
  FormationGridData,
  FormationGridRenderer,
  FormationHoverPreview,
  FormationInputHandler,
  FormationDeployer,
  type FormationUnitType,
  type FormationGrid,
  type CreateUnitCallback,
  type CanAffordCallback,
  type PlacedUnit,
  type GridCoords,
  type GridCell,
  type DeploymentUnitInfo,
} from './formation';
import type {
  UnitPurchaseCompletedEvent,
  FormationUnitPlacedEvent,
  FormationUnitRemovedEvent,
  FormationUnitMovedEvent,
  UIFormationUpdatedEvent,
} from '../events';

// Re-export types for backward compatibility
export type {
  FormationUnitType,
  CreateUnitCallback,
  CanAffordCallback,
  FormationGrid,
  PlacedUnit,
  GridCoords,
  GridCell,
};

/**
 * FormationGridSystem - Main facade for the formation grid functionality
 * Extends GameSystem for consistent lifecycle management
 *
 * This system coordinates several specialized components:
 * - FormationGridData: Grid state management
 * - FormationGridRenderer: Visual rendering
 * - FormationHoverPreview: Hover effects
 * - FormationInputHandler: Mouse/pointer input
 * - FormationDeployer: Unit deployment
 */
export class FormationGridSystem extends GameSystem {
  private gridData!: FormationGridData;
  private renderer!: FormationGridRenderer;
  private hoverPreview!: FormationHoverPreview;
  private inputHandler!: FormationInputHandler;
  private deployer!: FormationDeployer;
  private previewMesh: Mesh | null = null;
  private scene: Scene;

  constructor(scene: Scene) {
    super();
    this.scene = scene;
  }

  /**
   * Initialize the system with context
   */
  public override init(context: SystemContext): void {
    super.init(context);

    // Initialize components
    this.gridData = new FormationGridData();
    this.renderer = new FormationGridRenderer(this.scene);
    this.hoverPreview = new FormationHoverPreview(this.scene);
    this.inputHandler = new FormationInputHandler(
      this.scene,
      this.eventBus,
      this.gridData,
      this.renderer,
      this.hoverPreview
    );
    this.deployer = new FormationDeployer(this.eventBus, this.gridData, this.context);

    this.setupEventListeners();
  }

  /**
   * Set the callback for creating units
   */
  public setCreateUnitCallback(callback: CreateUnitCallback): void {
    this.deployer.setCreateUnitCallback(callback);
  }

  /**
   * Set the callback for checking affordability
   */
  public setCanAffordCallback(callback: CanAffordCallback): void {
    this.inputHandler.setCanAffordCallback(callback);
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    this.subscribe<UnitPurchaseCompletedEvent>(
      GameEvents.UNIT_PURCHASE_COMPLETED,
      (_event) => {
        // Unit is queued for placement, actual spawn happens on commit
      }
    );
  }

  /**
   * Initialize formation grid for a player
   */
  public initializeGrid(playerId: string, team: TeamTag): void {
    const grid = this.gridData.initializeGrid(playerId, team);
    this.renderer.createGridVisualization(playerId, grid);
    this.renderer.createGridGroundPlane(playerId, grid);

    // Emit initial UI update
    this.emitUIFormationUpdate(playerId);
  }

  /**
   * Emit UI formation update event with all data needed for UI rendering
   */
  private emitUIFormationUpdate(playerId: string): void {
    this.eventBus.emit<UIFormationUpdatedEvent>(
      GameEvents.UI_FORMATION_UPDATED,
      {
        ...createEvent(),
        playerId,
        placedUnitCount: this.gridData.getPlacedUnitCount(playerId),
      }
    );
  }

  /**
   * Enter placement mode for a unit type
   */
  public enterPlacementMode(
    playerId: string,
    unitType: FormationUnitType
  ): void {
    this.inputHandler.enterPlacementMode(playerId, unitType);
  }

  /**
   * Exit placement mode
   */
  public exitPlacementMode(playerId: string): void {
    this.inputHandler.exitPlacementMode(playerId);
    this.clearPreviewMesh();
  }

  /**
   * Enter update mode for repositioning an existing unit
   */
  public enterUpdateMode(
    playerId: string,
    gridX: number,
    gridZ: number,
    unitType: FormationUnitType
  ): void {
    this.inputHandler.enterUpdateMode(playerId, gridX, gridZ, unitType);
  }

  /**
   * Exit update mode
   */
  public exitUpdateMode(playerId: string): void {
    this.inputHandler.exitUpdateMode(playerId);
  }

  /**
   * Check if we're currently in update mode
   */
  public isInUpdateMode(playerId: string): boolean {
    return this.inputHandler.isInUpdateMode(playerId);
  }

  /**
   * Check if we're currently in placement mode
   */
  public isInPlacementMode(playerId: string): boolean {
    return this.inputHandler.isInPlacementMode(playerId);
  }

  // ============================================
  // TOUCH DRAG METHODS (Mobile unit placement)
  // ============================================

  /**
   * Start touch drag for unit placement
   */
  public startTouchDrag(playerId: string, unitType: FormationUnitType): void {
    this.inputHandler.startTouchDrag(playerId, unitType);
  }

  /**
   * Update touch drag position
   */
  public updateTouchDrag(screenX: number, screenY: number): void {
    this.inputHandler.updateTouchDrag(screenX, screenY);
  }

  /**
   * End touch drag - attempt to place unit
   */
  public endTouchDrag(screenX: number, screenY: number): boolean {
    return this.inputHandler.endTouchDrag(screenX, screenY);
  }

  /**
   * Cancel touch drag
   */
  public cancelTouchDrag(): void {
    this.inputHandler.cancelTouchDrag();
  }

  /**
   * Check if touch drag is active
   */
  public isTouchDragActive(): boolean {
    return this.inputHandler.isTouchDragActive();
  }

  /**
   * Convert world position to grid coordinates
   */
  public worldToGrid(playerId: string, worldPos: Vector3): GridCoords | null {
    return this.gridData.worldToGrid(playerId, worldPos);
  }

  /**
   * Convert grid coordinates to world position
   */
  public gridToWorld(
    playerId: string,
    gridX: number,
    gridZ: number
  ): Vector3 | null {
    return this.gridData.gridToWorld(playerId, gridX, gridZ);
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
    return this.gridData.canPlaceUnit(playerId, gridX, gridZ, unitType);
  }

  /**
   * Check if a unit can be moved from one position to another
   */
  public canMoveUnit(
    playerId: string,
    fromGridX: number,
    fromGridZ: number,
    toGridX: number,
    toGridZ: number,
    unitType: FormationUnitType
  ): boolean {
    return this.gridData.canMoveUnit(
      playerId,
      fromGridX,
      fromGridZ,
      toGridX,
      toGridZ,
      unitType
    );
  }

  /**
   * Find the origin cell of a unit at a given position
   */
  public findUnitOrigin(
    playerId: string,
    gridX: number,
    gridZ: number
  ): GridCoords | null {
    return this.gridData.findUnitOrigin(playerId, gridX, gridZ);
  }

  /**
   * Move a unit from one grid position to another
   */
  public moveUnit(
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

    if (result.success && result.unitType) {
      const grid = this.gridData.getGrid(playerId);
      if (grid) {
        // Create new preview mesh
        const worldPos = this.gridData.getWorldPosWithOffset(
          playerId,
          toGridX,
          toGridZ,
          result.unitType
        );
        if (worldPos) {
          const mesh = this.renderer.createUnitPreview(
            playerId,
            toGridX,
            toGridZ,
            result.unitType,
            grid,
            worldPos
          );
          this.gridData.setCellPreviewMesh(playerId, toGridX, toGridZ, mesh);
        }
      }

      this.eventBus.emit<FormationUnitMovedEvent>(
        GameEvents.FORMATION_UNIT_MOVED,
        {
          ...createEvent(),
          playerId,
          unitType: result.unitType,
          fromGridX,
          fromGridZ,
          toGridX,
          toGridZ,
        }
      );

      // Emit UI update event (unit count may not change, but event keeps UI in sync)
      this.emitUIFormationUpdate(playerId);
    }

    return result.success;
  }

  /**
   * Place a unit on the formation grid
   */
  public placeUnit(
    playerId: string,
    gridX: number,
    gridZ: number,
    unitType: FormationUnitType
  ): boolean {
    const success = this.gridData.placeUnit(playerId, gridX, gridZ, unitType);

    if (success) {
      const grid = this.gridData.getGrid(playerId);
      if (grid) {
        // Create preview mesh
        const worldPos = this.gridData.getWorldPosWithOffset(
          playerId,
          gridX,
          gridZ,
          unitType
        );
        if (worldPos) {
          const mesh = this.renderer.createUnitPreview(
            playerId,
            gridX,
            gridZ,
            unitType,
            grid,
            worldPos
          );
          this.gridData.setCellPreviewMesh(playerId, gridX, gridZ, mesh);
        }
      }

      this.eventBus.emit<FormationUnitPlacedEvent>(
        GameEvents.FORMATION_UNIT_PLACED,
        {
          ...createEvent(),
          playerId,
          unitType,
          gridX,
          gridZ,
        }
      );

      // Emit UI update event
      this.emitUIFormationUpdate(playerId);
    }

    return success;
  }

  /**
   * Remove a unit from the formation grid
   */
  public removeUnit(playerId: string, gridX: number, gridZ: number): boolean {
    const result = this.gridData.removeUnit(playerId, gridX, gridZ);

    if (result.success) {
      this.eventBus.emit<FormationUnitRemovedEvent>(
        GameEvents.FORMATION_UNIT_REMOVED,
        {
          ...createEvent(),
          playerId,
          gridX: result.originX,
          gridZ: result.originZ,
        }
      );

      // Emit UI update event
      this.emitUIFormationUpdate(playerId);
    }

    return result.success;
  }

  /**
   * Commit all pending units to the battlefield
   */
  public commitFormation(playerId: string): number {
    return this.deployer.commitFormation(playerId);
  }

  /**
   * Get pending units for staggered deployment
   */
  public getPendingUnitsForDeployment(playerId: string): DeploymentUnitInfo[] {
    return this.deployer.getPendingUnitsForDeployment(playerId);
  }

  /**
   * Deploy a single unit during staggered deployment
   */
  public deploySingleUnit(
    playerId: string,
    unitInfo: DeploymentUnitInfo
  ): void {
    return this.deployer.deploySingleUnit(playerId, unitInfo);
  }

  /**
   * Finalize deployment for a player
   */
  public finalizeDeployment(playerId: string, unitCount: number): void {
    return this.deployer.finalizeDeployment(playerId, unitCount);
  }

  /**
   * Get the pending units for a player
   */
  public getPendingUnits(playerId: string): PlacedUnit[] {
    return this.gridData.getPendingUnits(playerId);
  }

  /**
   * Get all placed units for a player
   */
  public getPlacedUnits(playerId: string): PlacedUnit[] {
    return this.gridData.getPlacedUnits(playerId);
  }

  /**
   * Get the count of placed units for a player
   */
  public getPlacedUnitCount(playerId: string): number {
    return this.gridData.getPlacedUnitCount(playerId);
  }

  /**
   * Get the grid for a player
   */
  public getGrid(playerId: string): FormationGrid | undefined {
    return this.gridData.getGrid(playerId);
  }

  /**
   * Clear the active preview mesh
   */
  private clearPreviewMesh(): void {
    if (this.previewMesh) {
      this.previewMesh.dispose();
      this.previewMesh = null;
    }
  }

  /**
   * Cleanup
   */
  public override dispose(): void {
    super.dispose(); // Clean up subscriptions from base class

    this.inputHandler.dispose();
    this.deployer.dispose();
    this.hoverPreview.dispose();
    this.renderer.dispose();
    this.gridData.dispose();

    this.clearPreviewMesh();
  }
}
