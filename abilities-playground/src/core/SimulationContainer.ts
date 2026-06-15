import * as THREE from 'three';
import type { PhalanxClient } from 'phalanx-client';
import { Entity, GameWorld, resetEntityIdCounter } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import { PhysicsWorld } from 'phalanx-physics';
import {
  type AbilityActivationContext,
  createAbilitySystem,
} from 'phalanx-abilities';
import type { AbilitySystem } from 'phalanx-abilities';
import { arenaParams, networkConfig, physicsConfig } from '../config/constants';
import { combatDefs, UNIT_MOVE_SPEED } from '../config/abilityDefinitions';
import { DEFAULT_UNIT_DETECTION_RANGE, UNIT_ROSTER } from '../config/unitRoster';
import {
  ComponentType,
  StatsComponent,
  SimulationStateComponent,
} from '../components';
import { UnitEntity } from '../entities/UnitEntity';
import {
  AttackSystem,
  DeathSystem,
  MovementSystem,
  RenderSyncSystem,
  RotationSystem,
  StartSimulationSystem,
  TargetingSystem,
} from '../systems';
import type { UnitFactory } from './UnitFactory';
import {ProjectileEntity} from "../entities/Projectile.ts";
import { autoAttack } from "../hooks/AutoAttack.ts";
import { ProjectileDespawnQueueSystem, ProjectileCollisionSystem, ProjectileMovementSystem } from '../systems';
import { DamageSphereCue, DeathCue } from '../cues';

export class SimulationContainer {
  readonly world: GameWorld;
  readonly startSimulationSystem = new StartSimulationSystem();

  private readonly physicsWorld: PhysicsWorld;
  private readonly abilities: AbilitySystem;
  private readonly scene: THREE.Scene;

  constructor(client: PhalanxClient, unitFactory: UnitFactory, scene: THREE.Scene) {
    resetEntityIdCounter();

    this.scene = scene;
    this.world = new GameWorld({
      componentTypes: Object.values(ComponentType),
      tickFrameProvider: client,
      debug: import.meta.env.DEV,
      debugConfig: { updateInterval: 500 },
      pooling: {
        autoPrewarm: true,
        entityTypes: {
          'projectile': {
            factory: () => new ProjectileEntity(),
            pool: { initialSize: 50, maxSize: 200 },
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
      },
      hooks: {
        'Hook.AutoAttack': (ctx: AbilityActivationContext) => autoAttack(ctx, this.world),
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

      const aProjectile = eA.hasComponent(ComponentType.Projectile);
      const bProjectile = eB.hasComponent(ComponentType.Projectile);
      if (aProjectile && bProjectile) return false;

      return true;
    });

    const { physicsSystem, interpolationSystem } = this.physicsWorld.getSystems();
    this.world.registerSystems(
      [
        this.startSimulationSystem,
        new TargetingSystem(),
        new AttackSystem(),
        new MovementSystem(),
        new ProjectileMovementSystem(),
        physicsSystem,
        new ProjectileCollisionSystem(),
        new RotationSystem(),
        new DeathSystem(),
        new ProjectileDespawnQueueSystem(),
      ],
      [interpolationSystem, new RenderSyncSystem()],
    );

    this.spawnSimulationState();
    this.spawnUnits(unitFactory);
  }

  /** Returns the result title if game is over, otherwise null. */
  getGameOverTitle(localTeamId: 0 | 1): string | null {
    const [stateEntity] = this.world.entityManager.queryEntities(ComponentType.SimulationState);
    const state = stateEntity?.getComponent<SimulationStateComponent>(ComponentType.SimulationState);
    if (!state?.gameOver) return null;
    if (state.winner === null) return 'Draw';
    return state.winner === localTeamId ? 'Victory!' : 'Defeat';
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

  private spawnUnits(unitFactory: UnitFactory): void {
    for (const teamId of [0, 1] as const) {
      const spawnZ = teamId === 0 ? arenaParams.team1SpawnZ : arenaParams.team2SpawnZ;
      const forwardZ = teamId === 0 ? 1 : -1;
      for (const rosterEntry of UNIT_ROSTER) {
        const spawn = rosterEntry.spawns[teamId];
        if (!spawn) continue;
        const { offsetX, offsetZ } = spawn;
        const x = offsetX;
        const z = spawnZ + offsetZ * forwardZ;
        const y = unitFactory.getHeightOffset(rosterEntry.kind);
        const detectionRange =
          rosterEntry.detectionRange ?? DEFAULT_UNIT_DETECTION_RANGE;
        const renderRefs = unitFactory.createRenderRefs(
          rosterEntry.kind,
          teamId,
          detectionRange,
        );

        renderRefs.root.position.set(x, y, z);
        renderRefs.root.rotation.y = teamId === 0 ? 0 : Math.PI;

        this.scene.add(renderRefs.healthBarRoot);

        const unitEntity = new UnitEntity(rosterEntry, teamId, { x, y, z }, renderRefs);
        unitEntity.addComponent(
          this.abilities.initComponent({
            attributes: {
              Health: FP.FromFloat(rosterEntry.maxHealth),
              MaxHealth: FP.FromFloat(rosterEntry.maxHealth),
              MoveSpeed: FP.FromFloat(UNIT_MOVE_SPEED),
              IncomingDamageMultiplier: FP.FromInt(1),
            },
            abilities: ['Ability.AutoAttack'],
            tags: [`Team.${teamId}`],
          }),
        );
        this.world.entityManager.addEntity(unitEntity);
      }
    }
  }
}
