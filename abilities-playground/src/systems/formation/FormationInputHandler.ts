import * as THREE from 'three';
import type { UnitType } from '../../units/UnitType';
import type { FormationGridData } from './FormationGridData';
import type { FormationHoverPreview } from './FormationHoverPreview';
import type { FormationGridRenderer } from './FormationGridRenderer';

export interface FormationInputCallbacks {
  onPlaceUnit?: (
    playerId: string,
    unitType: UnitType,
    gridX: number,
    gridZ: number
  ) => void;
  onMoveUnit?: (
    playerId: string,
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number
  ) => void;
  /** Fired when placement selection ends (Esc, or explicit exit). */
  onPlacementSelectionEnd?: () => void;
  /** Fired when a drag-to-move gesture on a placed unit begins. */
  onMoveDragStart?: () => void;
  /** Fired when a drag-to-move gesture ends (drop or cancel). */
  onMoveDragEnd?: () => void;
}

interface PlacementSelection {
  playerId: string;
  unitType: UnitType;
}

interface MoveDragState {
  playerId: string;
  unitType: UnitType;
  source: { gridX: number; gridZ: number };
}

/**
 * FormationInputHandler - DOM pointer input for click-to-place and drag-to-move
 * unit deployment.
 *
 * - Click a unit palette button (via `enterPlacementMode`) to select a unit type.
 * - Click grid cells to place that unit repeatedly; Esc exits selection mode.
 * - Drag starts from a pointer-down on an existing preview unit for moving
 *   already-placed units (only when placement selection is inactive).
 * - Pointer move raycasts against the invisible grid pick planes for hover feedback.
 *
 * This class is purely local/cosmetic; it does not send commands or touch ECS state.
 */
export class FormationInputHandler {
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: THREE.Camera;
  private readonly raycaster: THREE.Raycaster;
  private readonly gridData: FormationGridData;
  private readonly gridRenderer: FormationGridRenderer;
  private readonly hoverPreview: FormationHoverPreview;
  private readonly callbacks: FormationInputCallbacks;

