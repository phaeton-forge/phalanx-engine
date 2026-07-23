import * as THREE from 'three';
import type { TeamId } from '../../components';
import type { UnitFactory } from '../../units/UnitFactory';
import type { UnitType } from '../../units/UnitType';

const VALID_COLOR = 0x44ff88;
const INVALID_COLOR = 0xff4444;
const GHOST_OPACITY = 0.25;

/**
 * FormationHoverPreview - Three.js hover feedback for placement/move.
 *
 * Shows:
 * - A green/red translucent highlight box over the target footprint
 * - A fainter ghost of the unit being placed or moved
 */
export class FormationHoverPreview {
  private readonly scene: THREE.Scene;
  private readonly unitFactory: UnitFactory;

  private readonly highlightBox: THREE.Mesh;
  private readonly validMaterial: THREE.MeshBasicMaterial;
  private readonly invalidMaterial: THREE.MeshBasicMaterial;

  private ghost: THREE.Object3D | null = null;
  private ghostType: UnitType | null = null;
  private ghostTeam: TeamId | null = null;

  constructor(scene: THREE.Scene, unitFactory: UnitFactory) {
    this.scene = scene;
    this.unitFactory = unitFactory;

    const geometry = new THREE.BoxGeometry(1, 0.1, 1);
    geometry.translate(0, 0, 0); // center at origin

    this.validMaterial = new THREE.MeshBasicMaterial({
      color: VALID_COLOR,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });

    this.invalidMaterial = new THREE.MeshBasicMaterial({
      color: INVALID_COLOR,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });

    this.highlightBox = new THREE.Mesh(geometry, this.validMaterial);
    this.highlightBox.visible = false;
    this.scene.add(this.highlightBox);
  }

  /**
   * Show or update the hover feedback at a world position.
   */
  show(
    worldPos: THREE.Vector3,
    worldWidth: number,
    worldDepth: number,
    unitType: UnitType,
    team: TeamId,
    isValid: boolean
  ): void {
    this.highlightBox.visible = true;
    this.highlightBox.position.set(worldPos.x, 0.06, worldPos.z);
    this.highlightBox.scale.set(worldWidth, 1, worldDepth);
    this.highlightBox.material = isValid
      ? this.validMaterial
      : this.invalidMaterial;

    this.ensureGhost(unitType, team);

    if (this.ghost) {
      const def = this.unitFactory.getDefinition(unitType);
      this.ghost.position.set(worldPos.x, def.heightOffset, worldPos.z);
      this.ghost.rotation.y = team === 0 ? 0 : Math.PI;
      this.ghost.visible = true;
    }
  }

  /**
   * Hide the hover feedback.
   */
  hide(): void {
    this.highlightBox.visible = false;
    if (this.ghost) {
      this.ghost.visible = false;
    }
  }

  /**
   * Dispose all Three.js resources owned by this class.
   */
  dispose(): void {
    this.scene.remove(this.highlightBox);
    this.highlightBox.geometry.dispose();
    this.validMaterial.dispose();
    this.invalidMaterial.dispose();

    if (this.ghost) {
      this.scene.remove(this.ghost);
      this.disposeObject3D(this.ghost);
      this.ghost = null;
      this.ghostType = null;
      this.ghostTeam = null;
    }
  }

  private ensureGhost(unitType: UnitType, team: TeamId): void {
    if (this.ghost && this.ghostType === unitType && this.ghostTeam === team) {
      return;
    }

    if (this.ghost) {
      this.scene.remove(this.ghost);
      this.disposeObject3D(this.ghost);
    }

    this.ghost = this.unitFactory.createFormationPreview(unitType, team);
    this.setGhostOpacity(this.ghost, GHOST_OPACITY);
    this.scene.add(this.ghost);
    this.ghostType = unitType;
    this.ghostTeam = team;
  }

  private setGhostOpacity(root: THREE.Object3D, opacity: number): void {
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];
        materials.forEach((material) => {
          if (
            material instanceof THREE.MeshStandardMaterial ||
            material instanceof THREE.MeshBasicMaterial
          ) {
            material.transparent = true;
            material.opacity = opacity;
            material.depthWrite = false;
          }
        });
      }
    });
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
