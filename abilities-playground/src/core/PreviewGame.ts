import * as THREE from 'three';
import type { MatchFoundEvent, PhalanxClient } from 'phalanx-client';
import { Entity, GameWorld } from 'phalanx-ecs';
import type { CommandsBatch, SoAComponentStore, SoASchemaDefinition } from 'phalanx-ecs';
import { FP, FPVector3 } from 'phalanx-math';
import { PhysicsBodyComponent, PhysicsSoASchema, PHYSICS_BODY_COMPONENT_TYPE } from 'phalanx-physics';
import { PhysicsWorld } from 'phalanx-physics';
import { createAbilitySystem } from 'phalanx-abilities';
import type { AbilitySystem } from 'phalanx-abilities';
import { arenaParams, cameraConfig, networkConfig, physicsConfig } from '../config/constants';
import { combatDefs, HEAL_AURA_PERIOD_TICKS, HEAL_AURA_RADIUS, UNIT_MOVE_SPEED } from '../config/abilityDefinitions';
import { UNIT_ROSTER, type UnitKind } from '../config/unitRoster';
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
  // BeamSystem,
  DeathSystem,
  HealerAuraSystem,
  InterpolationSystem,
  MovementIntentSystem,
  RenderSyncSystem,
  StartSimulationSystem,
  TargetingSystem,
} from '../systems';

