import {
  Scene,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Mesh,
  TransformNode,
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

export interface TowerConfig {
  color?: Color3; // Optional - tower now has fixed colors for its parts
  team: TeamTag;
  attackRange?: number;
  attackCooldown?: number;
  attackDamage?: number;
  health?: number;
  debug?: boolean;
}

/**
 * Tower entity - A stationary defensive structure with rotating turret
 * Uses component-based architecture
 *
 * Visual structure:
 * - Base: Dark smooth platform
 * - Turret: Dark green rotating head
 * - Barrel: Grey metallic cannon extending from turret
 * - Crystal: Glowing team-colored crystal on top of turret
 */
export class Tower extends Unit {
  private rangeIndicator: Mesh | null = null;
  private _debug: boolean;
  private _teamColor: Color3;

  // Tower parts for rotation
  private baseMesh: Mesh;
  private turretPivot: TransformNode;
  private turretMesh: Mesh;
  private barrelMesh: Mesh;
  private crystalMesh: Mesh;

  // Turret rotation tracking (VISUAL - frame-rate dependent)
  private _currentTargetPosition: Vector3 | null = null;
  private _turretRotationSpeed: number = 4.0; // Radians per second
  // @ts-ignore
  private _isAimedAtTarget: boolean = false;
  private _aimThreshold: number = 0.1; // Radians - how close to target angle to start firing

  // DETERMINISTIC simulation aiming state (tick-based, NOT frame-based)
  // This is what CombatSystem checks to determine if tower can fire
  private _simCurrentAngle: number = 0; // Current turret angle in simulation
  private _simTargetAngle: number = 0; // Target angle in simulation
  private _simIsAimed: boolean = false; // Whether turret is aimed in simulation

  // Tower dimensions for attack origin calculation
  private static readonly BASE_HEIGHT = 3;
  private static readonly TURRET_HEIGHT = 2;
  private static readonly BARREL_LENGTH = 3;
  private static readonly BARREL_FORWARD_OFFSET = 1.5; // How far barrel extends from turret center

  constructor(
    scene: Scene,
    config: TowerConfig,
    position: Vector3 = new Vector3(0, 0, 0)
  ) {
    super(scene);

    this._debug = config.debug ?? false;
    // Store team color for crystal (default to cyan for Team1, red for Team2)
    this._teamColor =
      config.color ??
      (config.team === TeamTag.Team1
        ? new Color3(0, 0.8, 1) // Cyan
        : new Color3(1, 0.3, 0.1)); // Orange-red

    // Create the tower structure
    this.baseMesh = this.createBase();
    this.turretPivot = this.createTurretPivot();
    this.turretMesh = this.createTurret();
    this.barrelMesh = this.createBarrel();
    this.crystalMesh = this.createCrystal();

    // Main mesh is the base for positioning
    this.mesh = this.baseMesh;
    this.mesh.position = position.clone();
    this.mesh.position.y = Tower.BASE_HEIGHT / 2;

    // Add components
    this.addComponent(new TeamComponent(config.team));
    this.addComponent(new HealthComponent(config.health ?? 300));

    const attackComponent = new AttackComponent({
      range: config.attackRange ?? 32,
      cooldown: config.attackCooldown ?? 0.2,
      damage: config.attackDamage ?? 15,
    });
    // Attack origin will be calculated dynamically based on barrel direction
    attackComponent.setAttackOriginOffset(
      new Vector3(0, Tower.BASE_HEIGHT / 2 + Tower.TURRET_HEIGHT / 2, 0)
    );
    this.addComponent(attackComponent);

    // Add DeathComponent for deterministic death timing (instant death)
    this.addComponent(new DeathComponent(0));

    if (this._debug) {
      this.createRangeIndicator();
    }
  }

  /**
   * Create the tower base - dark smooth platform
   */
  private createBase(): Mesh {
    const mesh = MeshBuilder.CreateCylinder(
      `tower_base_${this.id}`,
      {
        height: Tower.BASE_HEIGHT,
        diameterTop: 3.5,
        diameterBottom: 5,
        tessellation: 24, // Smooth circular shape
      },
      this.scene
    );

    const material = new StandardMaterial(
      `towerBaseMat_${this.id}`,
      this.scene
    );
    material.diffuseColor = new Color3(0.15, 0.15, 0.18); // Dark grey/charcoal
    material.specularColor = new Color3(0.1, 0.1, 0.1);
    mesh.material = material;

    return mesh;
  }

  /**
   * Create the turret pivot point - this is what rotates
   */
  private createTurretPivot(): TransformNode {
    const pivot = new TransformNode(
      `tower_turret_pivot_${this.id}`,
      this.scene
    );
    pivot.parent = this.baseMesh;
    pivot.position.y = Tower.BASE_HEIGHT / 2; // Position at top of base
    return pivot;
  }

  /**
   * Create the turret head - dark green rotating dome
   */
  private createTurret(): Mesh {
    const mesh = MeshBuilder.CreateCylinder(
      `tower_turret_${this.id}`,
      {
        height: Tower.TURRET_HEIGHT,
        diameterTop: 2,
        diameterBottom: 3,
        tessellation: 24, // Smooth circular shape
      },
      this.scene
    );

    mesh.parent = this.turretPivot;
    mesh.position.y = Tower.TURRET_HEIGHT / 2;

    const material = new StandardMaterial(
      `towerTurretMat_${this.id}`,
      this.scene
    );
    material.diffuseColor = new Color3(0.12, 0.25, 0.15); // Dark green
    material.specularColor = new Color3(0.2, 0.3, 0.2);
    mesh.material = material;

    return mesh;
  }

  /**
   * Create the barrel - grey metallic cannon
   */
  private createBarrel(): Mesh {
    const mesh = MeshBuilder.CreateCylinder(
      `tower_barrel_${this.id}`,
      {
        height: Tower.BARREL_LENGTH,
        diameterTop: 0.4,
        diameterBottom: 0.6,
        tessellation: 16, // Smooth circular shape
      },
      this.scene
    );

    mesh.parent = this.turretPivot;
    // Position barrel to extend forward from turret
    mesh.position.y = Tower.TURRET_HEIGHT / 2;
    mesh.position.z = Tower.BARREL_FORWARD_OFFSET + Tower.BARREL_LENGTH / 2;
    // Rotate barrel to point forward (horizontal)
    mesh.rotation.x = Math.PI / 2;

    const material = new StandardMaterial(
      `towerBarrelMat_${this.id}`,
      this.scene
    );
    material.diffuseColor = new Color3(0.4, 0.42, 0.45); // Grey metallic
    material.specularColor = new Color3(0.6, 0.6, 0.6);
    material.specularPower = 32;
    mesh.material = material;

    return mesh;
  }

  /**
   * Create the crystal - glowing team-colored gem on top of turret
   */
  private createCrystal(): Mesh {
    // Create a diamond/crystal shape using two cones
    const topCone = MeshBuilder.CreateCylinder(
      `tower_crystal_top_${this.id}`,
      {
        height: 0.8,
        diameterTop: 0,
        diameterBottom: 0.6,
        tessellation: 6, // Hexagonal for crystal look
      },
      this.scene
    );

    const bottomCone = MeshBuilder.CreateCylinder(
      `tower_crystal_bottom_${this.id}`,
      {
        height: 0.4,
        diameterTop: 0.6,
        diameterBottom: 0,
        tessellation: 6,
      },
      this.scene
    );

    // Position bottom cone below top cone
    bottomCone.position.y = -0.6;
    bottomCone.parent = topCone;

    // Merge into single mesh for easier handling
    const crystal = Mesh.MergeMeshes(
      [topCone, bottomCone],
      true,
      true,
      undefined,
      false,
      true
    );
    if (!crystal) {
      // Fallback if merge fails
      return topCone;
    }
    crystal.name = `tower_crystal_${this.id}`;

    // Parent to turret pivot so it rotates with the turret
    crystal.parent = this.turretPivot;
    // Position on top of turret
    crystal.position.y = Tower.TURRET_HEIGHT + 0.4;

    // Create glowing material with team color
    const material = new StandardMaterial(
      `towerCrystalMat_${this.id}`,
      this.scene
    );
    material.diffuseColor = this._teamColor;
    material.emissiveColor = this._teamColor.scale(0.6); // Glow effect
    material.specularColor = new Color3(1, 1, 1);
    material.specularPower = 64;
    crystal.material = material;
    crystal.isPickable = false;

    return crystal;
  }

  private createRangeIndicator(): void {
    const attack = this.getComponent<AttackComponent>(ComponentType.Attack);
    if (!attack) return;

    this.rangeIndicator = MeshBuilder.CreateSphere(
      `towerRange_${this.id}`,
      { diameter: attack.range * 2, segments: 32 },
      this.scene
    );
    this.rangeIndicator.parent = this.mesh;
    this.rangeIndicator.position.y = 0;
    this.rangeIndicator.isPickable = false;

    const material = new StandardMaterial(
      `towerRangeMat_${this.id}`,
      this.scene
    );
    material.diffuseColor = new Color3(1, 0, 0);
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

  // =====================
  // Turret Rotation System
  // =====================

  /**
   * Set the target position for the turret to aim at
   * Called by CombatSystem when a target is acquired
   */
  public setTargetPosition(position: Vector3 | null): void {
    this._currentTargetPosition = position ? position.clone() : null;
    if (!position) {
      this._isAimedAtTarget = false;
      this._simIsAimed = false;
    } else {
      // Calculate the simulation target angle immediately
      const towerWorldPos = this.mesh!.position;
      const targetDir = position.subtract(towerWorldPos);
      targetDir.y = 0;
      if (targetDir.length() > 0.01) {
        this._simTargetAngle = Math.atan2(targetDir.x, targetDir.z);
      }
    }
  }

  /**
   * Update turret aiming state for DETERMINISTIC simulation
   * Called once per simulation tick by CombatSystem
   *
   * IMPORTANT: This uses fixed timestep for deterministic behavior.
   * All clients will have the same aiming state at the same tick.
   *
   * @param deltaTime Fixed timestep (e.g., 1/20 for 20 TPS)
   */
  public simulateTurretAiming(deltaTime: number): void {
    if (!this._currentTargetPosition) {
      this._simIsAimed = false;
      return;
    }

    // Recalculate target angle (target may have moved)
    const towerWorldPos = this.mesh!.position;
    const targetDir = this._currentTargetPosition.subtract(towerWorldPos);
    targetDir.y = 0;

    if (targetDir.length() < 0.01) {
      this._simIsAimed = true;
      return;
    }

    this._simTargetAngle = Math.atan2(targetDir.x, targetDir.z);

    // Normalize current angle to -PI to PI
    while (this._simCurrentAngle > Math.PI) this._simCurrentAngle -= Math.PI * 2;
    while (this._simCurrentAngle < -Math.PI) this._simCurrentAngle += Math.PI * 2;

    // Calculate angle difference
    let angleDiff = this._simTargetAngle - this._simCurrentAngle;

    // Normalize to shortest rotation path
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    // Check if we're close enough to the target angle
    if (Math.abs(angleDiff) <= this._aimThreshold) {
      this._simIsAimed = true;
      this._simCurrentAngle = this._simTargetAngle;
      return;
    }

    this._simIsAimed = false;

    // Rotate towards target using fixed timestep
    const rotationStep = this._turretRotationSpeed * deltaTime;

    if (Math.abs(angleDiff) <= rotationStep) {
      this._simCurrentAngle = this._simTargetAngle;
      this._simIsAimed = true;
    } else {
      const rotationDir = angleDiff > 0 ? 1 : -1;
      this._simCurrentAngle += rotationDir * rotationStep;
    }
  }

  /**
   * Check if the turret is aimed at its current target
   * Used by CombatSystem to determine if the tower can fire
   *
   * IMPORTANT: Returns the DETERMINISTIC simulation aiming state,
   * NOT the visual rotation state. This ensures all clients agree
   * on when a tower can fire, regardless of frame rate.
   */
  public get isAimedAtTarget(): boolean {
    return this._simIsAimed;
  }

  /**
   * Get the current target position
   */
  public get targetPosition(): Vector3 | null {
    return this._currentTargetPosition;
  }

  /**
   * Update turret rotation towards target
   * Should be called every frame for smooth rotation
   */
  public updateTurretRotation(deltaTime: number): void {
    if (!this._currentTargetPosition) {
      this._isAimedAtTarget = false;
      return;
    }

    // Calculate direction to target in local XZ plane
    const towerWorldPos = this.mesh!.position;
    const targetDir = this._currentTargetPosition.subtract(towerWorldPos);
    targetDir.y = 0; // Only rotate on Y axis (horizontal plane)

    if (targetDir.length() < 0.01) {
      this._isAimedAtTarget = true;
      return;
    }

    // Calculate target angle (in world space, turret faces +Z by default)
    const targetAngle = Math.atan2(targetDir.x, targetDir.z);

    // Get current turret rotation
    let currentAngle = this.turretPivot.rotation.y;

    // Normalize angles to -PI to PI
    while (currentAngle > Math.PI) currentAngle -= Math.PI * 2;
    while (currentAngle < -Math.PI) currentAngle += Math.PI * 2;

    // Calculate angle difference
    let angleDiff = targetAngle - currentAngle;

    // Normalize to shortest rotation path
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    // Check if we're close enough to the target angle
    if (Math.abs(angleDiff) <= this._aimThreshold) {
      this._isAimedAtTarget = true;
      this.turretPivot.rotation.y = targetAngle;
      return;
    }

    this._isAimedAtTarget = false;

    // Rotate towards target
    const rotationStep = this._turretRotationSpeed * deltaTime;

    if (Math.abs(angleDiff) <= rotationStep) {
      // Snap to target angle if we're close enough
      this.turretPivot.rotation.y = targetAngle;
      this._isAimedAtTarget = true;
    } else {
      // Rotate in the direction of the target
      const rotationDir = angleDiff > 0 ? 1 : -1;
      this.turretPivot.rotation.y += rotationDir * rotationStep;
    }
  }

  /**
   * Get the attack origin position (end of the barrel)
   * This overrides the simple offset calculation in AttackComponent
   */
  public getBarrelTipPosition(): Vector3 {
    if (!this.mesh) return Vector3.Zero();

    // Calculate barrel tip in world space
    const basePos = this.mesh.position;
    const turretY = this.turretPivot.rotation.y;

    // Barrel tip offset in turret local space (extending along Z)
    const barrelTipLocal = new Vector3(
      0,
      Tower.BASE_HEIGHT / 2 + Tower.TURRET_HEIGHT / 2,
      Tower.BARREL_FORWARD_OFFSET + Tower.BARREL_LENGTH
    );

    // Rotate the offset by turret rotation
    const cosY = Math.cos(turretY);
    const sinY = Math.sin(turretY);
    const rotatedX = barrelTipLocal.z * sinY;
    const rotatedZ = barrelTipLocal.z * cosY;

    return new Vector3(
      basePos.x + rotatedX,
      basePos.y + barrelTipLocal.y,
      basePos.z + rotatedZ
    );
  }

  /**
   * Get the direction the barrel is pointing
   */
  public getBarrelDirection(): Vector3 {
    const turretY = this.turretPivot.rotation.y;
    return new Vector3(Math.sin(turretY), 0, Math.cos(turretY));
  }

  public override dispose(): void {
    if (this.rangeIndicator) {
      this.rangeIndicator.dispose();
    }
    this.crystalMesh.dispose();
    this.barrelMesh.dispose();
    this.turretMesh.dispose();
    this.turretPivot.dispose();
    // baseMesh is the main mesh, disposed by super.dispose()
    super.dispose();
  }
}
