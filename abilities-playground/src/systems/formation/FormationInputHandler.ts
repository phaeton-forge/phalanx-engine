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
}

interface DragState {
  playerId: string;
  unitType: UnitType;
}

/**
 * FormationInputHandler - DOM pointer input for drag-to-place unit deployment.
 *
 * - Drag starts from a UI unit button (via `startTouchDrag`).
 * - Pointer move raycasts against the invisible grid pick planes.
 * - Pointer up over a valid cell emits `onPlaceUnit`.
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

    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
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
   * End the current drag and attempt placement.
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
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.dragState) return;
    this.updateHover(event.clientX, event.clientY);
  }

  private onPointerUp(event: PointerEvent): void {
    if (!this.dragState) return;

    const { playerId, unitType } = this.dragState;
    const placement = this.resolveGridPlacement(event.clientX, event.clientY);

    this.endTouchDrag();

    if (
      placement &&
      this.gridData.canPlaceUnit(
        playerId,
        placement.gridX,
        placement.gridZ,
        unitType
      )
    ) {
      this.callbacks.onPlaceUnit?.(
        playerId,
        unitType,
        placement.gridX,
        placement.gridZ
      );
    }
  }

  private updateHover(clientX: number, clientY: number): void {
    if (!this.dragState) return;

    const { playerId, unitType } = this.dragState;
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
    const isValid = this.gridData.canPlaceUnit(
      playerId,
      gridX,
      gridZ,
      unitType
    );

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

    const playerId = hit.object.userData?.playerId;
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
}
