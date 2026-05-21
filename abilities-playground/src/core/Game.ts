import {
  ArcRotateCamera,
  Color3,
  Color4,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';
import { Entity, GameWorld } from 'phalanx-ecs';
import type { CommandsBatch } from 'phalanx-ecs';
import type { MatchFoundEvent, PhalanxClient } from 'phalanx-client';
import { FP } from 'phalanx-math';
import {
  AbilitySystemFacade,
  createAbilitySystemRegistries,
  createAbilitySystemRuntime,
  defineAttribute,
  defineEffect,
} from 'phalanx-abilities';
import type {
  ISpatialQuery,
  AbilitySystemRegistries,
  AbilitySystemRuntime,
} from 'phalanx-abilities';
import {
  arenaConfig,
  cameraConfig,
  networkConfig,
  tags,
  teamColors,
} from '../config/constants';
import { UNIT_ROSTER, type UnitSpawnEntry } from '../config/unitRoster';
import {
  ComponentType,
  CombatComponent,
  LifecycleComponent,
  TargetingComponent,
  TransformComponent,
  UnitComponent,
  type TeamId,
  type UnitType,
  VisualComponent,
} from '../components';
import {
  AbilitySystem,
  AttackSystem,
  BeamSystem,
  DeathSystem,
  HealAuraSystem,
  MovementSystem,
  RenderSyncSystem,
  TargetingSystem,
} from '../systems';
import type { AbilityContext, GameRuntimeState } from './types';

class UnitSpatialQuery implements ISpatialQuery {
  public constructor(private readonly world: GameWorld) {}

  public queryRadius(
    x: import('phalanx-math').FixedPoint,
    z: import('phalanx-math').FixedPoint,
    radius: import('phalanx-math').FixedPoint
  ): number[] {
    const centerX = FP.ToFloat(x);
    const centerZ = FP.ToFloat(z);
    const radiusSq = Math.pow(FP.ToFloat(radius), 2);
    const ids: number[] = [];

    for (const entity of this.world.entityManager.queryEntities(
      ComponentType.Transform
    )) {
      const transform = entity.getComponent<TransformComponent>(
        ComponentType.Transform
      );
      const life = entity.getComponent<LifecycleComponent>(
        ComponentType.Lifecycle
      );
      if (!transform || !life || !life.alive) continue;
      const dx = FP.ToFloat(transform.x) - centerX;
      const dz = FP.ToFloat(transform.z) - centerZ;
      if (dx * dx + dz * dz <= radiusSq) ids.push(entity.id);
    }

    return ids;
  }

  public getEntityPosition(entityId: number):
    | {
        x: import('phalanx-math').FixedPoint;
        z: import('phalanx-math').FixedPoint;
      }
    | undefined {
    const entity = this.world.entityManager.getEntity(entityId);
    const transform = entity?.getComponent<TransformComponent>(
      ComponentType.Transform
    );
    if (transform) {
      return { x: transform.x, z: transform.z };
    }

    return undefined;
  }
}

export class Game {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly world: GameWorld;
  private readonly registries: AbilitySystemRegistries;
  private readonly runtime: AbilitySystemRuntime;
  private readonly facade: AbilitySystemFacade;
  private readonly state: GameRuntimeState;
  private readonly abilityContext: AbilityContext;
  private readonly unsubscribers: Array<() => void> = [];
  private onExit: (() => void) | null = null;

  private readonly startButton = document.getElementById(
    'start-simulation-btn'
  ) as HTMLButtonElement;
  private readonly startOverlay = document.getElementById(
    'overlay-center'
  ) as HTMLElement;
  private readonly resultOverlay = document.getElementById(
    'result-overlay'
  ) as HTMLElement;
  private readonly resultText = document.getElementById(
    'result-text'
  ) as HTMLElement;
  private readonly returnLobbyButton = document.getElementById(
    'return-lobby-btn'
  ) as HTMLButtonElement;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly client: PhalanxClient,
    matchData: MatchFoundEvent
  ) {
    this.engine = new Engine(canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.11, 0.16, 0.11, 1);

    this.state = {
      currentTick: -1,
      simulationStarted: false,
      gameOver: false,
      winnerTeam: null,
      localTeam: matchData.teamId === 1 ? 1 : 2,
      beamPulseTime: 0,
    };

    this.world = new GameWorld({
      componentTypes: Object.values(ComponentType),
      tickFrameProvider: this.client,
    });

    this.registries = createAbilitySystemRegistries();
    this.runtime = createAbilitySystemRuntime();
    this.facade = new AbilitySystemFacade(
      this.world.entityManager,
      this.registries,
      this.runtime
    );

    this.abilityContext = {
      facade: this.facade,
      effects: {
        damage18: 'Effect.Damage18',
        damage54: 'Effect.Damage5_4',
        heal5: 'Effect.Heal5',
        illuminated: 'Effect.Illuminated',
        jammed: 'Effect.Jammed',
        cubeAuraLifetime: 'Effect.CubeAura.Lifetime',
      },
      tags: {
        team1: tags.team1,
        team2: tags.team2,
        illuminated: tags.illuminated,
        cubeAura: tags.cubeAura,
      },
      attributeIndexes: {
        health: 0,
        moveSpeedMultiplier: 1,
        attackSpeedMultiplier: 2,
      },
    };

    this.startButton.addEventListener('click', () => {
      this.client.sendCommand('start-simulation', {});
    });

    this.returnLobbyButton.addEventListener('click', () => {
      this.handleExit();
    });

    window.addEventListener('resize', () => this.engine.resize());
  }

  public setOnExit(callback: () => void): void {
    this.onExit = callback;
  }

  public initialize(): void {
    this.setupArena();
    this.setupCamera();
    this.setupAbilities();
    this.spawnUnits();
    this.setupSystems();
    this.setupNetworkSignals();
    this.showStartOverlay();
  }

  private setupAbilities(): void {
    this.registries.attributes.register(
      defineAttribute({
        id: 'Health',
        default: FP.FromInt(0),
        min: FP.FromInt(0),
        max: FP.FromInt(1000),
        clamp: 'both',
      })
    );
    this.registries.attributes.register(
      defineAttribute({
        id: 'MoveSpeedMultiplier',
        default: FP.FromInt(1),
        min: FP.FromFloat(0.1),
        max: FP.FromInt(3),
        clamp: 'both',
      })
    );
    this.registries.attributes.register(
      defineAttribute({
        id: 'AttackSpeedMultiplier',
        default: FP.FromInt(1),
        min: FP.FromFloat(0.1),
        max: FP.FromInt(3),
        clamp: 'both',
      })
    );

    this.registries.effects.register(
      defineEffect({
        id: this.abilityContext.effects.damage18,
        type: 'Instant',
        modifiers: [
          { attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-18) },
        ],
      })
    );
    this.registries.effects.register(
      defineEffect({
        id: this.abilityContext.effects.damage54,
        type: 'Instant',
        modifiers: [
          { attributeId: 'Health', op: 'Add', magnitude: FP.FromFloat(-5.4) },
        ],
      })
    );
    this.registries.effects.register(
      defineEffect({
        id: this.abilityContext.effects.heal5,
        type: 'Instant',
        modifiers: [
          { attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(5) },
        ],
      })
    );
    this.registries.effects.register(
      defineEffect({
        id: this.abilityContext.effects.illuminated,
        type: 'Duration',
        durationTicks: 2,
        modifiers: [],
        tagsGranted: [tags.illuminated],
      })
    );
    this.registries.effects.register(
      defineEffect({
        id: this.abilityContext.effects.jammed,
        type: 'Duration',
        durationTicks: 2,
        modifiers: [
          {
            attributeId: 'MoveSpeedMultiplier',
            op: 'Multiply',
            magnitude: FP.FromFloat(0.6),
          },
          {
            attributeId: 'AttackSpeedMultiplier',
            op: 'Multiply',
            magnitude: FP.FromFloat(0.6),
          },
        ],
        tagsGranted: [tags.jammed],
      })
    );
    this.registries.effects.register(
      defineEffect({
        id: this.abilityContext.effects.cubeAuraLifetime,
        type: 'Duration',
        durationTicks: 100000,
        modifiers: [],
        tagsGranted: [tags.cubeAura],
      })
    );

    this.abilityContext.attributeIndexes.health =
      this.registries.attributes.indexOf('Health');
    this.abilityContext.attributeIndexes.moveSpeedMultiplier =
      this.registries.attributes.indexOf('MoveSpeedMultiplier');
    this.abilityContext.attributeIndexes.attackSpeedMultiplier =
      this.registries.attributes.indexOf('AttackSpeedMultiplier');

    this.facade.registerSpatialQuery(new UnitSpatialQuery(this.world));
  }

  private setupSystems(): void {
    const tickSystems = [
      new TargetingSystem(this.state),
      new MovementSystem(this.state, this.abilityContext),
      new BeamSystem(this.state, this.abilityContext),
      new AttackSystem(this.state, this.abilityContext),
      new HealAuraSystem(this.abilityContext),
      new AbilitySystem(this.registries, this.runtime),
      new DeathSystem(this.state, this.abilityContext, (winner) =>
        this.handleGameOver(winner)
      ),
    ];

    const frameSystems = [
      new RenderSyncSystem(this.scene, this.state, this.abilityContext),
    ];

    this.world.registerSystems(tickSystems, frameSystems);
    this.world.start({
      beforeTick: (tick: number, commandsBatch: CommandsBatch) => {
        this.state.currentTick = tick;
        this.processCommands(commandsBatch);
      },
      afterFrame: () => {
        this.scene.render();
      },
    });
  }

  private setupNetworkSignals(): void {
    this.unsubscribers.push(
      this.client.on('matchEnd', () => {
        this.handleExit();
      })
    );
    this.unsubscribers.push(
      this.client.on('playerDisconnected', () => {
        this.handleExit();
      })
    );
  }

  private processCommands(commandsBatch: CommandsBatch): void {
    if (this.state.gameOver || this.state.simulationStarted) return;
    for (const commands of Object.values(commandsBatch.commands)) {
      for (const command of commands) {
        if (command.type === 'start-simulation') {
          this.state.simulationStarted = true;
          this.startOverlay.classList.add('hidden');
          return;
        }
      }
    }
  }

  private setupArena(): void {
    const ground = MeshBuilder.CreateGround(
      'ground',
      { width: arenaConfig.width, height: arenaConfig.length },
      this.scene
    );
    const groundMat = new StandardMaterial('ground-mat', this.scene);
    groundMat.diffuseColor = new Color3(0.1, 0.25, 0.1);
    groundMat.specularColor = Color3.Black();
    ground.material = groundMat;

    const divider = MeshBuilder.CreateBox(
      'divider',
      { width: arenaConfig.width, height: 0.2, depth: 1 },
      this.scene
    );
    divider.position.y = 0.1;
    divider.position.z = 0;
    const dividerMat = new StandardMaterial('divider-mat', this.scene);
    dividerMat.diffuseColor = Color3.Black();
    divider.material = dividerMat;

    const light = new HemisphericLight(
      'light',
      new Vector3(0, 1, 0),
      this.scene
    );
    light.intensity = 0.95;
  }

  private setupCamera(): void {
    const isTeam1 = this.state.localTeam === 1;
    const camera = new ArcRotateCamera(
      'camera',
      isTeam1 ? Math.PI / 2 : -Math.PI / 2,
      Math.PI / 2.9,
      cameraConfig.height,
      new Vector3(
        0,
        0,
        isTeam1 ? cameraConfig.lookAheadOffset : -cameraConfig.lookAheadOffset
      ),
      this.scene
    );
    camera.lowerRadiusLimit = cameraConfig.height;
    camera.upperRadiusLimit = cameraConfig.height;
    camera.panningSensibility = 0;
    camera.wheelPrecision = 999999;
    camera.attachControl(this.canvas, true);
  }

  private spawnUnits(): void {
    this.spawnTeamUnits(1, UNIT_ROSTER.team1, arenaConfig.team1SpawnZ);
    this.spawnTeamUnits(2, UNIT_ROSTER.team2, arenaConfig.team2SpawnZ);
  }

  private spawnTeamUnits(
    teamId: TeamId,
    entries: UnitSpawnEntry[],
    originZ: number
  ): void {
    for (const entry of entries) {
      const spawnX = entry.position.x;
      const spawnZ = originZ + entry.position.z;
      this.createUnit(teamId, entry.type, spawnX, spawnZ);
    }
  }

  private createUnit(
    teamId: TeamId,
    unitType: UnitType,
    x: number,
    z: number
  ): void {
    const entity = new Entity();
    this.world.entityManager.addEntity(entity);

    const stats = this.getUnitStats(unitType);
    const transform = entity.addComponent(
      new TransformComponent(FP.FromFloat(x), FP.FromFloat(z))
    );
    entity.addComponent(
      new UnitComponent(
        unitType,
        teamId,
        stats.hp,
        stats.moveSpeed,
        stats.attackRange,
        stats.attackDamage,
        stats.attackCooldownTicks
      )
    );
    entity.addComponent(new CombatComponent());
    entity.addComponent(new TargetingComponent());
    entity.addComponent(new LifecycleComponent());

    const visual = this.createVisual(unitType, teamId, x, z);
    entity.addComponent(visual);

    const attributes = this.facade.initAttributesForEntity(entity.id);
    attributes.base[this.abilityContext.attributeIndexes.health] = FP.ToRaw(
      stats.hp
    );
    attributes.current[this.abilityContext.attributeIndexes.health] = FP.ToRaw(
      stats.hp
    );
    attributes.base[this.abilityContext.attributeIndexes.moveSpeedMultiplier] =
      FP.ToRaw(FP.FromInt(1));
    attributes.current[
      this.abilityContext.attributeIndexes.moveSpeedMultiplier
    ] = FP.ToRaw(FP.FromInt(1));
    attributes.base[
      this.abilityContext.attributeIndexes.attackSpeedMultiplier
    ] = FP.ToRaw(FP.FromInt(1));
    attributes.current[
      this.abilityContext.attributeIndexes.attackSpeedMultiplier
    ] = FP.ToRaw(FP.FromInt(1));

    this.facade.addTag(entity.id, teamId === 1 ? tags.team1 : tags.team2);

    if (unitType === 'cube') {
      const auraEntity = this.facade.spawnAura({
        abilityId: 'Ability.CubeAura',
        target: {
          kind: 'Radius',
          origin: { kind: 'TargetEntity', entityId: entity.id },
          radius: FP.FromInt(20),
          filter: { tagsRequired: [teamId === 1 ? tags.team1 : tags.team2] },
          includeSelf: true,
        },
        effectIds: [this.abilityContext.effects.heal5],
        periodTicks: 1,
        ownerEntityId: entity.id,
        lifetimeEffectId: this.abilityContext.effects.cubeAuraLifetime,
        lifetimeTag: tags.cubeAura,
      });
      const unit = entity.getComponent<UnitComponent>(ComponentType.Unit);
      if (unit) unit.auraEntityId = auraEntity.id;
    }

    transform.x = FP.FromFloat(x);
    transform.z = FP.FromFloat(z);
  }

  private createVisual(
    unitType: UnitType,
    teamId: TeamId,
    x: number,
    z: number
  ): VisualComponent {
    const teamBase = Color3.FromHexString(
      teamId === 1 ? teamColors.team1 : teamColors.team2
    );
    let mesh: Mesh;

    if (unitType === 'sphere') {
      mesh = MeshBuilder.CreateSphere(
        `sphere-${teamId}-${x}-${z}`,
        { diameter: 3.2 },
        this.scene
      );
    } else if (unitType === 'cube') {
      mesh = MeshBuilder.CreateBox(
        `cube-${teamId}-${x}-${z}`,
        { size: 3.4 },
        this.scene
      );
    } else {
      mesh = MeshBuilder.CreateCylinder(
        `cone-${teamId}-${x}-${z}`,
        { height: 4.2, diameterTop: 0, diameterBottom: 3, tessellation: 8 },
        this.scene
      );
    }

    mesh.position = new Vector3(x, 2, z);
    const material = new StandardMaterial(`unit-mat-${mesh.name}`, this.scene);
    material.diffuseColor =
      unitType === 'cube'
        ? teamBase.add(new Color3(0, 0.4, 0)).scale(0.8)
        : unitType === 'cone'
          ? teamBase.add(new Color3(0.6, 0.6, 0)).scale(0.7)
          : teamBase;
    material.specularColor = Color3.Black();
    material.alpha = 1;
    mesh.material = material;

    const hpBar = MeshBuilder.CreateBox(
      `hp-${mesh.name}`,
      { width: 4, height: 0.25, depth: 0.2 },
      this.scene
    );
    hpBar.position = new Vector3(x, 4.5, z);
    const hpMaterial = new StandardMaterial(`hp-mat-${mesh.name}`, this.scene);
    hpMaterial.diffuseColor =
      teamId === 1 ? new Color3(0.2, 0.8, 1) : new Color3(1, 0.4, 0.4);
    hpMaterial.specularColor = Color3.Black();
    hpBar.material = hpMaterial;

    let auraRing: Mesh | null = null;
    if (unitType === 'cube') {
      auraRing = MeshBuilder.CreateTorus(
        `aura-${mesh.name}`,
        { diameter: 40, thickness: 0.4, tessellation: 32 },
        this.scene
      );
      auraRing.rotation.x = Math.PI / 2;
      auraRing.position = new Vector3(x, 0.1, z);
      const auraMat = new StandardMaterial(`aura-mat-${mesh.name}`, this.scene);
      auraMat.diffuseColor = new Color3(0.2, 1, 0.4);
      auraMat.emissiveColor = new Color3(0.1, 0.5, 0.2);
      auraMat.alpha = 0.4;
      auraRing.material = auraMat;
    }

    return new VisualComponent(mesh, hpBar, auraRing, [null, null, null]);
  }

  private getUnitStats(unitType: UnitType): {
    hp: import('phalanx-math').FixedPoint;
    moveSpeed: import('phalanx-math').FixedPoint;
    attackRange: import('phalanx-math').FixedPoint;
    attackDamage: import('phalanx-math').FixedPoint;
    attackCooldownTicks: number;
  } {
    if (unitType === 'sphere') {
      return {
        hp: FP.FromInt(120),
        moveSpeed: FP.FromInt(8),
        attackRange: FP.FromInt(12),
        attackDamage: FP.FromInt(18),
        attackCooldownTicks: Math.round(networkConfig.tickRate * 1.0),
      };
    }

    if (unitType === 'cube') {
      return {
        hp: FP.FromInt(180),
        moveSpeed: FP.FromInt(6),
        attackRange: FP._0,
        attackDamage: FP._0,
        attackCooldownTicks: 1,
      };
    }

    return {
      hp: FP.FromInt(80),
      moveSpeed: FP.FromInt(5),
      attackRange: FP._0,
      attackDamage: FP._0,
      attackCooldownTicks: 1,
    };
  }

  private showStartOverlay(): void {
    this.startOverlay.classList.remove('hidden');
    this.resultOverlay.classList.add('hidden');
  }

  private handleGameOver(winner: TeamId): void {
    this.resultOverlay.classList.remove('hidden');
    this.resultText.textContent =
      winner === this.state.localTeam ? 'Victory' : 'Defeat';
  }

  private handleExit(): void {
    this.client.disconnect();
    this.onExit?.();
  }

  public dispose(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.length = 0;
    this.world.stop();
    this.world.dispose();
    this.engine.dispose();
  }
}
