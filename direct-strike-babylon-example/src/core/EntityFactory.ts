import { Vector3, Color3 } from '@babylonjs/core';
import type { SceneManager } from './SceneManager';
import type { EntityManager } from '@phalanx-engine/ecs';
import type { PrismaUnit, PrismaUnitConfig } from '../entities/PrismaUnit';
import type { LanceUnit, LanceUnitConfig } from '../entities/LanceUnit';
import type { MutantUnit, MutantUnitConfig } from '../entities/MutantUnit';
import type { Tower, TowerConfig } from '../entities/Tower';
import type { Base, BaseConfig } from '../entities/Base';
import { PhysicsBodyComponent } from '@phalanx-engine/physics';
import { HealthBarComponent, InterpolationComponent, TransformComponent } from '../components';
import { FP, FPVector3 } from '@phalanx-engine/math';
import { TeamTag } from '../enums/TeamTag';
import { arenaParams, unitConfig } from '../config/constants';

/**
 * EntityFactory - Creates and registers game entities
 *
 * Responsible for:
 * - Creating units, towers, and bases
 * - Registering entities with all necessary systems
 * - Tracking entity ownership
 */
export class EntityFactory {
  private sceneManager: SceneManager;
  private entityManager: EntityManager;

  // Map entity IDs to player info
  private entityOwnership: Map<number, string> = new Map();

  constructor(
    sceneManager: SceneManager,
    entityManager: EntityManager,
  ) {
    this.sceneManager = sceneManager;
    this.entityManager = entityManager;
  }


  /**
   * Create a PrismaUnit and register it with all necessary systems
   */
  public createPrismaUnit(
    config: PrismaUnitConfig,
    position: Vector3
  ): PrismaUnit {
    const unit = this.sceneManager.createPrismaUnit(config, position);

    // Add PhysicsBodyComponent - prisma units are larger dynamic bodies
    unit.addComponent(new PhysicsBodyComponent(unit.id, {
      radius: FP.FromFloat(1.8), // Larger radius for 2x2 unit
      mass: FP.FromFloat(2.0), // Heavier unit
      isStatic: false,
    }));

    // Add HealthBarComponent for health visualization
    unit.addComponent(new HealthBarComponent(3.5));

    // Add TransformComponent for position storage
    const initialPos = FPVector3.FromFloat(position.x, position.y, position.z);
    const transform = new TransformComponent(unit.id, initialPos);
    unit.addComponent(transform);

    // Add InterpolationComponent for smooth visual movement
    unit.addComponent(new InterpolationComponent(transform.fpPosition, false));

    // Register with EntityManager
    this.entityManager.addEntity(unit);

    return unit;
  }

  /**
   * Create a LanceUnit and register it with all necessary systems
   */
  public createLanceUnit(
    config: LanceUnitConfig,
    position: Vector3
  ): LanceUnit {
    const unit = this.sceneManager.createLanceUnit(config, position);

    // Add PhysicsBodyComponent - lance units are elongated 1x2 bodies
    unit.addComponent(new PhysicsBodyComponent(unit.id, {
      radius: FP.FromFloat(1.4), // Medium radius for 1x2 unit
      mass: FP.FromFloat(1.5), // Between sphere and prisma
      isStatic: false,
    }));

    // Add HealthBarComponent for health visualization
    unit.addComponent(new HealthBarComponent(3.0));

    // Add TransformComponent for position storage
    const initialPos = FPVector3.FromFloat(position.x, position.y, position.z);
    const transform = new TransformComponent(unit.id, initialPos);
    unit.addComponent(transform);

    // Add InterpolationComponent for smooth visual movement
    unit.addComponent(new InterpolationComponent(transform.fpPosition, false));

    // Register with EntityManager
    this.entityManager.addEntity(unit);

    return unit;
  }

  /**
   * Create a MutantUnit and register it with all necessary systems
   */
  public createMutantUnit(
    config: MutantUnitConfig,
    position: Vector3
  ): MutantUnit {
    const unit = this.sceneManager.createMutantUnit(config, position);

    // Add PhysicsBodyComponent - mutant units are 2x2 bodies
    unit.addComponent(new PhysicsBodyComponent(unit.id, {
      radius: FP.FromFloat(2.0),
      mass: FP.FromFloat(2.0),
      isStatic: false,
    }));

    // Add HealthBarComponent for health visualization
    unit.addComponent(new HealthBarComponent(4.5));

    // Add TransformComponent for position storage
    const initialPos = FPVector3.FromFloat(position.x, position.y, position.z);
    const transform = new TransformComponent(unit.id, initialPos);
    unit.addComponent(transform);

    // Add InterpolationComponent for smooth visual movement
    unit.addComponent(new InterpolationComponent(transform.fpPosition, false));

    // Register with EntityManager
    this.entityManager.addEntity(unit);

    return unit;
  }

