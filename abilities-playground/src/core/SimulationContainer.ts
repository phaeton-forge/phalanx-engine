import * as THREE from 'three';
import type { PhalanxClient } from '@phalanx-engine/client';
import { Entity, GameWorld } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import { PhysicsWorld } from '@phalanx-engine/physics';
import {
  type AbilityActivationContext,
  createAbilitySystem,
} from '@phalanx-engine/abilities';
import type { AbilitySystem } from '@phalanx-engine/abilities';
import { arenaParams, networkConfig, physicsConfig } from '../config/constants';
import {
  combatDefs,
  CUBE_SLOW_TAG,
  CUBE_SPEED_BUFF_TAG,
} from '../config/abilityDefinitions';

import {
  ComponentType,
  DetectionRingComponent,
  HealAuraComponent,
  HealthBarComponent,
  MeshComponent,
  StatsComponent,
  SimulationStateComponent,
  TeamComponent,
} from '../components';

import {
  ArtilleryShellSystem,
  AttackSystem,
  ChainLightningJumpSystem,
  CubeTargetingSystem,
  DeathSystem,
  FormationSystem,
  HealingAuraSystem,
  MissileLauncherSystem,
  MissileMovementSystem,
  MissileTargetingSystem,
  MovementSystem,
  RenderSyncSystem,
  RotationSystem,
  ShrapnelLandingSystem,
  ShrapnelSpinSystem,
  TargetingSystem,
  VoltAttackSystem,
} from '../systems';
import { UnitFactory } from '../units';
import { disposeUnitVisual } from '../units/unitVisuals';
import { ProjectileEntity } from '../entities/Projectile.ts';
import { MissileEntity } from '../entities/Missile';
import { ArtilleryShellEntity } from '../entities/ArtilleryShell';
import { ShrapnelEntity } from '../entities/Shrapnel';
import { autoAttack } from '../hooks/AutoAttack.ts';
import { missileVolley } from '../hooks/MissileVolley';
import { voltChainLightning } from '../hooks/VoltChainLightning';
import { plasmaTankMachineGun } from '../hooks/PlasmaTankMachineGun';
import { sauArtillery } from '../hooks/SauArtillery';
import {
  ProjectileDespawnQueueSystem,
  ProjectileCollisionSystem,
  ProjectileMovementSystem,
} from '../systems';
import {
  DamageSphereCue,
  DeathCue,
  HealCrossCue,
  BeamCue,
  MissileImpactCue,
  MissileExhaustCue,
  ChainLightningCue,
  MachineGunFireCue,
  MachineGunImpactCue,
  SauMuzzleFlashCue,
  SauImpactCue,
  SauSecondaryImpactCue,
  SauFallingShadowCue,
} from '../cues';

export class SimulationContainer {
  readonly world: GameWorld;
  readonly formationSystem: FormationSystem;
  readonly unitFactory: UnitFactory;

  private readonly physicsWorld: PhysicsWorld;
  private readonly abilities: AbilitySystem;
  private readonly scene: THREE.Scene;

