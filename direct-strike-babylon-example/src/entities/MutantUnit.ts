import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';
import { Unit } from './Unit';
import {
  AnimationComponent,
  AttackComponent,
  AttackLockComponent,
  ComponentType,
  DeathComponent,
  HealthComponent,
  MovementComponent,
  RotationComponent,
  TeamComponent,
  UnitType,
  UnitTypeComponent,
} from '../components';
import { TeamTag } from '../enums/TeamTag';
import { AssetManager } from '../core/AssetManager';

/**
 * Animation names for the Mutant model
 */
const MutantAnimations = {
  idle: 'Mutant Idle 2_6',
  run: 'Mutant Run_5',
  death: 'Mutant Dying_3',
  attacks: ['Standing Melee Attack Backhand_2', 'Mutant Swiping_4'],
} as const;

export interface MutantUnitConfig {
  color?: Color3;
  team?: TeamTag;
  attackRange?: number;
  detectionRange?: number;
  attackCooldown?: number;
  attackDamage?: number;
  health?: number;
  moveSpeed?: number;
  debug?: boolean;
}

/**
 * MutantUnit entity - A thin ECS entity for a melee combat unit
 *
 * Following ECS architecture:
 * - Entity is a container for components and mesh references
 * - All animation/combat/rotation logic is handled by systems
 * - Components store the data, systems process it
 *
 * Components:
 * - TeamComponent: Team affiliation
 * - HealthComponent: Health points
 * - AttackComponent: Attack stats (range, damage, cooldown)
 * - MovementComponent: Movement speed and target
 * - UnitTypeComponent: Unit type identifier
 * - AnimationComponent: Animation state and model references
 * - RotationComponent: Rotation interpolation state
 * - AttackLockComponent: Deterministic attack lock timing
 */
export class MutantUnit extends Unit {
  private rangeIndicator: Mesh | null = null;
  private _debug: boolean;
  private _color: Color3;
  private _team: TeamTag;

  // Placeholder mesh while model loads
  private placeholderMesh: Mesh;

  // Dispose function for the model instance
  private modelDisposeFunc: (() => void) | null = null;

  constructor(
    scene: Scene,
    config: MutantUnitConfig = {},
    position: Vector3 = new Vector3(0, 0, 0)
  ) {
    super(scene);

    this._debug = config.debug ?? false;
    this._color = config.color ?? new Color3(0.5, 0.3, 0.2);
    this._team = config.team ?? TeamTag.Team1;

    // Create placeholder mesh while model loads
    this.placeholderMesh = this.createPlaceholderMesh();
    this.mesh = this.placeholderMesh;
    this.mesh.position = position.clone();

    // Calculate default rotation based on team
    const defaultRotationY =
      this._team === TeamTag.Team1 ? Math.PI / 2 : -Math.PI / 2;

    // Add components - melee unit with big detection, small attack range
    this.addComponent(new TeamComponent(this._team));
    this.addComponent(new HealthComponent(config.health ?? 50));
    this.addComponent(
      new AttackComponent({
        range: config.attackRange ?? 4, // Small melee attack range
        detectionRange: config.detectionRange ?? 30, // Large detection radius
        cooldown: config.attackCooldown ?? 1.2,
        damage: config.attackDamage ?? 12,
        projectileSpeed: 0, // Melee, no projectile
      })
    );
    this.addComponent(new MovementComponent(config.moveSpeed ?? 8));
    this.addComponent(new UnitTypeComponent(UnitType.Mutant));

    // Add animation-related components
    this.addComponent(new AnimationComponent(MutantAnimations, 0.15));
    this.addComponent(new RotationComponent(defaultRotationY, 8.0));
    this.addComponent(new AttackLockComponent(0.8));

    // Add DeathComponent for deterministic death timing
    // Death duration should be longer than the death animation (~3 seconds = 60 ticks at 20 TPS)
    // This ensures the unit stays visible until the animation completes
    this.addComponent(new DeathComponent(4.0));

    if (this._debug) {
      this.createRangeIndicator();
    }

    // Load the 3D model
    this.loadModel();
  }

