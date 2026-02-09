import { Vector3 } from '@babylonjs/core';
import { Projectile } from '../entities/Projectile';
import { ExplosionEffect } from '../effects/ExplosionEffect';
import type { SystemContext } from '../core/SystemContext';
import { GameSystem } from './GameSystem';
import { Entity } from '../entities/Entity';
import { ComponentType, TeamComponent } from '../components';
import { GameEvents, createEvent } from '../events';
import type {
  ProjectileSpawnedEvent,
  DamageRequestedEvent,
  ProjectileHitEvent,
} from '../events';
import type { TeamTag } from '../enums/TeamTag';
import { networkConfig } from '../config/constants';
import { FP, FPVector3 } from 'phalanx-math';

// Pre-computed fixed-point constants for projectile collision
const FP_HIT_RADIUS_SQ = FP.FromFloat(1.5 * 1.5); // hitRadius^2 = 2.25
const FP_GROUND_LEVEL = FP._0;

export interface ProjectileSpawnConfig {
  damage: number;
  speed?: number;
  lifetime?: number;
  team: TeamTag;
  sourceId: number; // ID of the entity that fired the projectile
}

/**
 * Projectile system configuration for deterministic simulation
 */
export interface ProjectileConfig {
  fixedTimestep: number; // Fixed delta time for deterministic updates (e.g., 1/60)
}

const DEFAULT_PROJECTILE_CONFIG: ProjectileConfig = {
  // Projectiles update once per network tick for deterministic lockstep
  fixedTimestep: networkConfig.tickTimestep,
};

/**
 * ProjectileSystem - Manages all projectiles in the game
 * Uses EntityManager for target queries
 * Uses EventBus for decoupled damage dealing
 * Extends GameSystem for consistent lifecycle management
 *
 * IMPORTANT: Uses fixed timestep for deterministic projectile movement.
 * This ensures projectile hit detection is identical across all clients.
 */
export class ProjectileSystem extends GameSystem {
  private config: ProjectileConfig;
  private projectiles: Projectile[] = [];

  constructor(config?: Partial<ProjectileConfig>) {
    super();
    this.config = { ...DEFAULT_PROJECTILE_CONFIG, ...config };
  }

  /**
   * Initialize the system with context
   */
  public override init(context: SystemContext): void {
    super.init(context);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Listen for projectile spawn requests from combat system
    this.subscribe<ProjectileSpawnedEvent>(
      GameEvents.PROJECTILE_SPAWNED,
      (event) => {
        this.spawnProjectile(event.origin, event.direction, {
          damage: event.damage,
          speed: event.speed,
          team: event.team,
          sourceId: event.sourceId,
        });
      }
    );
  }

  /**
   * Spawn a new projectile
   */
  public spawnProjectile(
    origin: Vector3,
    direction: Vector3,
    config: ProjectileSpawnConfig
  ): Projectile {
    const projectile = new Projectile(this.context.scene, origin, direction, {
      damage: config.damage,
      speed: config.speed,
      lifetime: config.lifetime,
      team: config.team,
      sourceId: config.sourceId,
    });
    this.projectiles.push(projectile);
    return projectile;
  }

  /**
   * Process one network tick worth of projectile updates
   * Called exactly once per network tick for deterministic lockstep simulation
   */
  public override processTick(_tick: number): void {
    this.fixedUpdate(this.config.fixedTimestep);
  }

  /**
   * Fixed timestep projectile update - deterministic
   */
  private fixedUpdate(deltaTime: number): void {
    const projectilesToRemove: Projectile[] = [];

    // Get all potential targets (entities with Health and Team components)
    // queryEntities already returns entities sorted by ID for determinism
    const potentialTargets = this.entityManager.queryEntities(
      ComponentType.Health,
      ComponentType.Team
    );

    for (const projectile of this.projectiles) {
      // Build target list for this projectile (only hostile entities)
      const targets = potentialTargets.filter((entity) => {
        if (entity.isDestroyed) return false;
        const team = entity.getComponent<TeamComponent>(ComponentType.Team);
        if (!team) return false;

        // Only hit entities from different teams
        return team.team !== projectile.team;
      });

      // Update projectile and check collisions with fixed timestep
      const shouldDestroy = this.updateProjectile(
        projectile,
        deltaTime,
        targets
      );

      if (shouldDestroy) {
        projectilesToRemove.push(projectile);
      }
    }

    // Remove and dispose destroyed projectiles
    for (const projectile of projectilesToRemove) {
      this.removeProjectile(projectile);
    }
  }

  private updateProjectile(
    projectile: Projectile,
    deltaTime: number,
    targets: Entity[]
  ): boolean {
    if (projectile.isDestroyed) return true;

    // Update lifetime and movement (using fixed-point internally)
    const wasDestroyed = projectile.update(deltaTime, []);
    if (wasDestroyed && projectile.isDestroyed) return true;

    // Check if projectile hit the ground using fixed-point
    if (FP.Lte(projectile.fpPosition.y, FP_GROUND_LEVEL)) {
      projectile.destroy();
      return true;
    }

    // Check collisions with targets using fixed-point squared distance
    for (const target of targets) {
      const distanceSq = FPVector3.SqrDistance(
        projectile.fpPosition,
        target.fpPosition
      );

      if (FP.Lt(distanceSq, FP_HIT_RADIUS_SQ)) {
        // Emit damage request event instead of directly calling HealthSystem
        this.eventBus.emit<DamageRequestedEvent>(GameEvents.DAMAGE_REQUESTED, {
          ...createEvent(),
          entityId: target.id,
          amount: projectile.damage,
          sourceId: projectile.sourceId,
        });

        // Emit projectile hit event for effects/sounds
        this.eventBus.emit<ProjectileHitEvent>(GameEvents.PROJECTILE_HIT, {
          ...createEvent(),
          targetId: target.id,
          damage: projectile.damage,
          position: projectile.position.clone(),
          team: projectile.team,
          sourceId: projectile.sourceId,
        });

        projectile.destroy();
        return true;
      }
    }

    return false;
  }

  /**
   * Remove a projectile from the system
   */
  private removeProjectile(projectile: Projectile): void {
    const index = this.projectiles.indexOf(projectile);
    if (index > -1) {
      this.projectiles.splice(index, 1);
    }

    // Create explosion effect if projectile hit something
    if (projectile.isDestroyed) {
      new ExplosionEffect(this.context.scene, projectile.position);
    }

    projectile.dispose();
  }

  /**
   * Clear all projectiles
   */
  public clear(): void {
    for (const projectile of this.projectiles) {
      projectile.dispose();
    }
    this.projectiles = [];
  }

  public override dispose(): void {
    super.dispose(); // Clean up subscriptions from base class
    this.clear();
  }
}