  private placementSelection: PlacementSelection | null = null;
  private moveDrag: MoveDragState | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    camera: THREE.Camera,
    gridData: FormationGridData,
    gridRenderer: FormationGridRenderer,
    hoverPreview: FormationHoverPreview,
    callbacks: FormationInputCallbacks = {}
  ) {
    this.canvas = canvas;
    this.camera = camera;
    this.raycaster = new THREE.Raycaster();
    this.gridData = gridData;
    this.gridRenderer = gridRenderer;
    this.hoverPreview = hoverPreview;
    this.callbacks = callbacks;

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
  }

  /**
   * Enter click-to-place selection for a unit type from the palette.
   */
  enterPlacementMode(playerId: string, unitType: UnitType): void {
    this.endMoveDrag();
    this.hoverPreview.hide();
    this.placementSelection = { playerId, unitType };
    window.addEventListener('pointermove', this.onPlacementPointerMove);
    window.addEventListener('keydown', this.onKeyDown);
  }

  /**
   * Exit click-to-place selection without placing.
   */
  exitPlacementMode(notify = true): void {
    if (!this.placementSelection) return;

    window.removeEventListener('pointermove', this.onPlacementPointerMove);
    window.removeEventListener('keydown', this.onKeyDown);
    this.hoverPreview.hide();
    this.placementSelection = null;

    if (notify) {
      this.callbacks.onPlacementSelectionEnd?.();
    }
  }

  /**
   * Returns true if a unit type is selected for click-to-place.
   */
  isPlacementModeActive(): boolean {
    return this.placementSelection !== null;
  }

  /**
   * Returns the currently selected unit type, if any.
   */
  getSelectedUnitType(): UnitType | null {
    return this.placementSelection?.unitType ?? null;
  }

  /**
   * Clean up any active listeners.
   */
  dispose(): void {
    this.exitPlacementMode(false);
    this.endMoveDrag();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.exitPlacementMode();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.moveDrag) return;

    if (this.placementSelection) {
      this.tryPlaceAt(event.clientX, event.clientY);
      return;
    }

    const hit = this.raycastUnitPreview(event.clientX, event.clientY);
    if (!hit) return;

    const root = this.findUnitPreviewRoot(hit);
    if (!root) return;

    const { playerId, gridX, gridZ } = root.userData as {
      playerId: string;
      gridX: number;
      gridZ: number;
    };
    if (typeof playerId !== 'string') return;

    const origin = this.gridData.findUnitOrigin(playerId, gridX, gridZ);
    if (!origin) return;

    const grid = this.gridData.getGrid(playerId);
    if (!grid) return;

    const cell = grid.cells[origin.x]?.[origin.z];
    if (!cell?.occupied || !cell.unitType) return;

    this.startMoveDrag(playerId, cell.unitType, origin.x, origin.z);
  };

  private tryPlaceAt(clientX: number, clientY: number): void {
    if (!this.placementSelection) return;

    const { playerId, unitType } = this.placementSelection;
    const placement = this.resolveGridPlacement(clientX, clientY);
    if (!placement || placement.playerId !== playerId) return;

    const { gridX, gridZ } = placement;
    if (this.gridData.canPlaceUnit(playerId, gridX, gridZ, unitType)) {
      this.callbacks.onPlaceUnit?.(playerId, unitType, gridX, gridZ);
      this.updateHover(clientX, clientY, playerId, unitType);
    }
  }

  private startMoveDrag(
    playerId: string,
    unitType: UnitType,
    fromGridX: number,
    fromGridZ: number
  ): void {
    this.endMoveDrag();

    this.moveDrag = {
      playerId,
      unitType,
      source: { gridX: fromGridX, gridZ: fromGridZ },
    };
    this.callbacks.onMoveDragStart?.();
    window.addEventListener('pointermove', this.onMovePointerMove);
    window.addEventListener('pointerup', this.onMovePointerUp);
    window.addEventListener('pointercancel', this.onMovePointerUp);
  }

  private endMoveDrag(): void {
    const wasDragging = this.moveDrag !== null;
    window.removeEventListener('pointermove', this.onMovePointerMove);
    window.removeEventListener('pointerup', this.onMovePointerUp);
    window.removeEventListener('pointercancel', this.onMovePointerUp);

    this.hoverPreview.hide();
    this.moveDrag = null;
    if (wasDragging) {
      this.callbacks.onMoveDragEnd?.();
    }
  }

  private readonly onPlacementPointerMove = (event: PointerEvent): void => {
    if (!this.placementSelection) return;
    this.updateHover(
      event.clientX,
      event.clientY,
      this.placementSelection.playerId,
      this.placementSelection.unitType
    );
  };

  private readonly onMovePointerMove = (event: PointerEvent): void => {
    if (!this.moveDrag) return;
    this.updateHover(
      event.clientX,
      event.clientY,
      this.moveDrag.playerId,
      this.moveDrag.unitType,
      this.moveDrag.source
    );
  };

  private readonly onMovePointerUp = (event: PointerEvent): void => {
    if (!this.moveDrag) return;

    const { playerId, unitType, source } = this.moveDrag;
    const placement = this.resolveGridPlacement(event.clientX, event.clientY);

    this.endMoveDrag();

    if (!placement || placement.playerId !== playerId) return;

    const { gridX, gridZ } = placement;
    const isSameCell = source.gridX === gridX && source.gridZ === gridZ;
    if (
      !isSameCell &&
      this.gridData.canMoveUnit(
        playerId,
        source.gridX,
        source.gridZ,
        gridX,
        gridZ,
        unitType
      )
    ) {
      this.callbacks.onMoveUnit?.(
        playerId,
        source.gridX,
        source.gridZ,
        gridX,
        gridZ
      );
    }
  };

  private updateHover(
    clientX: number,
    clientY: number,
    playerId: string,
    unitType: UnitType,
    source?: { gridX: number; gridZ: number }
  ): void {
    const resolved = this.resolveGridPlacement(clientX, clientY);

    if (!resolved || resolved.playerId !== playerId) {
      this.hoverPreview.hide();
      return;
    }

    const { gridX, gridZ } = resolved;
    const grid = this.gridData.getGrid(playerId);
    if (!grid) {
      this.hoverPreview.hide();
      return;
    }

    const worldPos = this.gridData.getWorldPosWithOffset(
      playerId,
      gridX,
      gridZ,
      unitType
    );
    if (!worldPos) {
      this.hoverPreview.hide();
      return;
    }

    const { width, depth } = this.gridData.getUnitGridSize(unitType);
    const isValid = source
      ? this.gridData.canMoveUnit(
          playerId,
          source.gridX,
          source.gridZ,
          gridX,
          gridZ,
          unitType
        )
      : this.gridData.canPlaceUnit(playerId, gridX, gridZ, unitType);

    this.hoverPreview.show(
      worldPos,
      width * grid.cellSize,
      depth * grid.cellSize,
      unitType,
      grid.team,
      isValid
    );
  }

  private resolveGridPlacement(
    clientX: number,
    clientY: number
  ): { playerId: string; gridX: number; gridZ: number } | null {
    const hit = this.raycastPickPlane(clientX, clientY);
    if (!hit) return null;

    const userData = hit.object.userData as { playerId?: unknown };
    const playerId = userData?.playerId;
    if (typeof playerId !== 'string') return null;

    const gridCoords = this.gridData.worldToGrid(playerId, hit.point);
    if (!gridCoords) return null;

    return { playerId, gridX: gridCoords.x, gridZ: gridCoords.z };
  }

  private raycastPickPlane(
    clientX: number,
    clientY: number
  ): THREE.Intersection<THREE.Object3D> | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );

    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.gridRenderer.pickTargets,
      false
    );
    return hits[0] ?? null;
  }

  private raycastUnitPreview(
    clientX: number,
    clientY: number
  ): THREE.Intersection<THREE.Object3D> | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );

    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.gridRenderer.unitPreviewTargets,
      true
    );
    return hits[0] ?? null;
  }

  private findUnitPreviewRoot(
    hit: THREE.Intersection<THREE.Object3D>
  ): THREE.Object3D | null {
    let obj: THREE.Object3D | null = hit.object;
    while (obj) {
      if (obj.userData?.isUnitPreview) return obj;
      obj = obj.parent;
    }
    return null;
  }
}
