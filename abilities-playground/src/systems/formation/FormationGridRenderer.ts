import * as THREE from 'three';
import { arenaParams } from '../../config/constants';
import type { UnitFactory } from '../../units/UnitFactory';
import type { UnitType } from '../../units/UnitType';
import type { FormationGrid } from './FormationTypes';

/**
 * FormationGridRenderer - Three.js visual layer for a player's formation grid.
 *
 * Responsible for:
 * - Grid line visualization
 * - An invisible pick plane for raycasting
 * - Cosmetic preview meshes for placed units (via UnitFactory)
 *
 * All created objects are tracked and disposed by this class.
 */
export class FormationGridRenderer {
  private readonly scene: THREE.Scene;
  private readonly unitFactory: UnitFactory;

  private readonly gridLines: Map<string, THREE.LineSegments> = new Map();
  private readonly pickPlanes: Map<string, THREE.Mesh> = new Map();
  private readonly unitPreviews: Map<string, THREE.Object3D> = new Map();

  constructor(scene: THREE.Scene, unitFactory: UnitFactory) {
    this.scene = scene;
    this.unitFactory = unitFactory;
  }

  /**
   * All pick planes currently in the scene. Used by the input handler's raycaster.
   */
  get pickTargets(): THREE.Object3D[] {
    return Array.from(this.pickPlanes.values());
  }

  /**
   * All placed unit preview roots currently in the scene. Used by the input
   * handler's raycaster to detect pointer-down on an existing unit.
   */
  get unitPreviewTargets(): THREE.Object3D[] {
    return Array.from(this.unitPreviews.values());
  }

  /**
   * Create the visual grid lines and the invisible pick plane for a player.
   */
  initializeGrid(playerId: string, grid: FormationGrid): void {
    this.createGridLines(playerId, grid);
    this.createPickPlane(playerId, grid);
  }

  /**
   * Create or replace the grid line visualization for a player.
   */
  private createGridLines(playerId: string, grid: FormationGrid): void {
    this.disposeGridLines(playerId);

    const halfWidth = (grid.gridWidth * grid.cellSize) / 2;
    const halfDepth = (grid.gridHeight * grid.cellSize) / 2;
    const minX = grid.centerX - halfWidth;
    const maxX = grid.centerX + halfWidth;
    const minZ = grid.centerZ - halfDepth;
    const maxZ = grid.centerZ + halfDepth;

    const vertices: number[] = [];

    // Lines parallel to the X axis (constant Z).
    for (let z = 0; z <= grid.gridHeight; z++) {
      const worldZ = minZ + z * grid.cellSize;
      vertices.push(minX, 0.05, worldZ, maxX, 0.05, worldZ);
    }

    // Lines parallel to the Z axis (constant X).
    for (let x = 0; x <= grid.gridWidth; x++) {
      const worldX = minX + x * grid.cellSize;
      vertices.push(worldX, 0.05, minZ, worldX, 0.05, maxZ);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertices, 3)
    );

    const teamColor =
      grid.team === 0 ? arenaParams.team1Color : arenaParams.team2Color;
    const material = new THREE.LineBasicMaterial({
      color: teamColor,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });

