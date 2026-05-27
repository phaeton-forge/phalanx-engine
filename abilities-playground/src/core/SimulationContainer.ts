import * as THREE from 'three';
import type { PhalanxClient } from 'phalanx-client';
import { Entity, GameWorld } from 'phalanx-ecs';
import type { SoAComponentStore, SoASchemaDefinition } from 'phalanx-ecs';
import { FP, FPVector3 } from 'phalanx-math';
import { PhysicsBodyComponent, PhysicsSoASchema, PHYSICS_BODY_COMPONENT_TYPE } from 'phalanx-physics';
import { PhysicsWorld } from 'phalanx-physics';
import {type AbilityActivationContext, createAbilitySystem} from 'phalanx-abilities';
import type { AbilitySystem } from 'phalanx-abilities';
import { arenaParams, networkConfig, physicsConfig } from '../config/constants';
import { combatDefs, HEAL_AURA_PERIOD_TICKS, HEAL_AURA_RADIUS, UNIT_MOVE_SPEED } from '../config/abilityDefinitions';
import { UNIT_ROSTER } from '../config/unitRoster';
import {
  ComponentType,
  HealerAuraLinkComponent,
  SimulationStateComponent,
  TransformComponent,
  TransformSoASchema,
} from '../components';
import { UnitEntity } from '../entities/UnitEntity';
import {
  AttackSystem,
  DeathSystem,
  HealerAuraSystem,
  InterpolationSystem,
  MovementSystem,
  RenderSyncSystem,
  StartSimulationSystem,
  TargetingSystem,
} from '../systems';
import type { UnitFactory } from './UnitFactory';
import {ProjectileEntity} from "../entities/Projectile.ts";
import {autoAttack} from "../hooks/AutoAttack.ts";

export class SimulationContainer {
  readonly world: GameWorld;
  readonly startSimulationSystem = new StartSimulationSystem();
  readonly interpolationSystem = new InterpolationSystem();
  readonly renderSyncSystem = new RenderSyncSystem();

  private readonly physicsWorld: PhysicsWorld;
  private readonly abilities: AbilitySystem;
  private readonly scene: THREE.Scene;
  private transformStoreLinked = false;

  constructor(client: PhalanxClient, unitFactory: UnitFactory, scene: THREE.Scene) {
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
            components: [],
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

    this.abilities = createAbilitySystem(this.world, {
      definitions: combatDefs,
      physicsWorld: this.physicsWorld,
      cues: 'dispatch',
      hooks: {
        'Hook.AutoAttack': (ctx: AbilityActivationContext) => autoAttack(ctx, this.world),
      },
    });

    const { physicsSystem } = this.physicsWorld.getSystems();
    this.world.registerSystems(
      [
        this.startSimulationSystem,
        new TargetingSystem(),
        new AttackSystem(),
        new HealerAuraSystem(),
        new MovementSystem(),
        physicsSystem,
        new DeathSystem(),
      ],
      [this.interpolationSystem, this.renderSyncSystem],
    );

    this.spawnSimulationState();
    this.spawnUnits(unitFactory);
  }

  linkTransformStore(): void {
    if (this.transformStoreLinked) return;
    const transformStore = this.world.entityManager.getOrCreateSoAStore(TransformSoASchema);
    this.physicsWorld.setTransformStore(
      transformStore as unknown as SoAComponentStore<SoASchemaDefinition>,
      {
        fpPositionX: 'fpPositionX',
        fpPositionY: 'fpPositionY',
        fpPositionZ: 'fpPositionZ',
        visualPositionX: 'visualPositionX',
        visualPositionZ: 'visualPositionZ',
      },
    );
    this.transformStoreLinked = true;
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
        const x = rosterEntry.offsetX;
        const z = spawnZ + rosterEntry.offsetZ * forwardZ;
        const y = unitFactory.getHeightOffset(rosterEntry.kind);
        const renderRefs = unitFactory.createRenderRefs(rosterEntry.kind, teamId);
        renderRefs.root.position.set(x, y, z);
        renderRefs.root.rotation.y = teamId === 0 ? 0 : Math.PI;
        this.scene.add(renderRefs.root);
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

        if (rosterEntry.kind === 'cube') {
          this.spawnHealerAura(unitEntity, teamId, { x, z });
        }
      }
    }
  }

  private spawnHealerAura(
    cubeEntity: UnitEntity,
    teamId: 0 | 1,
    position: { x: number; z: number },
  ): void {
    const link = cubeEntity.getComponent<HealerAuraLinkComponent>(ComponentType.HealerAuraLink);
    if (!link) return;

    const zoneEntity = this.abilities.spawnAura({
      abilityId: 'Ability.HealAura',
      target: {
        kind: 'Radius',
        origin: { kind: 'Caster' },
        radius: FP.FromFloat(HEAL_AURA_RADIUS),
        filter: {
          tagsRequired: [`Team.${teamId}`],
          tagsBlocked: ['State.Dead'],
        },
        includeSelf: true,
      },
      effectIds: ['Effect.HealAura.Tick'],
      periodTicks: HEAL_AURA_PERIOD_TICKS,
      ownerEntityId: cubeEntity.id,
    });

    const initialFp = FPVector3.FromFloat(position.x, 0, position.z);
    const zoneTransform = new TransformComponent(zoneEntity.id, initialFp);
    zoneEntity.addComponent(zoneTransform);
    this.world.entityManager.onComponentAdded(zoneEntity, ComponentType.Transform);

    const zonePhysics = new PhysicsBodyComponent(zoneEntity.id, {
      radius: FP.FromFloat(0.1),
      mass: FP.FromFloat(1),
      friction: FP.FromFloat(0),
      restitution: FP.FromFloat(0),
    });
    zoneEntity.addComponent(zonePhysics);
    this.world.entityManager.onComponentAdded(zoneEntity, PHYSICS_BODY_COMPONENT_TYPE);

    const physStore = this.world.entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    const physIdx = physStore.indexOf(zoneEntity.id);
    if (physIdx !== -1) {
      physStore.arrays.ignorePhysics[physIdx] = 1;
    }

    link.auraEntityId = zoneEntity.id;
  }
}
