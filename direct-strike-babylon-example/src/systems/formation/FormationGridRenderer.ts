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
 * FormationGridRenderer - Handles visual rendering of the formation grid
 * Responsible for creating grid lines, ground planes, and unit preview meshes
 */
export class FormationGridRenderer {
  private scene: Scene;
  private gridVisuals: Map<string, Mesh[]> = new Map();
  private gridGroundPlanes: Map<string, Mesh> = new Map();
  // Store model instances for proper disposal
  private mutantInstances: Map<string, ModelInstance> = new Map();

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /**
   * Create visual representation of the formation grid (lines)
   */
  public createGridVisualization(playerId: string, grid: FormationGrid): void {
    const meshes: Mesh[] = [];
    const halfWidth = (grid.gridWidth * grid.cellSize) / 2;
    const halfHeight = (grid.gridHeight * grid.cellSize) / 2;

    // Create grid lines
    const material = new StandardMaterial(`gridMat_${playerId}`, this.scene);
    const color = arenaParams.colors.gridLine;
    material.diffuseColor = new Color3(color.r, color.g, color.b);
    material.alpha = 0.5;

    // Horizontal lines
    for (let z = 0; z <= grid.gridHeight; z++) {
      const line = MeshBuilder.CreateBox(
        `gridLineH_${playerId}_${z}`,
        { width: grid.gridWidth * grid.cellSize, height: 0.1, depth: 0.1 },
        this.scene
      );
      line.position = new Vector3(
        grid.centerX,
        0.1,
        grid.centerZ - halfHeight + z * grid.cellSize
      );
      line.material = material;
      line.isPickable = false;
      meshes.push(line);
    }

    // Vertical lines
    for (let x = 0; x <= grid.gridWidth; x++) {
      const line = MeshBuilder.CreateBox(
        `gridLineV_${playerId}_${x}`,
        { width: 0.1, height: 0.1, depth: grid.gridHeight * grid.cellSize },
        this.scene
      );
      line.position = new Vector3(
        grid.centerX - halfWidth + x * grid.cellSize,
        0.1,
        grid.centerZ
      );
      line.material = material;
      line.isPickable = false;
      meshes.push(line);
    }

    this.gridVisuals.set(playerId, meshes);
  }

  /**
   * Create an invisible ground plane for the grid for mouse picking
   */
  public createGridGroundPlane(playerId: string, grid: FormationGrid): void {
    const totalWidth = grid.gridWidth * grid.cellSize;
    const totalHeight = grid.gridHeight * grid.cellSize;

    const plane = MeshBuilder.CreateGround(
      `gridPlane_${playerId}`,
      { width: totalWidth, height: totalHeight },
      this.scene
    );

    plane.position = new Vector3(grid.centerX, 0.05, grid.centerZ);

    // Make it invisible but pickable
    const material = new StandardMaterial(
      `gridPlaneMat_${playerId}`,
      this.scene
    );
    material.alpha = 0; // Invisible
    plane.material = material;
    plane.isPickable = true;

    this.gridGroundPlanes.set(playerId, plane);
  }

  /**
   * Get the grid ground plane for a player (used for picking)
   */
  public getGridGroundPlane(playerId: string): Mesh | undefined {
    return this.gridGroundPlanes.get(playerId);
  }

  /**
   * Create a preview mesh for a placed unit
   */
  public createUnitPreview(
    playerId: string,
    gridX: number,
    gridZ: number,
    unitType: FormationUnitType,
    grid: FormationGrid,
    worldPos: Vector3
  ): Mesh {
    const teamColor =
      grid.team === TeamTag.Team1
        ? arenaParams.colors.teamA
        : arenaParams.colors.teamB;
    const color = new Color3(teamColor.r, teamColor.g, teamColor.b);

    let mesh: Mesh;
    if (unitType === 'sphere') {
      mesh = this.createSpherePreview(playerId, gridX, gridZ, color);
    } else if (unitType === 'mutant') {
      mesh = this.createMutantPreview(playerId, gridX, gridZ, color, grid.team);
    } else if (unitType === 'prisma') {
      mesh = this.createPrismaPreview(playerId, gridX, gridZ, color);
    } else {
      mesh = this.createLancePreview(playerId, gridX, gridZ, color, grid.team);
    }

    mesh.position = worldPos;
    mesh.isPickable = false;

    return mesh;
  }

