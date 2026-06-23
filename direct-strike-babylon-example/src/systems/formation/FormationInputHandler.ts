import { Scene, PointerEventTypes, PickingInfo } from '@babylonjs/core';
import { EventBus } from '@phalanx-engine/ecs';
import { GameEvents, createEvent } from '../../events';
import { FormationGridData } from './FormationGridData';
import { FormationGridRenderer } from './FormationGridRenderer';
import { FormationHoverPreview } from './FormationHoverPreview';
import type {
  FormationUnitType,
  CanAffordCallback,
  FormationGrid,
} from './FormationTypes';
import type {
  FormationModeEnteredEvent,
  FormationModeExitedEvent,
  FormationUpdateModeEnteredEvent,
  FormationUpdateModeExitedEvent,
  FormationPlacementFailedEvent,
} from '../../events';

/**
 * State for active placement mode
 */
interface PlacementModeState {
  playerId: string;
  unitType: FormationUnitType;
}

/**
 * State for active update mode (repositioning existing units)
 */
interface UpdateModeState {
  playerId: string;
  gridX: number;
  gridZ: number;
  unitType: FormationUnitType;
}

/**
 * State for touch drag placement (mobile)
 */
interface TouchDragState {
  playerId: string;
  unitType: FormationUnitType;
  isActive: boolean;
}

/**
 * State for tracking touch to distinguish tap from drag
 */
interface TouchTrackingState {
  startX: number;
  startY: number;
  startTime: number;
  isActive: boolean;
}

/** Maximum distance (in pixels) for a touch to be considered a tap */
const TAP_DISTANCE_THRESHOLD = 15;

/** Maximum duration (in ms) for a touch to be considered a tap */
const TAP_TIME_THRESHOLD = 300;

/**
 * FormationInputHandler - Handles mouse/pointer input for the formation grid
 * Responsible for hover detection, click handling, and mode management
 */
export class FormationInputHandler {
  private scene: Scene;
  private eventBus: EventBus;
  private gridData: FormationGridData;
  private renderer: FormationGridRenderer;
  private hoverPreview: FormationHoverPreview;

  private activePlacementMode: PlacementModeState | null = null;
  private activeUpdateMode: UpdateModeState | null = null;
  private savedPlacementMode: PlacementModeState | null = null;
  private touchDragState: TouchDragState | null = null;
  private touchTrackingState: TouchTrackingState | null = null;

  private canAffordCallback: CanAffordCallback | null = null;

  constructor(
    scene: Scene,
    eventBus: EventBus,
    gridData: FormationGridData,
    renderer: FormationGridRenderer,
    hoverPreview: FormationHoverPreview
  ) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.gridData = gridData;
    this.renderer = renderer;
    this.hoverPreview = hoverPreview;