export class PreviewGame {
  private readonly client: PhalanxClient;
  private readonly matchData: MatchFoundEvent;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  private readonly startOverlay: HTMLElement;
  private readonly resultOverlay: HTMLElement;
  private readonly returnLobbyButton: HTMLButtonElement;
  private readonly startButton: HTMLButtonElement;
  private readonly world: GameWorld;
  private readonly physicsWorld: PhysicsWorld;
  private readonly abilities: AbilitySystem;
  private readonly startSimulationSystem = new StartSimulationSystem();
  private readonly interpolationSystem = new InterpolationSystem();
  private readonly renderSyncSystem = new RenderSyncSystem();
  private readonly networkEventUnsubscribers: (() => void)[] = [];
  private gameOverShown = false;
  private readonly pressedKeys = new Set<string>();
  private readonly cameraAnchor = new THREE.Vector3();
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  private readonly localTeamId: 0 | 1;
  private readonly forwardZ: 1 | -1;
  private cameraHeight = cameraConfig.height;
  private onExit: (() => void) | null = null;
  private transformStoreLinked = false;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, client: PhalanxClient, matchData: MatchFoundEvent) {
    this.client = client;
    this.matchData = matchData;
    this.localTeamId = matchData.teamId === 1 ? 1 : 0;
    this.forwardZ = this.localTeamId === 0 ? 1 : -1;
    this.startOverlay = document.getElementById('start-overlay')!;
    this.resultOverlay = document.getElementById('result-overlay')!;
    this.returnLobbyButton = document.getElementById('return-lobby-btn') as HTMLButtonElement;
    this.startButton = document.getElementById('start-btn') as HTMLButtonElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x1a1a2e);
    this.cameraAnchor.set(0, 0, this.localTeamId === 0 ? arenaParams.team1SpawnZ : arenaParams.team2SpawnZ);
    this.syncCameraToAnchor();
    this.world = new GameWorld({
      componentTypes: Object.values(ComponentType),
      tickFrameProvider: this.client,
      debug: import.meta.env.DEV,
      debugConfig: { updateInterval: 500 },
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
        'Hook.AutoAttack': (ctx) => {
          console.log(
            `[AutoAttack] tick=${ctx.tick} caster=${ctx.casterEntityId} targets=${JSON.stringify(ctx.resolvedTargets)}`,
          );
        },
      },
    });

    const movementSystem = new MovementIntentSystem();
    // const beamSystem = new BeamSystem();
    const attackSystem = new AttackSystem();
    const deathSystem = new DeathSystem();

    const { physicsSystem } = this.physicsWorld.getSystems();
    this.world.registerSystems(
      [
        this.startSimulationSystem,
        new TargetingSystem(),
        // beamSystem,
        attackSystem,
        new HealerAuraSystem(),
        movementSystem,
        physicsSystem,
        deathSystem,
      ],
      [this.interpolationSystem, this.renderSyncSystem],
    );
    this.setupScene();
    this.spawnSimulationState();
    this.spawnUnits();
    this.addEventListeners(canvas);
  }

  setOnExit(callback: () => void): void {
    this.onExit = callback;
  }

  async initialize(): Promise<void> {
    this.onResize();
    this.startOverlay.classList.add('visible');
    this.resultOverlay.classList.remove('visible', 'victory', 'defeat');
    this.linkTransformStore();
    this.world.start({
      beforeTick: (_tick: number, commandsBatch: CommandsBatch) => {
        this.linkTransformStore();
        this.startSimulationSystem.processCommands(commandsBatch);
      },
      afterTick: () => {
        this.checkGameOver();
      },
      beforeFrame: (_alpha: number, dt: number) => {
        this.updateCamera(dt);
      },
      afterFrame: () => {
        this.renderSyncSystem.update(0);
        this.renderer.render(this.scene, this.camera);
      },
    });
    this.interpolationSystem.snapToCurrentPositions();
    this.client.sendReady();
    console.log(`[PreviewGame] ready match=${this.matchData.matchId} team=${this.matchData.teamId}`);
  }

  private addEventListeners(canvas: HTMLCanvasElement): void {
    this.startButton.addEventListener('click', this.onStartClick);
    this.returnLobbyButton.addEventListener('click', this.onReturnLobby);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('resize', this.onResize);
    this.networkEventUnsubscribers.push(this.client.on('matchEnd', () => this.showResultOverlay('Match ended')));
  }

  private setupScene(): void {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(12, 20, 10);
    this.scene.add(sun);
    this.createArena();
  }

  private createArena(): void {
    const ground = new THREE.Mesh(
      this.trackGeometry(new THREE.PlaneGeometry(arenaParams.width, arenaParams.length)),
      this.trackMaterial(new THREE.MeshStandardMaterial({ color: arenaParams.groundColor })),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    const centerLine = new THREE.Mesh(
      this.trackGeometry(new THREE.BoxGeometry(arenaParams.width, 0.05, 0.4)),
      this.trackMaterial(new THREE.MeshStandardMaterial({ color: arenaParams.centerLineColor, opacity: 0.35, transparent: true })),
    );
    centerLine.position.y = 0.03;
    this.scene.add(centerLine);
    const sideLineMaterial = this.trackMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, opacity: 0.18, transparent: true }));
    for (const x of [-arenaParams.width / 2, arenaParams.width / 2]) {
      const sideLine = new THREE.Mesh(this.trackGeometry(new THREE.BoxGeometry(0.35, 0.05, arenaParams.length)), sideLineMaterial);
      sideLine.position.set(x, 0.04, 0);
      this.scene.add(sideLine);
    }
    const spawnLineMaterial = this.trackMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, opacity: 0.12, transparent: true }));
    for (const z of [arenaParams.team1SpawnZ, arenaParams.team2SpawnZ]) {
      const spawnLine = new THREE.Mesh(this.trackGeometry(new THREE.BoxGeometry(arenaParams.width, 0.04, 0.3)), spawnLineMaterial);
      spawnLine.position.set(0, 0.05, z);
      this.scene.add(spawnLine);
    }
  }

  private spawnSimulationState(): void {
    const stateEntity = new Entity();
    stateEntity.addComponent(new SimulationStateComponent());
    this.world.entityManager.addEntity(stateEntity);
  }

  private spawnUnits(): void {
    for (const teamId of [0, 1] as const) {
      const spawnZ = teamId === 0 ? arenaParams.team1SpawnZ : arenaParams.team2SpawnZ;
      const forwardZ = teamId === 0 ? 1 : -1;
      for (const rosterEntry of UNIT_ROSTER) {
        const x = rosterEntry.offsetX;
        const z = spawnZ + rosterEntry.offsetZ * forwardZ;
        const y = this.getUnitHeightOffset(rosterEntry.kind);
        const renderRefs = this.createUnitRenderRefs(rosterEntry.kind, teamId);
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

  private createUnitRenderRefs(kind: UnitKind, teamId: 0 | 1): {
    root: THREE.Object3D;
    healthBarRoot: THREE.Object3D;
    healthBarFill: THREE.Object3D;
    healthBarFullWidth: number;
  } {
    const root = this.createUnitMesh(kind, teamId);
    const healthBarRoot = new THREE.Group();
    const healthBarFullWidth = 6;
    const background = new THREE.Mesh(
      this.trackGeometry(new THREE.BoxGeometry(healthBarFullWidth, 0.35, 0.25)),
      this.trackMaterial(new THREE.MeshBasicMaterial({ color: 0x1f1f1f })),
    );
    const fill = new THREE.Mesh(
      this.trackGeometry(new THREE.BoxGeometry(healthBarFullWidth, 0.4, 0.3)),
      this.trackMaterial(new THREE.MeshBasicMaterial({ color: teamId === 0 ? arenaParams.team1Color : arenaParams.team2Color })),
    );
    fill.position.z = -0.02;
    healthBarRoot.add(background);
    healthBarRoot.add(fill);
    return { root, healthBarRoot, healthBarFill: fill, healthBarFullWidth };
  }

  private createUnitMesh(kind: UnitKind, teamId: 0 | 1): THREE.Mesh {
    const material = this.trackMaterial(new THREE.MeshStandardMaterial({
      color: teamId === 0 ? arenaParams.team1Color : arenaParams.team2Color,
      roughness: 0.55,
      metalness: 0.05,
    }));
    switch (kind) {
      case 'cube':
        return new THREE.Mesh(this.trackGeometry(new THREE.BoxGeometry(5, 5, 5)), material);
      case 'cone':
        return new THREE.Mesh(this.trackGeometry(new THREE.ConeGeometry(3.2, 7, 24)), material);
      case 'sphere':
        return new THREE.Mesh(this.trackGeometry(new THREE.SphereGeometry(3, 24, 16)), material);
    }
  }

  private getUnitHeightOffset(kind: UnitKind): number {
    switch (kind) {
      case 'cube':
        return 2.5;
      case 'cone':
        return 3.5;
      case 'sphere':
        return 3;
    }
  }

  private linkTransformStore(): void {
    if (this.transformStoreLinked) return;
    const transformStore = this.world.entityManager.getOrCreateSoAStore(TransformSoASchema);
    this.physicsWorld.setTransformStore(transformStore as unknown as SoAComponentStore<SoASchemaDefinition>, {
      fpPositionX: 'fpPositionX',
      fpPositionY: 'fpPositionY',
      fpPositionZ: 'fpPositionZ',
      visualPositionX: 'visualPositionX',
      visualPositionZ: 'visualPositionZ',
    });
    this.transformStoreLinked = true;
  }

  private updateCamera(dt: number): void {
    const safeDt = Math.min(Math.max(dt || 0, 1 / 120), 1 / 15);
    let screenRight = 0;
    let screenForward = 0;
    if (this.pressedKeys.has('arrowup') || this.pressedKeys.has('w')) screenForward += 1;
    if (this.pressedKeys.has('arrowdown') || this.pressedKeys.has('s')) screenForward -= 1;
    if (this.pressedKeys.has('arrowright') || this.pressedKeys.has('d')) screenRight += 1;
    if (this.pressedKeys.has('arrowleft') || this.pressedKeys.has('a')) screenRight -= 1;
    if (screenRight === 0 && screenForward === 0) return;
    const length = Math.hypot(screenRight, screenForward);
    if (length > 1) {
      screenRight /= length;
      screenForward /= length;
    }
    const distance = cameraConfig.moveSpeed * safeDt;
    this.cameraAnchor.x -= screenRight * this.forwardZ * distance;
    this.cameraAnchor.z += screenForward * this.forwardZ * distance;
    this.clampCameraAnchor();
    this.syncCameraToAnchor();
  }

  private syncCameraToAnchor(): void {
    const cameraZ = this.cameraAnchor.z - this.forwardZ * cameraConfig.lookAheadOffset;
    this.camera.position.set(this.cameraAnchor.x, this.cameraHeight, cameraZ);
    this.camera.lookAt(this.cameraAnchor.x, 0, this.cameraAnchor.z);
  }

  private clampCameraAnchor(): void {
    const halfWidth = arenaParams.width / 2 + cameraConfig.boundsPadding;
    const halfLength = arenaParams.length / 2 + cameraConfig.boundsPadding;
    this.cameraAnchor.x = THREE.MathUtils.clamp(this.cameraAnchor.x, -halfWidth, halfWidth);
    this.cameraAnchor.z = THREE.MathUtils.clamp(this.cameraAnchor.z, -halfLength, halfLength);
  }

  private checkGameOver(): void {
    if (this.gameOverShown || this.disposed) return;
    const [stateEntity] = this.world.entityManager.queryEntities(ComponentType.SimulationState);
    const state = stateEntity?.getComponent<SimulationStateComponent>(ComponentType.SimulationState);
    if (!state?.gameOver) return;
    this.gameOverShown = true;
    const title =
      state.winner === null
        ? 'Draw'
        : state.winner === this.localTeamId
          ? 'Victory!'
          : 'Defeat';
    this.showResultOverlay(title);
  }

  private showResultOverlay(title: string): void {
    this.startOverlay.classList.remove('visible');
    const titleEl = document.getElementById('result-title');
    if (titleEl) titleEl.textContent = title;
    this.resultOverlay.classList.add('visible');
  }

  private onStartClick = (): void => {
    this.startOverlay.classList.remove('visible');
    this.client.sendCommand('start-simulation', {});
  };

  private onReturnLobby = (): void => {
    this.dispose();
    this.client.disconnect();
    this.onExit?.();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (this.isCameraKey(key)) {
      event.preventDefault();
      this.pressedKeys.add(key);
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.pressedKeys.delete(event.key.toLowerCase());
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.cameraHeight = THREE.MathUtils.clamp(
      this.cameraHeight + event.deltaY * cameraConfig.zoomSensitivity,
      cameraConfig.minHeight,
      cameraConfig.maxHeight,
    );
    this.syncCameraToAnchor();
  };

  private isCameraKey(key: string): boolean {
    return ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(key);
  }

  private trackGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.disposables.push(geometry);
    return geometry;
  }

  private trackMaterial<T extends THREE.Material>(material: T): T {
    this.disposables.push(material);
    return material;
  }

  private onResize = (): void => {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.world.stop();
    for (const unsubscribe of this.networkEventUnsubscribers) unsubscribe();
    this.networkEventUnsubscribers.length = 0;
    this.startButton.removeEventListener('click', this.onStartClick);
    this.returnLobbyButton.removeEventListener('click', this.onReturnLobby);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.renderer.domElement.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('resize', this.onResize);
    this.startOverlay.classList.remove('visible');
    this.resultOverlay.classList.remove('visible', 'victory', 'defeat');
    this.physicsWorld.dispose();
    this.world.dispose();
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
    this.renderer.dispose();
  }
}