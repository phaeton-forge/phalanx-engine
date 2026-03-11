import {
  Scene,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Mesh,
  VertexData,
} from '@babylonjs/core';
import { Unit } from './Unit';
import {
  ComponentType,
  TeamComponent,
  HealthComponent,
  AttackComponent,
  MovementComponent,
  UnitTypeComponent,
  UnitType,
  DeathComponent,
} from '../components';
import { TeamTag } from '../enums/TeamTag';

export interface PrismaUnitConfig {
  color?: Color3;
  team?: TeamTag;
  attackRange?: number;
  attackCooldown?: number;
  attackDamage?: number;
  health?: number;
  moveSpeed?: number;
  debug?: boolean;
}

/**
 * PrismaUnit entity - A larger 2x2 combat unit built from triangular prisms
 * Uses component-based architecture
 */
export class PrismaUnit extends Unit {
  private rangeIndicator: Mesh | null = null;
  private _debug: boolean;
  private _color: Color3;

  constructor(
    scene: Scene,
    config: PrismaUnitConfig = {},
    position: Vector3 = new Vector3(0, 1, 0)
  ) {
    super(scene);

    this._debug = config.debug ?? false;
    this._color = config.color ?? new Color3(0.6, 0.3, 0.8);

    // Create mesh
    this.mesh = this.createPrismMesh();
    this.mesh.position = position;

    // Add components
    this.addComponent(new TeamComponent(config.team ?? TeamTag.Team1));
    this.addComponent(new HealthComponent(config.health ?? 150)); // Higher health than sphere
    this.addComponent(
      new AttackComponent({
        range: config.attackRange ?? 20,
        cooldown: config.attackCooldown ?? 1.5,
        damage: config.attackDamage ?? 25, // Higher damage than sphere
      })
    );
    this.addComponent(new MovementComponent(config.moveSpeed ?? 6)); // Slower than sphere
    this.addComponent(new UnitTypeComponent(UnitType.Prisma));

    // Add DeathComponent for deterministic death timing
    // PrismaUnit has no death animation, so use instant death (0 ticks)
    this.addComponent(new DeathComponent(0));

    if (this._debug) {
      this.createRangeIndicator();
    }
  }

  /**
   * Create a mesh built from triangular prisms
   * Creates a distinctive 2x2 sized unit
   */
  private createPrismMesh(): Mesh {
    // Create parent mesh to hold all prisms
    const parentMesh = new Mesh(`prismaUnit_${this.id}`, this.scene);

    // Create 4 triangular prisms arranged in a 2x2 pattern
    const prismSize = 1.5;
    const spacing = 1.8;
    const positions = [
      new Vector3(-spacing / 2, 0, -spacing / 2),
      new Vector3(spacing / 2, 0, -spacing / 2),
      new Vector3(-spacing / 2, 0, spacing / 2),
      new Vector3(spacing / 2, 0, spacing / 2),
    ];

    positions.forEach((pos, index) => {
      const prism = this.createTriangularPrism(
        `prism_${this.id}_${index}`,
        prismSize
      );
      prism.parent = parentMesh;
      prism.position = pos;
      // Rotate each prism slightly for visual variety
      prism.rotation.y = (index * Math.PI) / 2;
    });

    // Create central crystal with team color
    const crystal = this.createCentralCrystal();
    crystal.parent = parentMesh;

    // Apply material to parent (for prisms - gray/neutral color)
    const material = new StandardMaterial(`prismaMat_${this.id}`, this.scene);
    material.diffuseColor = new Color3(0.4, 0.4, 0.45); // Neutral gray for outer prisms
    parentMesh.material = material;

    return parentMesh;
  }

  /**
   * Create a central crystal with team color
   */
  private createCentralCrystal(): Mesh {
    // Create a double-ended crystal (octahedron-like shape)
    const crystal = MeshBuilder.CreatePolyhedron(
      `crystal_${this.id}`,
      {
        type: 1, // Octahedron
        size: 0.6,
      },
      this.scene
    );

    // Position slightly above center
    crystal.position = new Vector3(0, 1.2, 0);

    // Stretch vertically for crystal look
    crystal.scaling = new Vector3(0.8, 1.4, 0.8);

    // Create glowing material with team color
    const crystalMaterial = new StandardMaterial(
      `crystalMat_${this.id}`,
      this.scene
    );
    crystalMaterial.diffuseColor = this._color;
    crystalMaterial.emissiveColor = this._color.scale(0.5); // Glow effect
    crystalMaterial.specularColor = new Color3(1, 1, 1);
    crystalMaterial.specularPower = 64;
    crystal.material = crystalMaterial;

    return crystal;
  }

  /**
   * Create a single triangular prism
   */
  private createTriangularPrism(name: string, size: number): Mesh {
    const mesh = new Mesh(name, this.scene);

    const height = size * 1.5;
    const radius = size / 2;

    // Vertices for triangular prism
    const positions = [
      // Bottom triangle (y = 0)
      0,
      0,
      radius, // 0 - front
      -radius * 0.866,
      0,
      -radius * 0.5, // 1 - back left
      radius * 0.866,
      0,
      -radius * 0.5, // 2 - back right
      // Top triangle (y = height)
      0,
      height,
      radius, // 3 - front
      -radius * 0.866,
      height,
      -radius * 0.5, // 4 - back left
      radius * 0.866,
      height,
      -radius * 0.5, // 5 - back right
    ];

    // Indices for triangular prism faces
    const indices = [
      // Bottom face
      0,
      2,
      1,
      // Top face
      3,
      4,
      5,
      // Side faces
      0,
      1,
      4,
      0,
      4,
      3, // Left side
      1,
      2,
      5,
      1,
      5,
      4, // Back side
      2,
      0,
      3,
      2,
      3,
      5, // Right side
    ];

    // Calculate normals
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);

    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;

    vertexData.applyToMesh(mesh);

    return mesh;
  }


  private createRangeIndicator(): void {
    const attack = this.getComponent<AttackComponent>(ComponentType.Attack);
    if (!attack) return;

    this.rangeIndicator = MeshBuilder.CreateSphere(
      `prismaRange_${this.id}`,
      { diameter: attack.range * 2, segments: 32 },
      this.scene
    );
    this.rangeIndicator.parent = this.mesh;
    this.rangeIndicator.position.y = 0;
    this.rangeIndicator.isPickable = false;

    const material = new StandardMaterial(
      `prismaRangeMat_${this.id}`,
      this.scene
    );
    material.diffuseColor = new Color3(1, 0.5, 0);
    material.alpha = 0.15;
    material.wireframe = true;
    this.rangeIndicator.material = material;
  }

  public dispose(): void {
    this.rangeIndicator?.dispose();
    this.mesh?.dispose();
  }
}
