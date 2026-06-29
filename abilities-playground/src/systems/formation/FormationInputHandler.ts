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
}

interface DragState {
  playerId: string;
  unitType: UnitType;
  /** Origin cell of an already-placed unit being moved. Undefined for palette placement. */
  source?: { gridX: number; gridZ: number };
}

/**
 * FormationInputHandler - DOM pointer input for drag-to-place and drag-to-move
 * unit deployment.
 *
 * - Drag starts from a UI unit button (via `startTouchDrag`) for new placements.
 * - Drag starts from a pointer-down on an existing preview unit (via internal
 *   canvas listener) for moving already-placed units.
 * - Pointer move raycasts against the invisible grid pick planes.
 * - Pointer up over a valid cell emits `onPlaceUnit` or `onMoveUnit`.
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

  private dragState: DragState | null = null;

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
   * Start a drag from a unit palette button.
   */
  startTouchDrag(playerId: string, unitType: UnitType): void {
    this.endTouchDrag();

    this.dragState = { playerId, unitType };
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  /**
   * Update the drag position from screen coordinates.
   */
  updateTouchDrag(clientX: number, clientY: number): void {
    if (!this.dragState) return;
    this.updateHover(clientX, clientY);
  }

  /**
   * End the current drag and attempt placement/movement.
   */
  endTouchDrag(): void {
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);

    this.hoverPreview.hide();
    this.dragState = null;
  }

  /**
   * Returns true if a drag is currently active.
   */
  isTouchDragActive(): boolean {
    return this.dragState !== null;
  }

  /**
   * Clean up any active listeners.
   */
  dispose(): void {
    this.endTouchDrag();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.dragState) return;

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

  private startMoveDrag(
    playerId: string,
    unitType: UnitType,
    fromGridX: number,
    fromGridZ: number
  ): void {
    this.endTouchDrag();

    this.dragState = {
      playerId,
      unitType,
      source: { gridX: fromGridX, gridZ: fromGridZ },
    };
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragState) return;
    this.updateHover(event.clientX, event.clientY);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.dragState) return;

    const { playerId, unitType, source } = this.dragState;
    const placement = this.resolveGridPlacement(event.clientX, event.clientY);

    this.endTouchDrag();

    if (!placement || placement.playerId !== playerId) return;

    const { gridX, gridZ } = placement;

    if (source) {
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
    } else {
      if (this.gridData.canPlaceUnit(playerId, gridX, gridZ, unitType)) {
        this.callbacks.onPlaceUnit?.(playerId, unitType, gridX, gridZ);
      }
    }
  };

  private updateHover(clientX: number, clientY: number): void {
    if (!this.dragState) return;

    const { playerId, unitType, source } = this.dragState;
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
