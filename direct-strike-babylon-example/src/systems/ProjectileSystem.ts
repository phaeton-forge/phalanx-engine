import { Vector3 } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import { ProjectileEntity } from '../entities/ProjectileEntity';
import { ExplosionEffect } from '../effects/ExplosionEffect';
import type { SystemContext, Entity, PoolManager } from 'phalanx-ecs';
import { GameSystem } from 'phalanx-ecs';
import {
  ComponentType,
  TeamComponent,
  TransformComponent,
  InterpolationComponent,
  ProjectileComponent,
} from '../components';
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
const FP_TIMESTEP = FP.FromFloat(networkConfig.tickTimestep);

// Default projectile config
const DEFAULT_PROJECTILE_SPEED = 55;
const DEFAULT_PROJECTILE_LIFETIME_SECS = 3;

export interface ProjectileSpawnConfig {
  damage: number;
  speed?: number;
  lifetime?: number;
  team: TeamTag;
  sourceId: number; // ID of the entity that fired the projectile
}

/**
 * ProjectileSystem - Manages all projectiles as ECS entities
 *
 * Supports object pooling: when world.pools has a 'projectile' pool registered,
 * entities are acquired from the pool and template components are reinitialized
 * instead of creating new instances.
 */
export class ProjectileSystem extends GameSystem {
  private scene: Scene;
  private pools: PoolManager | null = null;

  constructor(scene: Scene) {
    super();
    this.scene = scene;
  }

  public override init(context: SystemContext): void {
    super.init(context);
    this.setupEventListeners();
  }

  /** Set the pool manager reference (called by Game after world creation) */
  public setPoolManager(pools: PoolManager | null): void {
    this.pools = pools;
  }