  /**
   * Create a placeholder mesh while the model loads
   * Sized for a 2x2 grid unit with wider collision radius to prevent mesh intersection
   */
  private createPlaceholderMesh(): Mesh {
    const mesh = MeshBuilder.CreateCapsule(
      `mutant_placeholder_${this.id}`,
      { height: 4, radius: 8.0 },
      this.scene
    );

    const material = new StandardMaterial(
      `mutantPlaceholderMat_${this.id}`,
      this.scene
    );
    material.diffuseColor = this._color;
    material.alpha = 0.5;
    mesh.material = material;

    return mesh;
  }

  /**
   * Load the GLB model from preloaded assets
   * Since assets are preloaded by AssetManager, this is synchronous
   */
  private loadModel(): void {
    const assetManager = AssetManager.getInstance();
    if (!assetManager) {
      console.error('[MutantUnit] AssetManager not initialized');
      return;
    }

    // Create an instance from the preloaded asset
    const instance = assetManager.createInstance('mutant', `mutant_${this.id}`);
    if (!instance) {
      console.error('[MutantUnit] Failed to create model instance');
      return;
    }

    // Store dispose function
    this.modelDisposeFunc = instance.dispose;

    // Parent the model root directly to the placeholder mesh
    instance.rootNode.parent = this.placeholderMesh;

    // Reset local position (relative to parent)
    instance.rootNode.position = Vector3.Zero();

    // Scale the model appropriately for 2x2 grid size
    instance.rootNode.scaling = new Vector3(0.06, 0.06, 0.06);

    // GLB files use rotationQuaternion which overrides rotation (Euler angles)
    // We need to clear it to use rotation.y
    instance.rootNode.rotationQuaternion = null;

    // Rotate the model root to face the correct direction based on team
    instance.rootNode.rotation.y =
      this._team === TeamTag.Team1 ? Math.PI / 2 : -Math.PI / 2;

    // Hide placeholder visual but keep it for physics/position tracking
    this.placeholderMesh.visibility = 0;

    // Make meshes pickable and store entity reference
    for (const m of instance.meshes) {
      m.isPickable = true;
      // Store reference to parent entity for selection
      (m as unknown as { entityRef: MutantUnit }).entityRef = this;
    }

    // Update components with model data
    const animComponent = this.getComponent<AnimationComponent>(
      ComponentType.Animation
    );
    if (animComponent) {
      animComponent.setModelData(
        instance.rootNode,
        instance.meshes,
        instance.animationGroups
      );
    }

    const rotationComponent = this.getComponent<RotationComponent>(
      ComponentType.Rotation
    );
    if (rotationComponent) {
      rotationComponent.setTransformNode(instance.rootNode);
    }

    // Start idle animation via AnimationSystem (will be picked up on next update)
    // The AnimationSystem will handle this based on component state
  }

  private createRangeIndicator(): void {
    const attack = this.getComponent<AttackComponent>(ComponentType.Attack);
    if (!attack) return;

    this.rangeIndicator = MeshBuilder.CreateSphere(
      `mutantRange_${this.id}`,
      { diameter: attack.range * 2, segments: 32 },
      this.scene
    );
    this.rangeIndicator.parent = this.mesh;
    this.rangeIndicator.position.y = 0;
    this.rangeIndicator.isPickable = false;

    const material = new StandardMaterial(
      `mutantRangeMat_${this.id}`,
      this.scene
    );
    material.diffuseColor = new Color3(1, 0.5, 0);
    material.alpha = 0.15;
    material.wireframe = true;
    this.rangeIndicator.material = material;
  }


  public override dispose(): void {
    if (this.rangeIndicator) {
      this.rangeIndicator.dispose();
    }

    // Clear animation component data
    const animComponent = this.getComponent<AnimationComponent>(
      ComponentType.Animation
    );
    if (animComponent) {
      animComponent.clear();
    }

    // Dispose the model instance (handles animations and meshes)
    if (this.modelDisposeFunc) {
      this.modelDisposeFunc();
      this.modelDisposeFunc = null;
    }

    // Dispose placeholder
    this.placeholderMesh.dispose();

    super.dispose();
  }
}