  /**
   * Create a tower and register it with all necessary systems
   */
  public createTower(config: TowerConfig, position: Vector3): Tower {
    const tower = this.sceneManager.createTower(config, position);

    // Add PhysicsBodyComponent - towers are static bodies (can push but don't move)
    tower.addComponent(new PhysicsBodyComponent(tower.id, {
      radius: FP.FromFloat(1.5),
      mass: FP.FromFloat(10.0),
      isStatic: true,
    }));

    // Add HealthBarComponent for health visualization
    tower.addComponent(new HealthBarComponent(5.0));

    // Add TransformComponent for position storage
    const initialPos = FPVector3.FromFloat(position.x, position.y, position.z);
    const transform = new TransformComponent(tower.id, initialPos);
    tower.addComponent(transform);

    // Add InterpolationComponent - towers are static, don't need smooth movement
    tower.addComponent(new InterpolationComponent(transform.fpPosition, true));

    // Register with EntityManager
    this.entityManager.addEntity(tower);

    return tower;
  }

  /**
   * Create a base and register it with all necessary systems
   */
  public createBase(config: BaseConfig, position: Vector3): Base {
    const base = this.sceneManager.createBase(config, position);

    // Add PhysicsBodyComponent - bases are static bodies (can push but don't move)
    base.addComponent(new PhysicsBodyComponent(base.id, {
      radius: FP.FromFloat(3.0),
      mass: FP.FromFloat(100.0),
      isStatic: true,
    }));

    // Add HealthBarComponent for health visualization
    base.addComponent(new HealthBarComponent(5.5));

    // Add TransformComponent for position storage
    const initialPos = FPVector3.FromFloat(position.x, position.y, position.z);
    const transform = new TransformComponent(base.id, initialPos);
    base.addComponent(transform);

    // Add InterpolationComponent - bases are static, don't need smooth movement
    base.addComponent(new InterpolationComponent(transform.fpPosition, true));

    // Register with EntityManager
    this.entityManager.addEntity(base);

    return base;
  }

  /**
   * Create a unit for the formation system
   * Returns the unit info needed for move commands
   */
  public createUnitForFormation(
    unitType: 'sphere' | 'mutant' | 'prisma' | 'lance',
    team: TeamTag,
    position: Vector3,
    localPlayerId: string,
    localTeam: TeamTag,
    getOpponentId: () => string
  ): { id: number; position: Vector3 } {
    const color =
      team === TeamTag.Team1
        ? new Color3(
            arenaParams.colors.teamA.r,
            arenaParams.colors.teamA.g,
            arenaParams.colors.teamA.b
          )
        : new Color3(
            arenaParams.colors.teamB.r,
            arenaParams.colors.teamB.g,
            arenaParams.colors.teamB.b
          );

    let unit: PrismaUnit | LanceUnit | MutantUnit;

    if (unitType === 'sphere') {
      // Sphere is deprecated, create mutant instead
      unit = this.createMutantUnit(
        {
          color,
          team,
          health: unitConfig.mutant.health,
          attackDamage: unitConfig.mutant.attackDamage,
          attackRange: unitConfig.mutant.attackRange,
          detectionRange: unitConfig.mutant.detectionRange,
          attackCooldown: unitConfig.mutant.attackCooldown,
          moveSpeed: unitConfig.mutant.moveSpeed,
        },
        position
      );
    } else if (unitType === 'mutant') {
      unit = this.createMutantUnit(
        {
          color,
          team,
          health: unitConfig.mutant.health,
          attackDamage: unitConfig.mutant.attackDamage,
          attackRange: unitConfig.mutant.attackRange,
          detectionRange: unitConfig.mutant.detectionRange,
          attackCooldown: unitConfig.mutant.attackCooldown,
          moveSpeed: unitConfig.mutant.moveSpeed,
        },
        position
      );
    } else if (unitType === 'prisma') {
      unit = this.createPrismaUnit(
        {
          color,
          team,
          health: unitConfig.prisma.health,
          attackDamage: unitConfig.prisma.attackDamage,
          attackRange: unitConfig.prisma.attackRange,
          attackCooldown: unitConfig.prisma.attackCooldown,
          moveSpeed: unitConfig.prisma.moveSpeed,
        },
        position
      );
    } else {
      unit = this.createLanceUnit(
        {
          color,
          team,
          health: unitConfig.lance.health,
          attackDamage: unitConfig.lance.attackDamage,
          attackRange: unitConfig.lance.attackRange,
          attackCooldown: unitConfig.lance.attackCooldown,
          moveSpeed: unitConfig.lance.moveSpeed,
        },
        position
      );
    }

    // Track ownership
    const playerId = team === localTeam ? localPlayerId : getOpponentId();
    this.entityOwnership.set(unit.id, playerId);

    // Return the initial position passed to factory (TransformComponent stores it)
    return { id: unit.id, position: position.clone() };
  }

  /**
   * Set entity ownership
   */
  public setOwnership(entityId: number, playerId: string): void {
    this.entityOwnership.set(entityId, playerId);
  }

  /**
   * Get entity owner
   */
  public getOwner(entityId: number): string | undefined {
    return this.entityOwnership.get(entityId);
  }

  /**
   * Remove entity ownership
   */
  public removeOwnership(entityId: number): void {
    this.entityOwnership.delete(entityId);
  }

  /**
   * Check if entity is owned by player
   */
  public isOwnedBy(entityId: number, playerId: string): boolean {
    return this.entityOwnership.get(entityId) === playerId;
  }

  /**
   * Get all entity ownership entries
   */
  public getOwnershipMap(): Map<number, string> {
    return this.entityOwnership;
  }

  /**
   * Clear all ownership data
   */
  public clear(): void {
    this.entityOwnership.clear();
  }
}