  private setupEventListeners(): void {
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
   * Spawn a new projectile as an ECS entity
   */
  public spawnProjectile(
    origin: Vector3,
    direction: Vector3,
    config: ProjectileSpawnConfig
  ): ProjectileEntity {
    const speed = config.speed ?? DEFAULT_PROJECTILE_SPEED;
    const lifetimeSecs = config.lifetime ?? DEFAULT_PROJECTILE_LIFETIME_SECS;
    const remainingTicks = Math.round(lifetimeSecs * networkConfig.tickRate);

    const fpDirection = FPVector3.Normalize(
      FPVector3.FromFloat(direction.x, direction.y, direction.z)
    );
    const fpSpeed = FP.FromFloat(speed);

    let entity: ProjectileEntity;

    if (this.pools) {
      // Pool path: acquire from pool, reinitialize template components
      entity = this.pools.acquire<ProjectileEntity>('projectile');
      entity.initVisual(this.scene, origin, direction, config.team);

      // Reinitialize template components (already attached during prewarm)
      const projectileComp = entity.getComponent<ProjectileComponent>(ComponentType.Projectile);
      if (projectileComp) {
        projectileComp.reinitialize(fpDirection, fpSpeed, config.damage, remainingTicks, config.sourceId);
      } else {
        entity.addComponent(
          new ProjectileComponent(fpDirection, fpSpeed, config.damage, remainingTicks, config.sourceId)
        );
      }

      const teamComp = entity.getComponent<TeamComponent>(ComponentType.Team);
      if (teamComp) {
        teamComp.reinitialize(config.team);
      } else {
        entity.addComponent(new TeamComponent(config.team));
      }
    } else {
      // Fallback: create new entity without pooling
      entity = new ProjectileEntity();
      entity.initVisual(this.scene, origin, direction, config.team);
      entity.addComponent(
        new ProjectileComponent(fpDirection, fpSpeed, config.damage, remainingTicks, config.sourceId)
      );
      entity.addComponent(new TeamComponent(config.team));
    }

    // SoA components are always created new (data lives in typed arrays)
    const initialFpPos = FPVector3.FromFloat(origin.x, origin.y, origin.z);
    const transform = new TransformComponent(entity.id, initialFpPos);
    entity.addComponent(transform);

    const interpolation = new InterpolationComponent(transform.fpPosition, false);
    entity.addComponent(interpolation);

    // Register with EntityManager
    this.entityManager.addEntity(entity);

    // Snap interpolation so the first frame doesn't blend from (0,0,0)
    interpolation.snapToPosition(transform.fpPosition);

    return entity;
  }

  /**
   * Process one network tick — deterministic projectile update
   */
  public override processTick(_tick: number): void {
    const projectileEntities = this.entityManager.queryEntities(ComponentType.Projectile);
    if (projectileEntities.length === 0) return;

    // Get all potential targets (entities with Health + Team + Transform)
    const potentialTargets = this.entityManager.queryEntities(
      ComponentType.Health,
      ComponentType.Team,
      ComponentType.Transform
    );

    for (const entity of projectileEntities) {
      if (entity.isDestroyed) continue;

      const projectile = entity.getComponent<ProjectileComponent>(ComponentType.Projectile)!;
      const transform = entity.getComponent<TransformComponent>(ComponentType.Transform)!;
      const team = entity.getComponent<TeamComponent>(ComponentType.Team)!;

      // Decrement tick-based lifetime
      projectile.remainingTicks--;
      if (projectile.remainingTicks <= 0) {
        this.destroyProjectile(entity, transform);
        continue;
      }

      // Move: displacement = direction * speed * timestep (all fixed-point)
      const fpDistance = FP.Mul(projectile.fpSpeed, FP_TIMESTEP);
      const movement = FPVector3.Scale(projectile.fpDirection, fpDistance);
      transform.fpPosition = FPVector3.Add(transform.fpPosition, movement);

      // Ground check
      if (FP.Lte(transform.fpPosition.y, FP_GROUND_LEVEL)) {
        this.destroyProjectile(entity, transform);
        continue;
      }

      // Collision check against hostile entities
      for (const target of potentialTargets) {
        if (target.isDestroyed) continue;
        // Don't collide with projectile entities
        if (target.hasComponent(ComponentType.Projectile)) continue;

        const targetTeam = target.getComponent<TeamComponent>(ComponentType.Team)!;
        if (targetTeam.team === team.team) continue;

        const targetTransform = target.getComponent<TransformComponent>(ComponentType.Transform)!;
        const distanceSq = FPVector3.SqrDistance(transform.fpPosition, targetTransform.fpPosition);

        if (FP.Lt(distanceSq, FP_HIT_RADIUS_SQ)) {
          this.eventBus.emit<DamageRequestedEvent>(GameEvents.DAMAGE_REQUESTED, {
            ...createEvent(),
            entityId: target.id,
            amount: projectile.damage,
            sourceId: projectile.sourceId,
          });

          const floatPos = FPVector3.ToFloat(transform.fpPosition);
          this.eventBus.emit<ProjectileHitEvent>(GameEvents.PROJECTILE_HIT, {
            ...createEvent(),
            targetId: target.id,
            damage: projectile.damage,
            position: new Vector3(floatPos.x, floatPos.y, floatPos.z),
            team: team.team,
            sourceId: projectile.sourceId,
          });

          this.destroyProjectile(entity, transform);
          break;
        }
      }
    }
  }

  /**
   * Create explosion effect and mark entity for cleanup
   */
  private destroyProjectile(entity: Entity, transform: TransformComponent): void {
    const floatPos = FPVector3.ToFloat(transform.fpPosition);
    new ExplosionEffect(this.scene, new Vector3(floatPos.x, floatPos.y, floatPos.z));
    entity.destroy();
  }

  /**
   * Clear all projectile entities
   */
  public clear(): void {
    const projectileEntities = this.entityManager.queryEntities(ComponentType.Projectile);
    for (const entity of projectileEntities) {
      entity.destroy();
    }
  }

  public override dispose(): void {
    super.dispose();
    this.clear();
  }
}