  /**
   * Create a mutant unit preview mesh using the preloaded model
   * Sized for 2x2 grid cells
   */
  private createMutantPreview(
    playerId: string,
    gridX: number,
    gridZ: number,
    teamColor: Color3,
    team: TeamTag
  ): Mesh {
    const assetManager = AssetManager.getInstance();
    const instanceKey = `preview_${playerId}_${gridX}_${gridZ}`;

    // Try to create an instance from the preloaded model
    if (assetManager) {
      const instance = assetManager.createPreviewInstance(
        'mutant',
        instanceKey
      );
      if (instance) {
        // Store the instance for proper disposal
        this.mutantInstances.set(instanceKey, instance);

        // Create a parent mesh to serve as the "preview mesh"
        // This is needed because the grid system expects a Mesh
        const parentMesh = new Mesh(instanceKey, this.scene);

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

        // Make meshes transparent for preview effect
        for (const mesh of instance.meshes) {
          if (mesh.material) {
            const mat = mesh.material.clone(`${mesh.material.name}_preview`);
            if (mat && 'alpha' in mat) {
              (mat as StandardMaterial).alpha = 0.6;
            }
            mesh.material = mat;
          }
          mesh.isPickable = false;
        }

        // Play idle animation for preview
        const idleAnim = instance.animationGroups.find((ag) =>
          ag.name.includes('Idle')
        );
        if (idleAnim) {
          idleAnim.start(true, 1.0);
        }

        return parentMesh;
      }
    }

    // Fallback to capsule if asset manager not available (sized for 2x2)
    const mesh = MeshBuilder.CreateCapsule(
      instanceKey,
      { height: 4, radius: 1.0 },
      this.scene
    );

    const material = new StandardMaterial(
      `previewMat_${playerId}_${gridX}_${gridZ}`,
      this.scene
    );
    material.diffuseColor = teamColor;
    material.alpha = 0.6;
    mesh.material = material;

    return mesh;
  }

  /**
   * Create a sphere unit preview mesh
   */
  private createSpherePreview(
    playerId: string,
    gridX: number,
    gridZ: number,
    teamColor: Color3
  ): Mesh {
    const mesh = MeshBuilder.CreateSphere(
      `preview_${playerId}_${gridX}_${gridZ}`,
      { diameter: 2 },
      this.scene
    );

    const material = new StandardMaterial(
      `previewMat_${playerId}_${gridX}_${gridZ}`,
      this.scene
    );
    material.diffuseColor = teamColor;
    material.alpha = 0.6;
    mesh.material = material;

    return mesh;
  }

