import {
  Scene,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Mesh,
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

export interface LanceUnitConfig {
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
 * LanceUnit entity - A 2x1 combat unit with extended range
 * Uses component-based architecture
 *
 * Visual design: Elongated spear/lance shape oriented along X-axis (forward)
 * For Team2, the unit is rotated 180 degrees to face the opposite direction
 */
export class LanceUnit extends Unit {
  private rangeIndicator: Mesh | null = null;
  private _debug: boolean;
  private _color: Color3;

  constructor(
    scene: Scene,
    config: LanceUnitConfig = {},
    position: Vector3 = new Vector3(0, 1, 0)
  ) {
    super(scene);

    this._debug = config.debug ?? false;
    this._color = config.color ?? new Color3(0.3, 0.6, 0.8);
    const team = config.team ?? TeamTag.Team1;

    // Create mesh
    this.mesh = this.createLanceMesh();
    this.mesh.position = position;

    // Rotate 180 degrees for Team2 so lance faces towards enemy
    if (team === TeamTag.Team2) {
      this.mesh.rotation.y = Math.PI;
    }

    // Add components - Lance has medium stats between Sphere and Prisma
    this.addComponent(new TeamComponent(team));
    this.addComponent(new HealthComponent(config.health ?? 100)); // Between sphere (50) and prisma (150)
    this.addComponent(
      new AttackComponent({
        range: config.attackRange ?? 26, // Extended range (spear reach)
        cooldown: config.attackCooldown ?? 1.2,
        damage: config.attackDamage ?? 18, // Between sphere (10) and prisma (25)
      })
    );
    this.addComponent(new MovementComponent(config.moveSpeed ?? 8)); // Between sphere (10) and prisma (6)
    this.addComponent(new UnitTypeComponent(UnitType.Lance));

    // Add DeathComponent for deterministic death timing
    // LanceUnit has no death animation, so use instant death (0 ticks)
    this.addComponent(new DeathComponent(0));

    if (this._debug) {
      this.createRangeIndicator();
    }
  }

  /**
   * Create a lance-shaped mesh (elongated for 2x1 footprint)
   * Consists of a main shaft with a pointed tip and team-colored crystal
   * Lance faces forward (positive X direction)
   */
  private createLanceMesh(): Mesh {
    // Create parent mesh to hold all parts
    const parentMesh = new Mesh(`lanceUnit_${this.id}`, this.scene);

    // Main body - elongated capsule along X-axis (forward direction)
    const bodyLength = 4.0; // Increased from 3.0
    const body = MeshBuilder.CreateCylinder(
      `lanceBody_${this.id}`,
      {
        height: bodyLength,
        diameterTop: 0.9, // Increased from 0.7
        diameterBottom: 1.1, // Increased from 0.8
        tessellation: 12,
      },
      this.scene
    );
    // Rotate to align with X-axis (horizontal, facing forward)
    body.rotation.z = -Math.PI / 2;
    body.position.y = 1.0; // Raised slightly
    body.parent = parentMesh;

    // Apply neutral material to body
    const bodyMaterial = new StandardMaterial(
      `lanceBodyMat_${this.id}`,
      this.scene
    );
    bodyMaterial.diffuseColor = new Color3(0.5, 0.5, 0.55);
    bodyMaterial.specularColor = new Color3(0.3, 0.3, 0.3);
    body.material = bodyMaterial;

    // Spear tip - cone at front (positive X) - larger and more menacing
    const tip = MeshBuilder.CreateCylinder(
      `lanceTip_${this.id}`,
      {
        height: 1.5, // Increased from 1.0
        diameterTop: 0,
        diameterBottom: 0.7, // Increased from 0.5
        tessellation: 8,
      },
      this.scene
    );
    tip.rotation.z = -Math.PI / 2;
    tip.position.y = 1.0;
    tip.position.x = bodyLength / 2 + 0.75; // Adjusted for larger tip
    tip.parent = parentMesh;

    // Tip material - metallic
    const tipMaterial = new StandardMaterial(
      `lanceTipMat_${this.id}`,
      this.scene
    );
    tipMaterial.diffuseColor = new Color3(0.7, 0.7, 0.75);
    tipMaterial.specularColor = new Color3(1, 1, 1);
    tipMaterial.specularPower = 64;
    tip.material = tipMaterial;

    // Rear guard - larger disc at back (negative X)
    const guard = MeshBuilder.CreateCylinder(
      `lanceGuard_${this.id}`,
      {
        height: 0.3, // Increased from 0.2
        diameter: 1.4, // Increased from 1.0
        tessellation: 16,
      },
      this.scene
    );
    guard.rotation.z = -Math.PI / 2;
    guard.position.y = 1.0;
    guard.position.x = -bodyLength / 2 + 0.15;
    guard.parent = parentMesh;
    guard.material = bodyMaterial;

    // Central crystal with team color (positioned at center)
    const crystal = this.createCentralCrystal();
    crystal.parent = parentMesh;

    return parentMesh;
  }

  /**
   * Create a central crystal with team color
   */
  private createCentralCrystal(): Mesh {
    // Create a double-ended crystal (octahedron-like shape)
    const crystal = MeshBuilder.CreatePolyhedron(
      `lanceCrystal_${this.id}`,
      {
        type: 1, // Octahedron
        size: 0.55, // Increased from 0.4
      },
      this.scene
    );

    // Position at center, slightly above body
    crystal.position = new Vector3(0, 1.7, 0); // Raised to match new body height

    // Stretch for crystal look
    crystal.scaling = new Vector3(0.8, 1.2, 0.8); // Increased from (0.7, 1.0, 0.7)

    // Create glowing material with team color
    const crystalMaterial = new StandardMaterial(
      `lanceCrystalMat_${this.id}`,
      this.scene
    );
    crystalMaterial.diffuseColor = this._color;
    crystalMaterial.emissiveColor = this._color.scale(0.5);
    crystalMaterial.specularColor = new Color3(1, 1, 1);
    crystalMaterial.specularPower = 64;
    crystal.material = crystalMaterial;

    return crystal;
  }


  private createRangeIndicator(): void {
    const attack = this.getComponent<AttackComponent>(ComponentType.Attack);
    if (!attack) return;

    this.rangeIndicator = MeshBuilder.CreateSphere(
      `lanceRange_${this.id}`,
      { diameter: attack.range * 2, segments: 32 },
      this.scene
    );
    this.rangeIndicator.parent = this.mesh;
    this.rangeIndicator.position.y = 0;
    this.rangeIndicator.isPickable = false;

    const material = new StandardMaterial(
      `lanceRangeMat_${this.id}`,
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