    const lineSegments = new THREE.LineSegments(geometry, material);
    this.scene.add(lineSegments);
    this.gridLines.set(playerId, lineSegments);
  }

  /**
   * Create an invisible pick plane aligned with the grid area.
   */
  private createPickPlane(playerId: string, grid: FormationGrid): void {
    this.disposePickPlane(playerId);

    const geometry = new THREE.PlaneGeometry(
      grid.gridWidth * grid.cellSize,
      grid.gridHeight * grid.cellSize
    );
    const material = new THREE.MeshBasicMaterial({ visible: false });
    const plane = new THREE.Mesh(geometry, material);

    plane.rotation.x = -Math.PI / 2;
    plane.position.set(grid.centerX, 0, grid.centerZ);
    plane.userData = { playerId };

    this.scene.add(plane);
    this.pickPlanes.set(playerId, plane);
  }

  /**
   * Add a cosmetic preview mesh for a unit placed on the grid.
   */
  addUnitPreview(
    playerId: string,
    gridX: number,
    gridZ: number,
    unitType: UnitType,
    grid: FormationGrid,
    worldPos: THREE.Vector3
  ): void {
    const key = this.previewKey(playerId, gridX, gridZ);
    this.removeUnitPreviewByKey(key);

    const preview = this.unitFactory.createFormationPreview(
      unitType,
      grid.team
    );
    preview.position.copy(worldPos);

    const def = this.unitFactory.getDefinition(unitType);
    preview.position.y = def.heightOffset;

    preview.rotation.y = grid.team === 0 ? 0 : Math.PI;
    preview.userData = { playerId, gridX, gridZ, isUnitPreview: true };

    this.scene.add(preview);
    this.unitPreviews.set(key, preview);
  }

  /**
   * Move an existing preview mesh to a new grid position.
   */
  moveUnitPreview(
    playerId: string,
    fromGridX: number,
    fromGridZ: number,
    toGridX: number,
    toGridZ: number,
    worldPos: THREE.Vector3
  ): void {
    const oldKey = this.previewKey(playerId, fromGridX, fromGridZ);
    const preview = this.unitPreviews.get(oldKey);
    if (!preview) return;

    this.unitPreviews.delete(oldKey);

    const newKey = this.previewKey(playerId, toGridX, toGridZ);
    this.removeUnitPreviewByKey(newKey);

    preview.position.copy(worldPos);
    preview.userData = {
      playerId,
      gridX: toGridX,
      gridZ: toGridZ,
      isUnitPreview: true,
    };
    this.unitPreviews.set(newKey, preview);
  }

  /**
   * Remove the preview mesh for the unit whose origin is at (gridX, gridZ).
   */
  removeUnitPreview(playerId: string, gridX: number, gridZ: number): void {
    this.removeUnitPreviewByKey(this.previewKey(playerId, gridX, gridZ));
  }

  private removeUnitPreviewByKey(key: string): void {
    const preview = this.unitPreviews.get(key);
    if (!preview) return;

    this.scene.remove(preview);
    this.disposeObject3D(preview);
    this.unitPreviews.delete(key);
  }

  private previewKey(playerId: string, gridX: number, gridZ: number): string {
    return `${playerId}:${gridX}:${gridZ}`;
  }

  /**
   * Remove and dispose all visuals for a player.
   */
  clearPlayer(playerId: string): void {
    this.disposeGridLines(playerId);
    this.disposePickPlane(playerId);

    for (const [key, preview] of this.unitPreviews.entries()) {
      if (key.startsWith(`${playerId}:`)) {
        this.scene.remove(preview);
        this.disposeObject3D(preview);
        this.unitPreviews.delete(key);
      }
    }
  }

  /**
   * Dispose all tracked Three.js resources.
   */
  dispose(): void {
    for (const playerId of this.gridLines.keys()) {
      this.disposeGridLines(playerId);
    }

    for (const playerId of this.pickPlanes.keys()) {
      this.disposePickPlane(playerId);
    }

    for (const [key, preview] of this.unitPreviews.entries()) {
      this.scene.remove(preview);
      this.disposeObject3D(preview);
      this.unitPreviews.delete(key);
    }
  }

  private disposeGridLines(playerId: string): void {
    const lines = this.gridLines.get(playerId);
    if (!lines) return;

    lines.geometry.dispose();
    if (lines.material instanceof THREE.Material) {
      lines.material.dispose();
    }
    this.scene.remove(lines);
    this.gridLines.delete(playerId);
  }

  private disposePickPlane(playerId: string): void {
    const plane = this.pickPlanes.get(playerId);
    if (!plane) return;

    plane.geometry.dispose();
    if (plane.material instanceof THREE.Material) {
      plane.material.dispose();
    }
    this.scene.remove(plane);
    this.pickPlanes.delete(playerId);
  }

  private disposeObject3D(root: THREE.Object3D): void {
    root.traverse((child) => {
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