  constructor(client: PhalanxClient, scene: THREE.Scene) {
    this.scene = scene;
    this.world = new GameWorld({
      componentTypes: Object.values(ComponentType),
      tickFrameProvider: client,
      debug: import.meta.env.DEV,
      debugConfig: { updateInterval: 500 },
      pooling: {
        autoPrewarm: true,
        entityTypes: {
          projectile: {
            factory: () => new ProjectileEntity(),
            pool: { initialSize: 50, maxSize: 200 },
          },
          missile: {
            factory: () => new MissileEntity(),
            pool: { initialSize: 30, maxSize: 120 },
          },
          artilleryShell: {
            factory: () => new ArtilleryShellEntity(),
            pool: { initialSize: 12, maxSize: 60 },
          },
          shrapnel: {
            factory: () => new ShrapnelEntity(),
            pool: { initialSize: 60, maxSize: 300 },
          },
        },
      },
    });

    this.physicsWorld = new PhysicsWorld({
      gridCellSize: FP.FromFloat(physicsConfig.gridCellSize),
      subSteps: physicsConfig.subSteps,
      tickRate: networkConfig.tickRate,
      maxVelocity: FP.FromFloat(physicsConfig.maxVelocity),
      pushStrength: FP.FromFloat(physicsConfig.pushStrength),
      // Global gravity (v1): only shrapnel bodies opt in via useGravity, so this
      // affects nothing else in the playground. See config/constants.ts.
      gravity: FP.FromFloat(physicsConfig.gravity),
      worldBounds: {
        minX: FP.FromFloat(-arenaParams.width / 2),
        maxX: FP.FromFloat(arenaParams.width / 2),
        minZ: FP.FromFloat(-arenaParams.length / 2),
        maxZ: FP.FromFloat(arenaParams.length / 2),
      },
    });
    this.world.context.physics = this.physicsWorld;

    this.abilities = createAbilitySystem(this.world, {
      definitions: combatDefs,
      cues: {
        'Cue.Damage.Sphere': () => new DamageSphereCue(this.scene),
        'Cue.Death': () => new DeathCue(this.scene),
        'Cue.Heal.Cross': () => new HealCrossCue(this.scene),
        'Cue.Beam.Red': () => new BeamCue(this.scene, 0xff3344, CUBE_SLOW_TAG),
        'Cue.Beam.Yellow': () =>
          new BeamCue(this.scene, 0xffdd33, CUBE_SPEED_BUFF_TAG),
        'Cue.Missile.Impact': () => new MissileImpactCue(this.scene),
        'Cue.Missile.Exhaust': () => new MissileExhaustCue(this.scene),
        'Cue.ChainLightning.Primary': () =>
          new ChainLightningCue(this.scene, 0x00ffff, true),
        'Cue.ChainLightning.Jump': () =>
          new ChainLightningCue(this.scene, 0x55ffff, false),
        'Cue.PlasmaTank.MachineGun.Fire': () =>
          new MachineGunFireCue(this.scene),
        'Cue.PlasmaTank.MachineGun.Impact': () =>
          new MachineGunImpactCue(this.scene),
        'Cue.SAU.MuzzleFlash': () => new SauMuzzleFlashCue(this.scene),
        'Cue.SAU.Impact': () => new SauImpactCue(this.scene),
        'Cue.SAU.SecondaryImpact': () => new SauSecondaryImpactCue(this.scene),
        'Cue.SAU.FallingShadow': () => new SauFallingShadowCue(this.scene),
      },
      hooks: {
        'Hook.AutoAttack': (ctx: AbilityActivationContext) =>
          autoAttack(ctx, this.world),
        'Hook.MissileVolley': (ctx: AbilityActivationContext) =>
          missileVolley(ctx, this.world),
        'Hook.Volt.ChainLightning': (ctx: AbilityActivationContext) =>
          voltChainLightning(ctx, this.world, this.abilities),
        'Hook.PlasmaTank.MachineGun': (ctx: AbilityActivationContext) =>
          plasmaTankMachineGun(ctx, this.world),
        'Hook.SAU.Fire': (ctx: AbilityActivationContext) =>
          sauArtillery(ctx, this.world),
      },
    });

    const entityManager = this.world.entityManager;
    this.physicsWorld.setCollisionFilter((entityIdA, entityIdB) => {
      const eA = entityManager.getEntity(entityIdA);
      const eB = entityManager.getEntity(entityIdB);
      if (!eA || !eB) return false;

      const statsA = eA.getComponent<StatsComponent>(ComponentType.UnitStats);
      if (statsA && !statsA.alive) return false;
      const statsB = eB.getComponent<StatsComponent>(ComponentType.UnitStats);
      if (statsB && !statsB.alive) return false;

      // Shrapnel is gravity-affected and physics-integrated, but it must not be
      // pushed around by (or push) units or other fragments — its only job is to
      // arc and land. Exclude shrapnel↔unit and shrapnel↔shrapnel pairs so the
      // collision filter (not ignorePhysics) protects it. Ground landing is
      // resolved geometrically by ShrapnelLandingSystem.
      const aShrapnel = eA.hasComponent(ComponentType.ShrapnelPayload);
      const bShrapnel = eB.hasComponent(ComponentType.ShrapnelPayload);
      if (aShrapnel || bShrapnel) return false;

      const aProjectile = eA.hasComponent(ComponentType.Projectile);
      const bProjectile = eB.hasComponent(ComponentType.Projectile);
      if (aProjectile && bProjectile) return false;

      // Projectiles only ever damage hostiles (ProjectileCollisionSystem ignores
      // same-team hits), so skip projectile↔ally pairs entirely. Without this,
      // homing missiles physically push and "rub against" allied units they fly
      // over — the physics engine is 2D/XZ, so flying at altitude alone does
      // not prevent the positional push between overlapping bodies.
      if (aProjectile !== bProjectile) {
        const projectile = aProjectile ? eA : eB;
        const other = aProjectile ? eB : eA;
        if ((projectile as { active?: boolean }).active === false) return false;
        const projTeam = projectile.getComponent<TeamComponent>(
          ComponentType.Team
        );
        const otherTeam = other.getComponent<TeamComponent>(ComponentType.Team);
        if (projTeam && otherTeam && projTeam.teamId === otherTeam.teamId) {
          return false;
        }
      }

      return true;
    });

    this.unitFactory = new UnitFactory(this.scene, this.abilities);
    this.formationSystem = new FormationSystem(this.unitFactory);

    const { physicsSystem, gravitySystem, interpolationSystem } =
      this.physicsWorld.getSystems();
    // SAU order (documented): AttackSystem → abilities (Hook.SAU.Fire) →
    // ArtilleryShellSystem → GravitySystem → physicsSystem →
    // ShrapnelLandingSystem. The shell system spawns shrapnel before gravity +
    // integration so fragments get their first arc step on their birth tick;
    // the landing system runs after integration to sweep prev→cur for ground
    // crossings.
    this.world.registerSystems(
      [
        this.formationSystem,
        new TargetingSystem(),
        new AttackSystem(),
        new MissileLauncherSystem(),
        new VoltAttackSystem(),
        new ChainLightningJumpSystem(),
        new MovementSystem(),
        new ProjectileMovementSystem(),
        new MissileTargetingSystem(),
        new MissileMovementSystem(),
        new ArtilleryShellSystem(),
        gravitySystem,
        physicsSystem,
        new ShrapnelLandingSystem(),
        new HealingAuraSystem(),
        new ProjectileCollisionSystem(),
        new RotationSystem(),
        new DeathSystem(),
        new CubeTargetingSystem(),
        new ProjectileDespawnQueueSystem(),
      ],
      // ShrapnelSpinSystem is cosmetic-only (rotates the shard mesh inside the
      // MeshComponent root) and must run after RenderSyncSystem has positioned
      // the roots for the frame.
      [interpolationSystem, new RenderSyncSystem(), new ShrapnelSpinSystem()]
    );

    this.spawnSimulationState();
  }