  /**
   * Create a prisma unit preview mesh (4 triangular prisms + central crystal)
   */
  private createPrismaPreview(
    playerId: string,
    gridX: number,
    gridZ: number,
    teamColor: Color3
  ): Mesh {
    const parentMesh = new Mesh(
      `preview_${playerId}_${gridX}_${gridZ}`,
      this.scene
    );

    // Create 4 prisms arranged in a 2x2 pattern
    const prismSize = 1.5;
    const spacing = 1.8;
    const positions = [
      new Vector3(-spacing / 2, 0, -spacing / 2),
      new Vector3(spacing / 2, 0, -spacing / 2),
      new Vector3(-spacing / 2, 0, spacing / 2),
      new Vector3(spacing / 2, 0, spacing / 2),
    ];

    const prismMaterial = new StandardMaterial(
      `previewPrismMat_${playerId}_${gridX}_${gridZ}`,
      this.scene
    );
    prismMaterial.diffuseColor = new Color3(0.4, 0.4, 0.45);
    prismMaterial.alpha = 0.6;

    positions.forEach((pos, index) => {
      const prism = MeshBuilder.CreateCylinder(
        `previewPrism_${playerId}_${gridX}_${gridZ}_${index}`,
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
      `previewCrystal_${playerId}_${gridX}_${gridZ}`,
      { type: 1, size: 0.6 },
      this.scene
    );
    crystal.position = new Vector3(0, 1.2, 0);
    crystal.scaling = new Vector3(0.8, 1.4, 0.8);
    crystal.parent = parentMesh;
    crystal.isPickable = false;

    const crystalMaterial = new StandardMaterial(
      `previewCrystalMat_${playerId}_${gridX}_${gridZ}`,
      this.scene
    );
    crystalMaterial.diffuseColor = teamColor;
    crystalMaterial.emissiveColor = teamColor.scale(0.3);
    crystalMaterial.alpha = 0.7;
    crystal.material = crystalMaterial;

    return parentMesh;
  }

  /**
   * Create a lance unit preview mesh (body + tip + crystal)
   */
  private createLancePreview(
    playerId: string,
    gridX: number,
    gridZ: number,
    teamColor: Color3,
    team: TeamTag
  ): Mesh {
    const parentMesh = new Mesh(
      `preview_${playerId}_${gridX}_${gridZ}`,
      this.scene
    );

    const bodyLength = 4.0;

    // Main body - elongated cylinder along X-axis (forward)
    const body = MeshBuilder.CreateCylinder(
      `previewBody_${playerId}_${gridX}_${gridZ}`,
      {
        height: bodyLength,
        diameterTop: 0.9,
        diameterBottom: 1.1,
        tessellation: 12,
      },
      this.scene
    );
    body.rotation.z = -Math.PI / 2;
    body.position.y = 1.0;
    body.parent = parentMesh;
    body.isPickable = false;

    const bodyMaterial = new StandardMaterial(
      `previewBodyMat_${playerId}_${gridX}_${gridZ}`,
      this.scene
    );
    bodyMaterial.diffuseColor = new Color3(0.5, 0.5, 0.55);
    bodyMaterial.alpha = 0.6;
    body.material = bodyMaterial;

    // Spear tip - cone at front (positive X) - larger
    const tip = MeshBuilder.CreateCylinder(
      `previewTip_${playerId}_${gridX}_${gridZ}`,
      { height: 1.5, diameterTop: 0, diameterBottom: 0.7, tessellation: 8 },
      this.scene
    );
    tip.rotation.z = -Math.PI / 2;
    tip.position.y = 1.0;
    tip.position.x = bodyLength / 2 + 0.75;
    tip.parent = parentMesh;
    tip.isPickable = false;

    const tipMaterial = new StandardMaterial(
      `previewTipMat_${playerId}_${gridX}_${gridZ}`,
      this.scene
    );
    tipMaterial.diffuseColor = new Color3(0.7, 0.7, 0.75);
    tipMaterial.alpha = 0.6;
    tip.material = tipMaterial;

    // Central crystal with team color - larger
    const crystal = MeshBuilder.CreatePolyhedron(
      `previewCrystal_${playerId}_${gridX}_${gridZ}`,
      { type: 1, size: 0.55 },
      this.scene
    );
    crystal.position = new Vector3(0, 1.7, 0);
    crystal.scaling = new Vector3(0.8, 1.2, 0.8);
    crystal.parent = parentMesh;
    crystal.isPickable = false;

    const crystalMaterial = new StandardMaterial(
      `previewCrystalMat_${playerId}_${gridX}_${gridZ}`,
      this.scene
    );
    crystalMaterial.diffuseColor = teamColor;
    crystalMaterial.emissiveColor = teamColor.scale(0.3);
    crystalMaterial.alpha = 0.7;
    crystal.material = crystalMaterial;

    // Rotate 180 degrees for Team2 so lance faces towards enemy
    if (team === TeamTag.Team2) {
      parentMesh.rotation.y = Math.PI;
    }

    return parentMesh;
  }

  /**
   * Cleanup
   */
  public dispose(): void {
    // Dispose grid visuals
    for (const meshes of this.gridVisuals.values()) {
      meshes.forEach((m) => m.dispose());
    }
    this.gridVisuals.clear();

    // Dispose grid ground planes
    for (const plane of this.gridGroundPlanes.values()) {
      plane.dispose();
    }
    this.gridGroundPlanes.clear();

    // Dispose mutant model instances
    for (const instance of this.mutantInstances.values()) {
      instance.dispose();
    }
    this.mutantInstances.clear();
  }
}
