import { Engine, Scene, type Mesh } from '@babylonjs/core';
import { GameWorld, Entity } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import { PhysicsWorld } from '@phalanx-engine/physics';
import { ComponentType } from '../components/index.ts';
import { WaveComponent } from '../components/WaveComponent.ts';
import type { WeaponComponent } from '../components/WeaponComponent.ts';
import type { HealthComponent } from '../components/HealthComponent.ts';
import { EntityFactory } from './EntityFactory.ts';
import { EntityCleanupService } from './EntityCleanupService.ts';
import { GameInitializer } from './GameInitializer.ts';
import { GameRandom } from './GameRandom.ts';
import { InputManager } from './InputManager.ts';
import { HUD } from '../ui/HUD.ts';
import { PlayerInputSystem } from '../systems/PlayerInputSystem.ts';
import { PlayerMovementSystem } from '../systems/PlayerMovementSystem.ts';
import { PlayerAimSystem } from '../systems/PlayerAimSystem.ts';
import { WeaponSystem } from '../systems/WeaponSystem.ts';
import { ProjectileMovementSystem } from '../systems/ProjectileMovementSystem.ts';
import { EnemyAISystem } from '../systems/EnemyAISystem.ts';
import { CombatSystem } from '../systems/CombatSystem.ts';
import { HealthSystem } from '../systems/HealthSystem.ts';
import { PickupSystem } from '../systems/PickupSystem.ts';
import { WaveSystem } from '../systems/WaveSystem.ts';
import { GameStateSystem } from '../systems/GameStateSystem.ts';
import { InterpolationSystem } from '../systems/InterpolationSystem.ts';
import { MeshSyncSystem } from '../systems/MeshSyncSystem.ts';
import { CameraSystem } from '../systems/CameraSystem.ts';
import { VFXSystem } from '../systems/VFXSystem.ts';
import { ScreenShakeSystem } from '../systems/ScreenShakeSystem.ts';
import { TICK_RATE, RANDOM_SEED, ARENA_SIZE, WAVE_INTRO_DELAY_TICKS } from '../config/constants.ts';
import type { EntityTypeComponent } from '../components/EntityTypeComponent.ts';
import { GameEvents, type WeaponFiredEvent } from '../events/GameEvents.ts';

export class Game {
  private engine: Engine;
  private scene: Scene;
  private world: GameWorld;
  private physicsWorld: PhysicsWorld;

  private entityFactory: EntityFactory;
  private entityCleanupService: EntityCleanupService;
  private inputManager: InputManager;
  private meshMap: Map<number, Mesh> = new Map();

  private interpolationSystem: InterpolationSystem;
  private hud: HUD;

  private playerId: number = -1;
  private waveEntityId: number = -1;

  private onResize!: () => void;