    this.setupMouseHandling();
  }

  /**
   * Set the callback for checking affordability
   */
  public setCanAffordCallback(callback: CanAffordCallback): void {
    this.canAffordCallback = callback;
  }

  /**
   * Setup mouse handling for grid interaction
   */
  private setupMouseHandling(): void {
    this.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
        const pickResult = this.scene.pick(
          this.scene.pointerX,
          this.scene.pointerY
        );
        this.handlePointerMove(pickResult);
      } else if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
        const evt = pointerInfo.event as PointerEvent;
        if (evt.button === 0) {
          // Track touch/pointer start for tap detection
          this.touchTrackingState = {
            startX: evt.clientX,
            startY: evt.clientY,
            startTime: performance.now(),
            isActive: true,
          };
        }
      } else if (pointerInfo.type === PointerEventTypes.POINTERUP) {
        const evt = pointerInfo.event as PointerEvent;
        if (evt.button === 0 && this.touchTrackingState?.isActive) {
          // Check if this was a short tap (not a drag)
          const dx = evt.clientX - this.touchTrackingState.startX;
          const dy = evt.clientY - this.touchTrackingState.startY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const duration =
            performance.now() - this.touchTrackingState.startTime;

          if (
            distance <= TAP_DISTANCE_THRESHOLD &&
            duration <= TAP_TIME_THRESHOLD
          ) {
            // This is a short tap - handle placement
            const pickResult = this.scene.pick(evt.clientX, evt.clientY);
            this.handlePointerDown(pickResult);
          }

          this.touchTrackingState = null;
        }
      }
    });
  }

  /**
   * Handle pointer move for hover highlight
   */
  private handlePointerMove(pickResult: PickingInfo | null): void {
    // Check for update mode first
    if (this.activeUpdateMode) {
      const { playerId, unitType } = this.activeUpdateMode;
      const grid = this.gridData.getGrid(playerId);
      if (!grid) return;

      const gridPlane = this.renderer.getGridGroundPlane(playerId);
      if (!pickResult?.hit || pickResult.pickedMesh !== gridPlane) {
        this.hoverPreview.hideHoverHighlight();
        return;
      }

      const hitPoint = pickResult.pickedPoint;
      if (!hitPoint) return;

      const gridCoords = this.gridData.worldToGrid(playerId, hitPoint);
      if (!gridCoords) {
        this.hoverPreview.hideHoverHighlight();
        return;
      }

      this.showHoverHighlightForMove(
        playerId,
        gridCoords.x,
        gridCoords.z,
        unitType
      );
      return;
    }

    if (!this.activePlacementMode) {
      this.hoverPreview.hideHoverHighlight();
      return;
    }

    const { playerId, unitType } = this.activePlacementMode;
    const grid = this.gridData.getGrid(playerId);
    if (!grid) return;

    const gridPlane = this.renderer.getGridGroundPlane(playerId);
    if (!pickResult?.hit || pickResult.pickedMesh !== gridPlane) {
      this.hoverPreview.hideHoverHighlight();
      return;
    }

    const hitPoint = pickResult.pickedPoint;
    if (!hitPoint) return;

    const gridCoords = this.gridData.worldToGrid(playerId, hitPoint);
    if (!gridCoords) {
      this.hoverPreview.hideHoverHighlight();
      return;
    }

    this.showHoverHighlightForPlacement(
      playerId,
      gridCoords.x,
      gridCoords.z,
      unitType,
      grid
    );
  }

  /**
   * Show hover highlight for placement mode
   */
  private showHoverHighlightForPlacement(
    playerId: string,
    gridX: number,
    gridZ: number,
    unitType: FormationUnitType,
    grid: FormationGrid
  ): void {
    const { width, depth } = this.gridData.getUnitGridSize(unitType);
    const worldWidth = width * grid.cellSize;
    const worldDepth = depth * grid.cellSize;

    const worldPos = this.gridData.getWorldPosWithOffset(
      playerId,
      gridX,
      gridZ,
      unitType
    );
    if (!worldPos) return;

    const canPlace = this.gridData.canPlaceUnit(
      playerId,
      gridX,
      gridZ,
      unitType
    );
    this.hoverPreview.showHoverHighlight(
      worldPos,
      worldWidth,
      worldDepth,
      canPlace,
      grid,
      unitType
    );
  }

  /**
   * Show hover highlight for move operation (in update mode)
   */
  private showHoverHighlightForMove(
    playerId: string,
    gridX: number,
    gridZ: number,
    unitType: FormationUnitType
  ): void {
    if (!this.activeUpdateMode) return;

    const { gridX: fromGridX, gridZ: fromGridZ } = this.activeUpdateMode;
    const grid = this.gridData.getGrid(playerId);
    if (!grid) return;

    const { width, depth } = this.gridData.getUnitGridSize(unitType);
    const worldWidth = width * grid.cellSize;
    const worldDepth = depth * grid.cellSize;

    const worldPos = this.gridData.getWorldPosWithOffset(
      playerId,
      gridX,
      gridZ,
      unitType
    );
    if (!worldPos) return;

    const isSameCell = gridX === fromGridX && gridZ === fromGridZ;
    const canMove =
      isSameCell ||
      this.gridData.canMoveUnit(
        playerId,
        fromGridX,
        fromGridZ,
        gridX,
        gridZ,
        unitType
      );

    this.hoverPreview.showHoverHighlightForMove(
      worldPos,
      worldWidth,
      worldDepth,
      canMove
    );
  }

  /**
   * Handle pointer down for unit placement
   */
  private handlePointerDown(pickResult: PickingInfo | null): void {
    // Handle update mode first
    if (this.activeUpdateMode) {
      this.handleUpdateModeClick(pickResult);
      return;
    }

    // Not in any mode - check if clicking on an existing unit to enter update mode
    if (!this.activePlacementMode) {
      this.handleNoModeClick(pickResult);
      return;
    }

    // Handle placement mode
    this.handlePlacementModeClick(pickResult);
  }

  /**
   * Handle click while in update mode
   */
  private handleUpdateModeClick(pickResult: PickingInfo | null): void {
    if (!this.activeUpdateMode) return;

    const {
      playerId,
      gridX: fromGridX,
      gridZ: fromGridZ,
      unitType,
    } = this.activeUpdateMode;
    const grid = this.gridData.getGrid(playerId);
    if (!grid) return;

    const gridPlane = this.renderer.getGridGroundPlane(playerId);
    if (!pickResult?.hit || pickResult.pickedMesh !== gridPlane) return;

    const hitPoint = pickResult.pickedPoint;
    if (!hitPoint) return;

    const gridCoords = this.gridData.worldToGrid(playerId, hitPoint);
    if (!gridCoords) return;

    // Clicking on the same cell - just exit update mode
    if (gridCoords.x === fromGridX && gridCoords.z === fromGridZ) {
      this.exitUpdateMode(playerId);
      return;
    }

    // Check if clicking on another unit - select that unit instead
    const targetCell = grid.cells[gridCoords.x]?.[gridCoords.z];
    if (targetCell?.occupied && targetCell.unitType) {
      this.exitUpdateMode(playerId);
      const origin = this.gridData.findUnitOrigin(
        playerId,
        gridCoords.x,
        gridCoords.z
      );
      if (origin) {
        this.enterUpdateMode(playerId, origin.x, origin.z, targetCell.unitType);
      }
      return;
    }

    // Check if we can move the unit to this position
    if (
      this.gridData.canMoveUnit(
        playerId,
        fromGridX,
        fromGridZ,
        gridCoords.x,
        gridCoords.z,
        unitType
      )
    ) {
      this.eventBus.emit(GameEvents.FORMATION_UNIT_MOVE_REQUESTED, {
        ...createEvent(),
        playerId,
        fromGridX,
        fromGridZ,
        toGridX: gridCoords.x,
        toGridZ: gridCoords.z,
      });

      this.exitUpdateMode(playerId);
    }
  }

  /**
   * Handle click when not in any mode
   */
  private handleNoModeClick(pickResult: PickingInfo | null): void {
    for (const [playerId, grid] of this.gridData.getAllGrids().entries()) {
      const gridPlane = this.renderer.getGridGroundPlane(playerId);
      if (!pickResult?.hit || pickResult.pickedMesh !== gridPlane) continue;

      const hitPoint = pickResult.pickedPoint;
      if (!hitPoint) continue;

      const gridCoords = this.gridData.worldToGrid(playerId, hitPoint);
      if (!gridCoords) continue;

      const cell = grid.cells[gridCoords.x]?.[gridCoords.z];
      if (cell?.occupied && cell.unitType) {
        const origin = this.gridData.findUnitOrigin(
          playerId,
          gridCoords.x,
          gridCoords.z
        );
        if (origin) {
          this.enterUpdateMode(playerId, origin.x, origin.z, cell.unitType);
        }
      }
      return;
    }
  }

  /**
   * Handle click while in placement mode
   */
  private handlePlacementModeClick(pickResult: PickingInfo | null): void {
    if (!this.activePlacementMode) return;

    const { playerId, unitType } = this.activePlacementMode;
    const grid = this.gridData.getGrid(playerId);
    if (!grid) return;

    const gridPlane = this.renderer.getGridGroundPlane(playerId);
    if (!pickResult?.hit || pickResult.pickedMesh !== gridPlane) return;

    const hitPoint = pickResult.pickedPoint;
    if (!hitPoint) return;

    const gridCoords = this.gridData.worldToGrid(playerId, hitPoint);
    if (!gridCoords) return;

    // Check if clicking on an existing unit - enter update mode instead
    const cell = grid.cells[gridCoords.x]?.[gridCoords.z];
    if (cell?.occupied && cell.unitType) {
      const origin = this.gridData.findUnitOrigin(
        playerId,
        gridCoords.x,
        gridCoords.z
      );
      if (origin) {
        this.enterUpdateMode(playerId, origin.x, origin.z, cell.unitType);
      }
      return;
    }

    // Check if player can afford this unit
    if (this.canAffordCallback && !this.canAffordCallback(playerId, unitType)) {
      this.eventBus.emit<FormationPlacementFailedEvent>(
        GameEvents.FORMATION_PLACEMENT_FAILED,
        {
          ...createEvent(),
          playerId,
          unitType,
          reason: 'insufficient_resources',
        }
      );
      return;
    }

    // Check if placement is valid
    if (
      this.gridData.canPlaceUnit(playerId, gridCoords.x, gridCoords.z, unitType)
    ) {
      this.eventBus.emit(GameEvents.FORMATION_PLACEMENT_REQUESTED, {
        ...createEvent(),
        playerId,
        team: grid.team,
        unitType,
        gridX: gridCoords.x,
        gridZ: gridCoords.z,
      });

      // Stay in placement mode, update highlight
      this.showHoverHighlightForPlacement(
        playerId,
        gridCoords.x,
        gridCoords.z,
        unitType,
        grid
      );
    }
  }

  /**
   * Enter placement mode for a unit type
   */
  public enterPlacementMode(
    playerId: string,
    unitType: FormationUnitType
  ): void {
    // Exit update mode if active
    if (this.activeUpdateMode?.playerId === playerId) {
      this.savedPlacementMode = null;
      this.exitUpdateMode(playerId);
    }

    this.activePlacementMode = { playerId, unitType };

    this.eventBus.emit<FormationModeEnteredEvent>(
      GameEvents.FORMATION_MODE_ENTERED,
      {
        ...createEvent(),
        playerId,
        unitType,
      }
    );  }

  /**
   * Exit placement mode
   */
  public exitPlacementMode(playerId: string): void {
    if (this.activePlacementMode?.playerId === playerId) {
      this.activePlacementMode = null;
      this.hoverPreview.hideHoverHighlight();
      this.hoverPreview.clearHoverUnitPreview();

      this.eventBus.emit<FormationModeExitedEvent>(
        GameEvents.FORMATION_MODE_EXITED,
        {
          ...createEvent(),
          playerId,
        }
      );
    }
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
    // Save placement mode to restore after exiting update mode
    if (this.activePlacementMode?.playerId === playerId) {
      this.savedPlacementMode = { ...this.activePlacementMode };
      this.activePlacementMode = null;
      this.hoverPreview.clearHoverUnitPreview();
    }

    this.activeUpdateMode = { playerId, gridX, gridZ, unitType };

    // Highlight the selected unit
    const grid = this.gridData.getGrid(playerId);
    if (grid) {
      const { width, depth } = this.gridData.getUnitGridSize(unitType);
      const worldWidth = width * grid.cellSize;
      const worldDepth = depth * grid.cellSize;
      const worldPos = this.gridData.getWorldPosWithOffset(
        playerId,
        gridX,
        gridZ,
        unitType
      );
      if (worldPos) {
        this.hoverPreview.highlightSelectedUnit(
          worldPos,
          worldWidth,
          worldDepth
        );
      }
    }

    this.eventBus.emit<FormationUpdateModeEnteredEvent>(
      GameEvents.FORMATION_UPDATE_MODE_ENTERED,
      {
        ...createEvent(),
        playerId,
        gridX,
        gridZ,
        unitType,
      }
    );
  }

  /**
   * Exit update mode
   */
  public exitUpdateMode(playerId: string): void {
    if (this.activeUpdateMode?.playerId === playerId) {
      this.activeUpdateMode = null;
      this.hoverPreview.hideHoverHighlight();
      this.hoverPreview.clearSelectedUnitHighlight();

      this.eventBus.emit<FormationUpdateModeExitedEvent>(
        GameEvents.FORMATION_UPDATE_MODE_EXITED,
        {
          ...createEvent(),
          playerId,
        }
      );

      // Restore previous placement mode
      if (this.savedPlacementMode?.playerId === playerId) {
        this.enterPlacementMode(playerId, this.savedPlacementMode.unitType);
        this.savedPlacementMode = null;
      }
    }
  }

  /**
   * Check if we're currently in update mode
   */
  public isInUpdateMode(playerId: string): boolean {
    return this.activeUpdateMode?.playerId === playerId;
  }

  /**
   * Check if we're currently in placement mode
   */
  public isInPlacementMode(playerId: string): boolean {
    return this.activePlacementMode?.playerId === playerId;
  }

  // ============================================
  // TOUCH DRAG METHODS (Mobile unit placement)
  // ============================================

  /**
   * Start touch drag for unit placement
   * Called when user starts dragging from a unit button
   */
  public startTouchDrag(playerId: string, unitType: FormationUnitType): void {
    // Exit any current modes
    if (this.activeUpdateMode?.playerId === playerId) {
      this.exitUpdateMode(playerId);
    }
    if (this.activePlacementMode?.playerId === playerId) {
      this.exitPlacementMode(playerId);
    }

    this.touchDragState = {
      playerId,
      unitType,
      isActive: true,
    };
  }

  /**
   * Update touch drag position
   * Shows preview over the grid at screen coordinates
   */
  public updateTouchDrag(screenX: number, screenY: number): void {
    if (!this.touchDragState?.isActive) return;

    const { playerId, unitType } = this.touchDragState;
    const grid = this.gridData.getGrid(playerId);
    if (!grid) return;

    // Pick the grid plane at the touch position
    const pickResult = this.scene.pick(screenX, screenY);
    const gridPlane = this.renderer.getGridGroundPlane(playerId);

    if (!pickResult?.hit || pickResult.pickedMesh !== gridPlane) {
      this.hoverPreview.hideHoverHighlight();
      return;
    }

    const hitPoint = pickResult.pickedPoint;
    if (!hitPoint) {
      this.hoverPreview.hideHoverHighlight();
      return;
    }

    const gridCoords = this.gridData.worldToGrid(playerId, hitPoint);
    if (!gridCoords) {
      this.hoverPreview.hideHoverHighlight();
      return;
    }

    // Show hover highlight
    this.showHoverHighlightForPlacement(
      playerId,
      gridCoords.x,
      gridCoords.z,
      unitType,
      grid
    );
  }

  /**
   * End touch drag - attempt to place unit at screen coordinates
   * Returns true if unit was placed successfully
   */
  public endTouchDrag(screenX: number, screenY: number): boolean {
    if (!this.touchDragState?.isActive) return false;

    const { playerId, unitType } = this.touchDragState;
    const grid = this.gridData.getGrid(playerId);

    // Clean up drag state
    this.touchDragState = null;
    this.hoverPreview.hideHoverHighlight();

    if (!grid) return false;

    // Pick the grid plane at the touch position
    const pickResult = this.scene.pick(screenX, screenY);
    const gridPlane = this.renderer.getGridGroundPlane(playerId);

    if (!pickResult?.hit || pickResult.pickedMesh !== gridPlane) {
      return false;
    }

    const hitPoint = pickResult.pickedPoint;
    if (!hitPoint) return false;

    const gridCoords = this.gridData.worldToGrid(playerId, hitPoint);
    if (!gridCoords) return false;

    // Check if player can afford this unit
    if (this.canAffordCallback && !this.canAffordCallback(playerId, unitType)) {
      this.eventBus.emit<FormationPlacementFailedEvent>(
        GameEvents.FORMATION_PLACEMENT_FAILED,
        {
          ...createEvent(),
          playerId,
          unitType,
          reason: 'insufficient_resources',
        }
      );
      return false;
    }

    // Check if placement is valid
    if (
      this.gridData.canPlaceUnit(playerId, gridCoords.x, gridCoords.z, unitType)
    ) {
      this.eventBus.emit(GameEvents.FORMATION_PLACEMENT_REQUESTED, {
        ...createEvent(),
        playerId,
        team: grid.team,
        unitType,
        gridX: gridCoords.x,
        gridZ: gridCoords.z,
      });
      return true;
    }

    return false;
  }

  /**
   * Cancel touch drag without placing
   */
  public cancelTouchDrag(): void {
    this.touchDragState = null;
    this.hoverPreview.hideHoverHighlight();
  }

  /**
   * Check if touch drag is currently active
   */
  public isTouchDragActive(): boolean {
    return this.touchDragState?.isActive ?? false;
  }

  /**
   * Cleanup
   */
  public dispose(): void {
    // Nothing specific to dispose, scene observer is managed by scene
  }
}