  /** Returns the result title if game is over, otherwise null. */
  getGameOverTitle(localTeamId: 0 | 1): string | null {
    const [stateEntity] = this.world.entityManager.queryEntities(
      ComponentType.SimulationState
    );
    const state = stateEntity?.getComponent<SimulationStateComponent>(
      ComponentType.SimulationState
    );
    if (!state?.gameOver) return null;
    if (state.winner === null) return 'Draw';
    return state.winner === localTeamId ? 'Victory!' : 'Defeat';
  }

  isSimulationActive(): boolean {
    const [stateEntity] = this.world.entityManager.queryEntities(
      ComponentType.SimulationState
    );
    const state = stateEntity?.getComponent<SimulationStateComponent>(
      ComponentType.SimulationState
    );
    return state?.active ?? false;
  }

  /**
   * Reset the battle back to the deployment phase.
   * Clears simulation state, removes every battle entity (units, projectiles,
   * missiles), detaches their meshes from the scene, and resets the formation
   * authority so players can redeploy.
   */
  resetBattle(): void {
    const entityManager = this.world.entityManager;

    const [stateEntity] = entityManager.queryEntities(
      ComponentType.SimulationState
    );
    const state = stateEntity?.getComponent<SimulationStateComponent>(
      ComponentType.SimulationState
    );
    if (state) {
      state.active = false;
      state.gameOver = false;
      state.winner = null;
    }

    const pools = this.world.pools;
    const entities = entityManager.getAllEntities();

    for (const entity of entities) {
      if (entity.hasComponent(ComponentType.SimulationState)) continue;

      const isPooled =
        entity.hasComponent(ComponentType.Projectile) ||
        entity.hasComponent(ComponentType.Missile) ||
        entity.hasComponent(ComponentType.ArtilleryShell) ||
        entity.hasComponent(ComponentType.ShrapnelPayload);

      if (pools && isPooled) {
        pools.despawn(entity);
      } else {
        this.removeEntityVisuals(entity);
        entityManager.removeEntity(entity);
      }
    }

    this.formationSystem.reset();
  }

  private removeEntityVisuals(entity: Entity): void {
    const mesh = entity.getComponent<MeshComponent>(ComponentType.Mesh);
    if (mesh) {
      this.scene.remove(mesh.root);
      disposeUnitVisual(mesh.root);
    }

    const healthBar = entity.getComponent<HealthBarComponent>(
      ComponentType.HealthBar
    );
    if (healthBar) {
      this.scene.remove(healthBar.root);
      disposeUnitVisual(healthBar.root);
    }

    const detectionRing = entity.getComponent<DetectionRingComponent>(
      ComponentType.DetectionRing
    );
    if (detectionRing) {
      this.scene.remove(detectionRing.root);
      disposeUnitVisual(detectionRing.root);
    }

    // The aura ring is a world-space decal, not a child of the unit body.
    const aura = entity.getComponent<HealAuraComponent>(ComponentType.HealAura);
    if (aura?.auraRing) {
      this.scene.remove(aura.auraRing);
      disposeUnitVisual(aura.auraRing);
    }
  }

  dispose(): void {
    this.world.dispose();
    this.physicsWorld.dispose();
  }

  private spawnSimulationState(): void {
    const stateEntity = new Entity();
    stateEntity.addComponent(new SimulationStateComponent());
    this.world.entityManager.addEntity(stateEntity);
  }
}
