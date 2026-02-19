import { Engine, Scene } from '@babylonjs/core';
import { EntityManager } from './EntityManager';
import { EventBus } from './EventBus';
import { SystemContext } from './SystemContext';
import type { GameSystem } from './GameSystem';

/**
 * SystemRegistry - Manages game systems lifecycle
 *
 * Responsible for:
 * - Creating core dependencies (EventBus, EntityManager, SystemContext)
 * - Registering systems and calling their init() methods
 * - Processing tick and frame updates for all systems
 */
export class SystemRegistry {
  private engine: Engine;
  private scene: Scene;

  // Core dependencies
  public eventBus!: EventBus;
  public entityManager!: EntityManager;
  private context: SystemContext | null = null;

  /**
   * Ordered list of systems that need tick processing (deterministic simulation)
   * Order matters for determinism!
   */
  private tickSystems: GameSystem[] = [];

  /**
   * Ordered list of systems that need frame updates (visual rendering)
   */
  private frameSystems: GameSystem[] = [];

  constructor(engine: Engine, scene: Scene) {
    this.engine = engine;
    this.scene = scene;
  }

  /**
   * Create core dependencies (EventBus, EntityManager, SystemContext)
   * @param componentTypes - Optional array of component type symbols for EntityManager indexing
   */
  public createCoreDependencies(componentTypes?: symbol[]): void {
    // Initialize EventBus first (no dependencies)
    this.eventBus = new EventBus();

    // Initialize EntityManager
    this.entityManager = new EntityManager();

    // Register component types for efficient queries (if provided)
    if (componentTypes) {
      this.entityManager.registerComponentTypes(componentTypes);
    }

    // Create SystemContext for systems
    this.context = new SystemContext(
      this.engine,
      this.scene,
      this.eventBus,
      this.entityManager
    );
  }

  /**
   * Register systems and initialize them
   * @param tickSystems - Systems that need deterministic tick processing (order matters!)
   * @param frameSystems - Systems that need frame-based visual updates
   */
  public registerSystems(
    tickSystems: GameSystem[],
    frameSystems: GameSystem[]
  ): void {
    // Store system lists
    this.tickSystems = tickSystems;
    this.frameSystems = frameSystems;

    // Register all systems with context for getSystem() lookup
    const allSystems = new Set([...tickSystems, ...frameSystems]);
    for (const system of allSystems) {
      this.context!.registerSystem(system);
    }

    // Initialize all systems (call init() on each)
    for (const system of allSystems) {
      system.init(this.context!);
    }
  }

  /**
   * Add a late-initialized frame system
   * Used for systems that need to be created after initial registration
   * Note: The system's init() must be called before adding
   */
  public addFrameSystem(system: GameSystem): void {
    this.frameSystems.push(system);
    this.context!.registerSystem(system);
  }


  /**
   * Process all tick-based systems in order
   * Called once per network tick for deterministic simulation
   * @param tick Current simulation tick number
   */
  public processAllTicks(tick: number): void {
    for (const system of this.tickSystems) {
      if (system.enabled) {
        system.processTick(tick);
      }
    }
  }

  /**
   * Update all frame-based systems
   * Called every render frame for visual updates
   * @param deltaTime Time elapsed since last frame in seconds
   */
  public updateAll(deltaTime: number): void {
    for (const system of this.frameSystems) {
      if (system.enabled) {
        system.update(deltaTime);
      }
    }
  }

  /**
   * Get SystemContext for creating systems
   */
  public getContext(): SystemContext {
    if (!this.context) {
      throw new Error('SystemContext not created. Call createCoreDependencies() first.');
    }
    return this.context;
  }

  /**
   * Dispose all systems
   */
  public dispose(): void {
    // Dispose all tick systems in reverse order
    for (let i = this.tickSystems.length - 1; i >= 0; i--) {
      this.tickSystems[i].dispose();
    }

    // Dispose all frame systems in reverse order
    for (let i = this.frameSystems.length - 1; i >= 0; i--) {
      this.frameSystems[i].dispose();
    }

    // Clear core
    this.eventBus?.clearAll();
    this.entityManager?.clear();
  }
}

