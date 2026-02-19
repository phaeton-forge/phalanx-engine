import {
  Scene,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Mesh,
} from '@babylonjs/core';
import { TeamTag } from '../../enums/TeamTag';
import { arenaParams } from '../../config/constants';
import { AssetManager, type ModelInstance } from '../../core/AssetManager';
import type { FormationUnitType, FormationGrid } from './FormationTypes';

/**
 * FormationHoverPreview - Handles hover highlight and unit preview rendering
 * Responsible for showing visual feedback when hovering over grid cells
 */
export class FormationHoverPreview {
  private scene: Scene;

  // Hover highlight mesh (shows valid/invalid placement area)
  private hoverHighlight: Mesh | null = null;
  private hoverHighlightMaterial: StandardMaterial | null = null;
  private invalidHighlightMaterial: StandardMaterial | null = null;

  // Hover unit preview mesh (shows transparent unit preview when hovering in placement mode)
  private hoverUnitPreview: Mesh | null = null;
  private hoverUnitPreviewType: FormationUnitType | null = null;

  // Model instance for mutant hover preview
  private mutantHoverInstance: ModelInstance | null = null;

  // Selected unit highlight (for update mode)
  private selectedUnitHighlight: Mesh | null = null;
  private selectedUnitHighlightMaterial: StandardMaterial | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
    this.createHighlightMaterials();
  }

  /**
   * Create materials for hover highlight
   */
  private createHighlightMaterials(): void {
    // Valid placement - green
    this.hoverHighlightMaterial = new StandardMaterial(
      'hoverHighlight',
      this.scene
    );
    this.hoverHighlightMaterial.diffuseColor = new Color3(0.2, 0.8, 0.2);
    this.hoverHighlightMaterial.alpha = 0.5;
    this.hoverHighlightMaterial.emissiveColor = new Color3(0.1, 0.4, 0.1);

    // Invalid placement - red
    this.invalidHighlightMaterial = new StandardMaterial(
      'invalidHighlight',
      this.scene
    );
    this.invalidHighlightMaterial.diffuseColor = new Color3(0.8, 0.2, 0.2);
    this.invalidHighlightMaterial.alpha = 0.5;
    this.invalidHighlightMaterial.emissiveColor = new Color3(0.4, 0.1, 0.1);
  }

  /**
   * Show hover highlight at grid position
   */
  public showHoverHighlight(
    worldPos: Vector3,
    worldWidth: number,
    worldDepth: number,
    isValid: boolean,
    grid: FormationGrid,
    unitType: FormationUnitType
  ): void {
    // Create or update highlight mesh
    if (!this.hoverHighlight) {
      this.hoverHighlight = MeshBuilder.CreateBox(
        'hoverHighlight',
        { width: worldWidth, height: 0.2, depth: worldDepth },
        this.scene
      );
      this.hoverHighlight.isPickable = false;
    } else {
      this.hoverHighlight.dispose();
      this.hoverHighlight = MeshBuilder.CreateBox(
        'hoverHighlight',
        { width: worldWidth, height: 0.2, depth: worldDepth },
        this.scene
      );
      this.hoverHighlight.isPickable = false;
    }

    this.hoverHighlight.position = new Vector3(worldPos.x, 0.15, worldPos.z);
    this.hoverHighlight.material = isValid
      ? this.hoverHighlightMaterial
      : this.invalidHighlightMaterial;
    this.hoverHighlight.isVisible = true;

    // Show unit preview mesh
    this.showHoverUnitPreview(worldPos, unitType, grid.team);
  }

  /**
   * Show hover highlight for move operation (in update mode)
   */
  public showHoverHighlightForMove(
    worldPos: Vector3,
    worldWidth: number,
    worldDepth: number,
    isValid: boolean
  ): void {
    // Create or update highlight mesh
    if (!this.hoverHighlight) {
      this.hoverHighlight = MeshBuilder.CreateBox(
        'hoverHighlight',
        { width: worldWidth, height: 0.2, depth: worldDepth },
        this.scene
      );
      this.hoverHighlight.isPickable = false;
    } else {
      this.hoverHighlight.dispose();
      this.hoverHighlight = MeshBuilder.CreateBox(
        'hoverHighlight',
        { width: worldWidth, height: 0.2, depth: worldDepth },
        this.scene
      );
      this.hoverHighlight.isPickable = false;
    }

    this.hoverHighlight.position = new Vector3(worldPos.x, 0.15, worldPos.z);
    this.hoverHighlight.material = isValid
      ? this.hoverHighlightMaterial
      : this.invalidHighlightMaterial;
    this.hoverHighlight.isVisible = true;
  }

  /**
   * Show a transparent unit preview mesh at the hover position
   */
  private showHoverUnitPreview(
    worldPos: Vector3,
    unitType: FormationUnitType,
    team: TeamTag
  ): void {
    // Recreate if unit type changed
    if (this.hoverUnitPreview && this.hoverUnitPreviewType !== unitType) {
      this.hoverUnitPreview.dispose();
      this.hoverUnitPreview = null;
      this.hoverUnitPreviewType = null;
    }

    const teamColor =
      team === TeamTag.Team1
        ? arenaParams.colors.teamA
        : arenaParams.colors.teamB;
    const color = new Color3(teamColor.r, teamColor.g, teamColor.b);

    // Create preview mesh if it doesn't exist
    if (!this.hoverUnitPreview) {
      if (unitType === 'sphere') {
        this.hoverUnitPreview = this.createHoverSpherePreview(color);
      } else if (unitType === 'mutant') {
        this.hoverUnitPreview = this.createHoverMutantPreview(color, team);
      } else if (unitType === 'prisma') {
        this.hoverUnitPreview = this.createHoverPrismaPreview(color);
      } else {
        this.hoverUnitPreview = this.createHoverLancePreview(color, team);
      }
      this.hoverUnitPreviewType = unitType;
    }

    // Position the preview
    this.hoverUnitPreview.position = new Vector3(worldPos.x, 1.0, worldPos.z);
    this.hoverUnitPreview.setEnabled(true);
  }

  /**
   * Create a transparent mutant preview for hover using preloaded model
   * Sized for 2x2 grid cells
   */
  private createHoverMutantPreview(teamColor: Color3, team: TeamTag): Mesh {
    const assetManager = AssetManager.getInstance();

    if (assetManager) {
      const instance = assetManager.createPreviewInstance(
        'mutant',
        'hoverUnitPreview_mutant'
      );
      if (instance) {
        // Store the instance for proper disposal
        this.mutantHoverInstance = instance;

        // Create a parent mesh to serve as the "hover preview mesh"
        const parentMesh = new Mesh('hoverUnitPreview_mutant', this.scene);

        // Parent the model to this mesh
        instance.rootNode.parent = parentMesh;
        instance.rootNode.position = Vector3.Zero();

        // Scale for 2x2 grid size (same as MutantUnit)
        instance.rootNode.scaling = new Vector3(0.06, 0.06, 0.06);

        // GLB files use rotationQuaternion which overrides Euler angles
        // Clear it so we can use rotation.y
        instance.rootNode.rotationQuaternion = null;

        // Rotate to face forward based on team
        // The model faces along Z axis by default, but units move along X axis
        // Team1 faces +X (rotate +90 degrees), Team2 faces -X (rotate -90 degrees)
        if (team === TeamTag.Team1) {
          instance.rootNode.rotation.y = Math.PI / 2; // Face +X
        } else {
          instance.rootNode.rotation.y = -Math.PI / 2; // Face -X
        }

        // Make meshes transparent for hover effect
        for (const mesh of instance.meshes) {
          if (mesh.material) {
            const mat = mesh.material.clone(`${mesh.material.name}_hover`);
            if (mat && 'alpha' in mat) {
              (mat as StandardMaterial).alpha = 0.4;
              (mat as StandardMaterial).emissiveColor = teamColor.scale(0.2);
            }
            mesh.material = mat;
          }
          mesh.isPickable = false;
        }

        // Play idle animation
        const idleAnim = instance.animationGroups.find((ag) =>
          ag.name.includes('Idle')
        );
        if (idleAnim) {
          idleAnim.start(true, 1.0);
        }

        parentMesh.isPickable = false;
        return parentMesh;
      }
    }

    // Fallback to capsule (sized for 2x2)
    const mesh = MeshBuilder.CreateCapsule(
      'hoverUnitPreview_mutant',
      { height: 4, radius: 1.0 },
      this.scene
    );

    const material = new StandardMaterial(
      'hoverUnitPreviewMat_mutant',
      this.scene
    );
    material.diffuseColor = teamColor;
    material.alpha = 0.4;
    material.emissiveColor = teamColor.scale(0.2);
    mesh.material = material;
    mesh.isPickable = false;

    return mesh;
  }

  /**
   * Create a transparent sphere preview for hover
   */
  private createHoverSpherePreview(teamColor: Color3): Mesh {
    const mesh = MeshBuilder.CreateSphere(
      'hoverUnitPreview_sphere',
      { diameter: 2 },
      this.scene
    );

    const material = new StandardMaterial(
      'hoverUnitPreviewMat_sphere',
      this.scene
    );
    material.diffuseColor = teamColor;
    material.alpha = 0.4;
    material.emissiveColor = teamColor.scale(0.2);
    mesh.material = material;
    mesh.isPickable = false;

    return mesh;
  }

  /**
   * Create a transparent prisma preview for hover
   */
  private createHoverPrismaPreview(teamColor: Color3): Mesh {
    const parentMesh = new Mesh('hoverUnitPreview_prisma', this.scene);

    const prismSize = 1.5;
    const spacing = 1.8;
    const positions = [
      new Vector3(-spacing / 2, 0, -spacing / 2),
      new Vector3(spacing / 2, 0, -spacing / 2),
      new Vector3(-spacing / 2, 0, spacing / 2),
      new Vector3(spacing / 2, 0, spacing / 2),
    ];

    const prismMaterial = new StandardMaterial('hoverPrismMat', this.scene);
    prismMaterial.diffuseColor = new Color3(0.4, 0.4, 0.45);
    prismMaterial.alpha = 0.4;
    prismMaterial.emissiveColor = new Color3(0.1, 0.1, 0.12);

    positions.forEach((pos, index) => {
      const prism = MeshBuilder.CreateCylinder(
        `hoverPrism_${index}`,
        { height: prismSize * 1.5, diameter: prismSize * 0.8, tessellation: 3 },
        this.scene
      );
      prism.parent = parentMesh;
      prism.position = pos;
      prism.rotation.y = (index * Math.PI) / 2;
      prism.material = prismMaterial;
      prism.isPickable = false;
    });

    // Create central crystal with team color
    const crystal = MeshBuilder.CreatePolyhedron(
      'hoverCrystal',
      { type: 1, size: 0.6 },
      this.scene
    );
    crystal.position = new Vector3(0, 1.2, 0);
    crystal.scaling = new Vector3(0.8, 1.4, 0.8);
    crystal.parent = parentMesh;
    crystal.isPickable = false;

    const crystalMaterial = new StandardMaterial('hoverCrystalMat', this.scene);
    crystalMaterial.diffuseColor = teamColor;
    crystalMaterial.emissiveColor = teamColor.scale(0.2);
    crystalMaterial.alpha = 0.5;
    crystal.material = crystalMaterial;

    parentMesh.isPickable = false;
    return parentMesh;
  }

  /**
   * Create a transparent lance preview for hover
   */
  private createHoverLancePreview(teamColor: Color3, team: TeamTag): Mesh {
    const parentMesh = new Mesh('hoverUnitPreview_lance', this.scene);

    const bodyLength = 4.0;

    // Main body
    const body = MeshBuilder.CreateCylinder(
      'hoverBody',
      {
        height: bodyLength,
        diameterTop: 0.9,
        diameterBottom: 1.1,
        tessellation: 12,
      },
      this.scene
    );
    body.rotation.z = -Math.PI / 2;
    body.position.y = 0;
    body.parent = parentMesh;
    body.isPickable = false;

    const bodyMaterial = new StandardMaterial('hoverBodyMat', this.scene);
    bodyMaterial.diffuseColor = new Color3(0.5, 0.5, 0.55);
    bodyMaterial.alpha = 0.4;
    bodyMaterial.emissiveColor = new Color3(0.1, 0.1, 0.12);
    body.material = bodyMaterial;

    // Spear tip
    const tip = MeshBuilder.CreateCylinder(
      'hoverTip',
      { height: 1.5, diameterTop: 0, diameterBottom: 0.7, tessellation: 8 },
      this.scene
    );
    tip.rotation.z = -Math.PI / 2;
    tip.position.y = 0;
    tip.position.x = bodyLength / 2 + 0.75;
    tip.parent = parentMesh;
    tip.isPickable = false;

    const tipMaterial = new StandardMaterial('hoverTipMat', this.scene);
    tipMaterial.diffuseColor = new Color3(0.7, 0.7, 0.75);
    tipMaterial.alpha = 0.4;
    tipMaterial.emissiveColor = new Color3(0.15, 0.15, 0.17);
    tip.material = tipMaterial;

    // Central crystal
    const crystal = MeshBuilder.CreatePolyhedron(
      'hoverLanceCrystal',
      { type: 1, size: 0.55 },
      this.scene
    );
    crystal.position = new Vector3(0, 0.7, 0);
    crystal.scaling = new Vector3(0.8, 1.2, 0.8);
    crystal.parent = parentMesh;
    crystal.isPickable = false;

    const crystalMaterial = new StandardMaterial(
      'hoverLanceCrystalMat',
      this.scene
    );
    crystalMaterial.diffuseColor = teamColor;
    crystalMaterial.emissiveColor = teamColor.scale(0.2);
    crystalMaterial.alpha = 0.5;
    crystal.material = crystalMaterial;

    // Rotate 180 degrees for Team2
    if (team === TeamTag.Team2) {
      parentMesh.rotation.y = Math.PI;
    }

    parentMesh.isPickable = false;
    return parentMesh;
  }

  /**
   * Hide the hover highlight and unit preview
   */
  public hideHoverHighlight(): void {
    if (this.hoverHighlight) {
      this.hoverHighlight.isVisible = false;
    }
    this.hideHoverUnitPreview();
  }

  /**
   * Hide the hover unit preview
   */
  private hideHoverUnitPreview(): void {
    if (this.hoverUnitPreview) {
      this.hoverUnitPreview.setEnabled(false);
    }
  }

  /**
   * Clear and dispose the hover unit preview
   */
  public clearHoverUnitPreview(): void {
    // Dispose mutant model instance if exists
    if (this.mutantHoverInstance) {
      this.mutantHoverInstance.dispose();
      this.mutantHoverInstance = null;
    }

    if (this.hoverUnitPreview) {
      this.hoverUnitPreview.dispose();
      this.hoverUnitPreview = null;
      this.hoverUnitPreviewType = null;
    }
  }

  /**
   * Highlight the currently selected unit in update mode
   */
  public highlightSelectedUnit(
    worldPos: Vector3,
    worldWidth: number,
    worldDepth: number
  ): void {
    this.clearSelectedUnitHighlight();

    // Create highlight material if needed
    if (!this.selectedUnitHighlightMaterial) {
      this.selectedUnitHighlightMaterial = new StandardMaterial(
        'selectedUnitHighlight',
        this.scene
      );
      this.selectedUnitHighlightMaterial.diffuseColor = new Color3(
        1.0,
        0.85,
        0.2
      ); // Yellow/gold
      this.selectedUnitHighlightMaterial.alpha = 0.6;
      this.selectedUnitHighlightMaterial.emissiveColor = new Color3(
        0.5,
        0.4,
        0.1
      );
    }

    // Create highlight mesh
    this.selectedUnitHighlight = MeshBuilder.CreateBox(
      'selectedUnitHighlight',
      { width: worldWidth, height: 0.3, depth: worldDepth },
      this.scene
    );
    this.selectedUnitHighlight.isPickable = false;
    this.selectedUnitHighlight.position = new Vector3(
      worldPos.x,
      0.25,
      worldPos.z
    );
    this.selectedUnitHighlight.material = this.selectedUnitHighlightMaterial;
  }

  /**
   * Clear the selected unit highlight
   */
  public clearSelectedUnitHighlight(): void {
    if (this.selectedUnitHighlight) {
      this.selectedUnitHighlight.dispose();
      this.selectedUnitHighlight = null;
    }
  }

  /**
   * Cleanup
   */
  public dispose(): void {
    // Dispose hover highlight
    if (this.hoverHighlight) {
      this.hoverHighlight.dispose();
      this.hoverHighlight = null;
    }

    // Dispose hover unit preview
    this.clearHoverUnitPreview();

    // Dispose selected unit highlight
    this.clearSelectedUnitHighlight();
    this.selectedUnitHighlightMaterial?.dispose();
    this.selectedUnitHighlightMaterial = null;

    // Dispose highlight materials
    this.hoverHighlightMaterial?.dispose();
    this.invalidHighlightMaterial?.dispose();
  }
}