  constructor(canvas: HTMLCanvasElement) {
    canvas.oncontextmenu = (e) => { e.preventDefault(); return false; };

    GameRandom.initialize(RANDOM_SEED);

    this.engine = new Engine(canvas, true);
    this.scene = new Scene(this.engine);

    this.world = new GameWorld({
      componentTypes: Object.values(ComponentType),
      tickRate: TICK_RATE,
    });

    this.inputManager = new InputManager(canvas);

    // Physics
    const halfArena = FP.FromFloat(ARENA_SIZE / 2);
    this.physicsWorld = new PhysicsWorld({
      gridCellSize: FP.FromFloat(4),
      subSteps: 1,
      tickRate: TICK_RATE,
      maxVelocity: FP.FromFloat(25),
      pushStrength: FP.FromFloat(10),
      worldBounds: {
        minX: FP.Neg(halfArena),
        minZ: FP.Neg(halfArena),
        maxX: halfArena,
        maxZ: halfArena,
      },
    });

    // Collision filter — walls are visual-only (worldBounds handles containment)
    const entityManager = this.world.entityManager;
    this.physicsWorld.setCollisionFilter((entityIdA: number, entityIdB: number) => {
      const eA = entityManager.getEntity(entityIdA);
      const eB = entityManager.getEntity(entityIdB);
      if (!eA || !eB) return false;

      const typeA = eA.getComponent<EntityTypeComponent>(ComponentType.EntityType);
      const typeB = eB.getComponent<EntityTypeComponent>(ComponentType.EntityType);
      if (!typeA || !typeB) return false;

      const a = typeA.kind;
      const b = typeB.kind;

      // Projectiles don't hit player or other projectiles
      if ((a === 'projectile' && b === 'player') || (a === 'player' && b === 'projectile')) return false;
      if (a === 'projectile' && b === 'projectile') return false;

      // Enemies don't collide with each other
      if (a === 'enemy' && b === 'enemy') return false;

      // Pickups don't collide with enemies, projectiles, or other pickups
      if (a === 'pickup' && (b === 'enemy' || b === 'projectile' || b === 'pickup')) return false;
      if (b === 'pickup' && (a === 'enemy' || a === 'projectile' || a === 'pickup')) return false;

      return true;
    });

    // Entity factory
    this.entityFactory = new EntityFactory(this.scene, this.world.entityManager, this.meshMap);
    this.entityCleanupService = new EntityCleanupService(this.world.entityManager, this.meshMap, this.entityFactory);

    // Systems
    const { physicsSystem } = this.physicsWorld.getSystems();

    const playerInputSystem = new PlayerInputSystem(this.inputManager);
    const playerMovementSystem = new PlayerMovementSystem();
    const playerAimSystem = new PlayerAimSystem(this.inputManager, this.scene);
    const weaponSystem = new WeaponSystem(this.entityFactory);
    const projectileMovementSystem = new ProjectileMovementSystem();
    const enemyAISystem = new EnemyAISystem();
    const combatSystem = new CombatSystem(this.entityFactory);
    const healthSystem = new HealthSystem();
    const pickupSystem = new PickupSystem();
    const waveSystem = new WaveSystem(this.entityFactory);
    const gameStateSystem = new GameStateSystem();

    this.interpolationSystem = new InterpolationSystem();
    const meshSyncSystem = new MeshSyncSystem(this.meshMap);

    // Scene setup (before registerSystems so camera is available for CameraSystem)
    const gameInitializer = new GameInitializer(this.scene);
    const camera = gameInitializer.setupScene();
    const cameraSystem = new CameraSystem(camera, this.meshMap);
    const vfxSystem = new VFXSystem(this.scene);
    const screenShakeSystem = new ScreenShakeSystem();

    const tickSystems = [
      playerInputSystem,
      playerMovementSystem,
      playerAimSystem,
      weaponSystem,
      projectileMovementSystem,
      enemyAISystem,
      physicsSystem,
      combatSystem,
      healthSystem,
      pickupSystem,
      waveSystem,
      gameStateSystem,
    ];

    const frameSystems = [
      this.interpolationSystem,
      meshSyncSystem,
      cameraSystem,
      vfxSystem,
      screenShakeSystem,
    ];

    this.world.registerSystems(tickSystems, frameSystems);

    // Create player
    this.playerId = this.entityFactory.createPlayer();
    waveSystem.setPlayerId(this.playerId);
    cameraSystem.setPlayerId(this.playerId);
    screenShakeSystem.setCamera(camera);

    // Create wave entity (singleton)
    const waveEntity = new Entity();
    const waveComp = new WaveComponent();
    waveComp.state = 'LOADING';
    waveComp.waveTimer = WAVE_INTRO_DELAY_TICKS;
    waveEntity.addComponent(waveComp);
    this.world.entityManager.addEntity(waveEntity);
    this.waveEntityId = waveEntity.id;

    // Babylon GUI HUD
    this.hud = new HUD(this.scene, {
      onStart: () => this.start(),
      onPause: () => {
        this.world.pause();
        // Keep rendering so the pause overlay is visible
        this.engine.runRenderLoop(() => {
          this.scene.render();
        });
      },
      onResume: () => {
        this.engine.stopRenderLoop();
        this.world.resume();
      },
    });

    // Event listeners for particles (death explosions handled by VFXSystem with pooling)
    this.world.eventBus.on<WeaponFiredEvent>(GameEvents.WEAPON_FIRED, (event) => {
      this.entityFactory.createMuzzleFlash(event.originX, event.originZ);
    });

    // Hide the HTML HUD element since we're using Babylon GUI
    const htmlHud = document.getElementById('hud');
    if (htmlHud) htmlHud.style.display = 'none';

    this.setupResizeHandler();
  }

