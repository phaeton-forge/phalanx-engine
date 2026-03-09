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
  DeathComponent,
} from '../components';
import { TeamTag } from '../enums/TeamTag';

export interface BaseConfig {
  color: Color3;
  team: TeamTag;
  attackRange?: number;
  attackCooldown?: number;
  attackDamage?: number;
  health?: number;
  debug?: boolean;
}

/**
 * Base entity - A stationary defensive structure (diamond shape)
 * Main objective for each team - destroy enemy base to win
 * Uses component-based architecture
 */
export class Base extends Unit {
  private rangeIndicator: Mesh | null = null;
  private _debug: boolean;
  private _color: Color3;

  constructor(
    scene: Scene,
    config: BaseConfig,
    position: Vector3 = new Vector3(0, 0, 0)
  ) {
    super(scene);

    this._debug = config.debug ?? false;
    this._color = config.color;

    // Create mesh
    this.mesh = this.createMesh();
    this.mesh.position = position.clone();
    this.mesh.position.y = 2; // Half height of base

    // Add components
    this.addComponent(new TeamComponent(config.team));
    this.addComponent(new HealthComponent(config.health ?? 600));

    const attackComponent = new AttackComponent({
      range: config.attackRange ?? 36,
      cooldown: config.attackCooldown ?? 0.2,
      damage: config.attackDamage ?? 30,
    });
    // Set attack origin offset to top of base
    attackComponent.setAttackOriginOffset(new Vector3(0, 2, 0));
    this.addComponent(attackComponent);

    // Add DeathComponent for deterministic death timing (instant death)
    this.addComponent(new DeathComponent(0));

    if (this._debug) {
      this.createRangeIndicator();
    }
  }

  private createMesh(): Mesh {
    // Create a diamond shape (rotated box)
    const mesh = MeshBuilder.CreateBox(
      `base_${this.id}`,
      {
        width: 4,
        height: 4,
        depth: 4,
      },
      this.scene
    );

    // Rotate 45 degrees to make diamond shape
    mesh.rotation.y = Math.PI / 4;

    const material = new StandardMaterial(`baseMat_${this.id}`, this.scene);
    material.diffuseColor = this._color;
    material.emissiveColor = this._color.scale(0.2);
    mesh.material = material;

    return mesh;
  }

  private createRangeIndicator(): void {
    const attack = this.getComponent<AttackComponent>(ComponentType.Attack);
    if (!attack) return;

    this.rangeIndicator = MeshBuilder.CreateSphere(
      `baseRange_${this.id}`,
      { diameter: attack.range * 2, segments: 32 },
      this.scene
    );
    this.rangeIndicator.parent = this.mesh;
    this.rangeIndicator.position.y = 0;
    this.rangeIndicator.isPickable = false;

    const material = new StandardMaterial(
      `baseRangeMat_${this.id}`,
      this.scene
    );
    material.diffuseColor = new Color3(1, 0.5, 0);
    material.alpha = 0.15;
    material.wireframe = true;
    this.rangeIndicator.material = material;
  }


  // Debug methods
  public get debug(): boolean {
    return this._debug;
  }

  public setDebug(value: boolean): void {
    this._debug = value;
    if (value && !this.rangeIndicator) {
      this.createRangeIndicator();
    } else if (!value && this.rangeIndicator) {
      this.rangeIndicator.dispose();
      this.rangeIndicator = null;
    }
  }

  public override dispose(): void {
    if (this.rangeIndicator) {
      this.rangeIndicator.dispose();
    }
    super.dispose();
  }
}
