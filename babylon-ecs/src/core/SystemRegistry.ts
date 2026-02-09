import { Engine, Scene } from '@babylonjs/core';
import { EntityManager } from './EntityManager';
import { EventBus } from './EventBus';
import { SelectionSystem } from '../systems/SelectionSystem';
import { MovementSystem } from '../systems/MovementSystem';
import { PhysicsSystem } from '../systems/PhysicsSystem';
import { HealthSystem } from '../systems/HealthSystem';
import { ProjectileSystem } from '../systems/ProjectileSystem';
import { CombatSystem } from '../systems/CombatSystem';
import { ResourceSystem } from '../systems/ResourceSystem';
import { TerritorySystem } from '../systems/TerritorySystem';
import { FormationGridSystem } from '../systems/FormationGridSystem';
import { VictorySystem } from '../systems/VictorySystem';
import { WaveSystem } from '../systems/WaveSystem';
import { InterpolationSystem } from '../systems/InterpolationSystem';
import { AnimationSystem } from '../systems/AnimationSystem';
import { RotationSystem } from '../systems/RotationSystem';
import { HealthBarSystem } from '../systems/HealthBarSystem';
import { CameraController } from '../systems/CameraController';
import { InputManager } from '../systems/InputManager';
import { SceneManager } from './SceneManager';
import { TeamTag } from '../enums/TeamTag';

/**
 * All game systems in one place
 */
export interface GameSystems {
  // Core
  eventBus: EventBus;
  entityManager: EntityManager;
  sceneManager: SceneManager;

  // Gameplay systems
  selectionSystem: SelectionSystem;
  movementSystem: MovementSystem;
  physicsSystem: PhysicsSystem;
  healthSystem: HealthSystem;
  projectileSystem: ProjectileSystem;
  combatSystem: CombatSystem;
  resourceSystem: ResourceSystem;
  territorySystem: TerritorySystem;
  formationGridSystem: FormationGridSystem;
  victorySystem: VictorySystem;
  waveSystem: WaveSystem;

  // Visual systems
  interpolationSystem: InterpolationSystem;
  animationSystem: AnimationSystem;
  rotationSystem: RotationSystem;
  healthBarSystem: HealthBarSystem;

  // Input/Camera
  cameraController: CameraController;
  inputManager: InputManager;
}

/**
 * SystemRegistry - Creates and wires all game systems
 *
 * Responsible for:
 * - Instantiating all systems with correct dependencies
 * - Wiring inter-system callbacks
 * - Providing access to all systems
 */
export class SystemRegistry {
  private systems: Partial<GameSystems> = {};
  private engine: Engine;
  private scene: Scene;

  constructor(engine: Engine, scene: Scene) {
    this.engine = engine;
    this.scene = scene;
  }

  /**
   * Create all core systems (called in constructor phase)
   */
  public createCoreSystems(): void {
    // Initialize EventBus first (no dependencies)
    this.systems.eventBus = new EventBus();

    // Initialize EntityManager
    this.systems.entityManager = new EntityManager();

    // Initialize scene manager (with EventBus for destination marker events)
    this.systems.sceneManager = new SceneManager(
      this.scene,
      this.systems.eventBus
    );

    // Initialize systems with EventBus for decoupled communication
    this.systems.selectionSystem = new SelectionSystem(
      this.systems.entityManager,
      this.systems.eventBus
    );

    this.systems.movementSystem = new MovementSystem(
      this.engine,
      this.systems.entityManager,
      this.systems.eventBus
    );

    this.systems.physicsSystem = new PhysicsSystem(
      this.systems.entityManager,
      this.systems.eventBus
    );

    this.systems.healthSystem = new HealthSystem(
      this.systems.entityManager,
      this.systems.eventBus
    );

    this.systems.projectileSystem = new ProjectileSystem(
      this.scene,
      this.engine,
      this.systems.entityManager,
      this.systems.eventBus
    );

    this.systems.combatSystem = new CombatSystem(
      this.engine,
      this.systems.entityManager,
      this.systems.eventBus
    );

    // Initialize animation systems
    this.systems.animationSystem = new AnimationSystem(
      this.systems.entityManager,
      this.scene
    );
    this.systems.rotationSystem = new RotationSystem(this.systems.entityManager);

    // Initialize gameplay systems
    this.systems.resourceSystem = new ResourceSystem(
      this.engine,
      this.systems.entityManager,
      this.systems.eventBus
    );

    this.systems.territorySystem = new TerritorySystem(
      this.systems.entityManager,
      this.systems.eventBus
    );

    this.systems.formationGridSystem = new FormationGridSystem(
      this.scene,
      this.systems.entityManager,
      this.systems.eventBus
    );

    this.systems.victorySystem = new VictorySystem(
      this.systems.entityManager,
      this.systems.eventBus
    );

    this.systems.waveSystem = new WaveSystem(this.systems.eventBus);

    this.systems.interpolationSystem = new InterpolationSystem(
      this.systems.entityManager
    );

    this.systems.inputManager = new InputManager(
      this.scene,
      this.systems.eventBus,
      this.systems.selectionSystem,
      this.systems.sceneManager
    );
  }

  /**
   * Wire inter-system callbacks
   */
  public wireSystemCallbacks(): void {
    const {
      combatSystem,
      movementSystem,
      animationSystem,
      healthSystem,
    } = this.systems;

    // Set up combat system move callback for lockstep synchronization
    combatSystem!.setMoveUnitCallback((entityId, target) => {
      movementSystem!.moveEntityTo(entityId, target);
    });

    // Wire up animation system to combat system
    combatSystem!.setAnimationSystem(animationSystem!);

    // Wire up animation system to health system for death sequences
    healthSystem!.setAnimationSystem(animationSystem!);
  }

  /**
   * Create late-initialized systems (need async initialization first)
   */
  public createLateSystems(localTeam: TeamTag): void {
    // Initialize RTS-style camera controller for the local player
    this.systems.cameraController = new CameraController(this.scene, localTeam);

    // Initialize health bar system (uses GUI with automatic billboarding)
    this.systems.healthBarSystem = new HealthBarSystem(
      this.scene,
      this.systems.entityManager!,
      this.systems.eventBus!
    );
  }

  /**
   * Get all systems
   */
  public getSystems(): GameSystems {
    return this.systems as GameSystems;
  }

  /**
   * Dispose all systems
   */
  public dispose(): void {
    const s = this.systems;

    // Dispose in reverse order of dependencies
    s.cameraController?.dispose();
    s.inputManager?.dispose();
    s.projectileSystem?.dispose();
    s.combatSystem?.dispose();
    s.healthSystem?.dispose();
    s.physicsSystem?.dispose();
    s.movementSystem?.dispose();
    s.selectionSystem?.dispose();
    s.sceneManager?.dispose();
    s.resourceSystem?.dispose();
    s.territorySystem?.dispose();
    s.formationGridSystem?.dispose();
    s.victorySystem?.dispose();
    s.waveSystem?.dispose();
    s.interpolationSystem?.dispose();
    s.healthBarSystem?.dispose();

    // Clear core
    s.eventBus?.clearAll();
    s.entityManager?.clear();
  }
}