  /** Show the scene with the start screen overlay, without running game ticks. */
  public init(): void {
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });
  }

  public start(): void {
    this.engine.stopRenderLoop();
    this.hud.hideStartScreen();
    this.world.start({
      beforeTick: () => {
        this.interpolationSystem.snapshotPositions();
      },
      afterTick: () => {
        this.interpolationSystem.captureCurrentPositions();
        this.inputManager.endTick();
        this.entityCleanupService.cleanupDestroyedEntities();
      },
      afterFrame: (alpha: number, _dt: number) => {
        this.interpolationSystem.interpolate(alpha);
        this.updatePlayerLight();
        this.updateHUD();
        this.scene.render();
      },
    });
  }

  private updatePlayerLight(): void {
    if (!this.entityFactory.playerLight) return;
    const player = this.world.entityManager.getEntity(this.playerId);
    if (!player) return;
    const interp = player.getComponent<import('../components/InterpolationComponent.ts').InterpolationComponent>(ComponentType.Interpolation);
    if (!interp) return;
    this.entityFactory.playerLight.position.x = interp.visualPosition.x;
    this.entityFactory.playerLight.position.z = interp.visualPosition.z;
    this.entityFactory.playerLight.position.y = 2;
  }

  private updateHUD(): void {
    const waveEntity = this.world.entityManager.getEntity(this.waveEntityId);
    const wave = waveEntity?.getComponent<WaveComponent>(ComponentType.Wave);
    const playerEntity = this.world.entityManager.getEntity(this.playerId);
    const health = playerEntity?.getComponent<HealthComponent>(ComponentType.Health);
    const weapon = playerEntity?.getComponent<WeaponComponent>(ComponentType.Weapon);

    const hp = health?.hp ?? 0;
    const maxHp = health?.maxHp ?? 100;
    const ammo = weapon?.ammo ?? 0;
    const maxAmmo = weapon?.maxAmmo ?? 8;
    const isReloading = weapon?.isReloading ?? false;
    const reloadProgress = isReloading && weapon
      ? 1 - (weapon.reloadTimer / weapon.reloadDuration)
      : 0;
    const currentWave = wave?.currentWave ?? 0;
    const totalWaves = wave?.totalWaves ?? 10;
    const enemiesAlive = wave?.enemiesAlive ?? 0;
    const state = wave?.state ?? 'LOADING';
    const waveTimer = wave?.waveTimer ?? 0;
    const waveTimerSeconds = Math.ceil(waveTimer / TICK_RATE);

    this.hud.update(
      hp, maxHp,
      ammo, maxAmmo,
      isReloading, reloadProgress,
      currentWave, totalWaves,
      enemiesAlive, state,
      waveTimerSeconds,
    );

    if (state === 'GAME_OVER' || state === 'VICTORY') {
      this.world.stop();
    }
  }

  private setupResizeHandler(): void {
    this.onResize = () => {
      this.engine.resize();
    };
    window.addEventListener('resize', this.onResize);
  }

  public dispose(): void {
    this.world.stop();
    this.hud.dispose();
    this.inputManager.dispose();
    window.removeEventListener('resize', this.onResize);
    this.world.dispose();
    this.engine.dispose();
  }
}
