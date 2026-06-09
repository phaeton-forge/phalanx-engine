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
  // Core dependencies (eagerly initialized in constructor)
  public readonly eventBus: EventBus;
  public readonly entityManager: EntityManager;
  private readonly context: SystemContext;

  /**
   * Ordered list of systems that need tick processing (deterministic simulation)
   * Order matters for determinism!
   */
  private tickSystems: GameSystem[] = [];

  /**
   * Ordered list of systems that need frame updates (visual rendering)
   */
  private frameSystems: GameSystem[] = [];

  constructor(componentTypes?: symbol[]) {
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
      this.context.registerSystem(system);
    }

    // Implicitly append ability tick systems if present in context
    if (this.context.abilities) {
      for (const system of this.context.abilities.tickSystems) {
        this.tickSystems.push(system);
        this.context.registerSystem(system);
      }
    }

    // Initialize all systems (call init() on each).
    // Iterate tickSystems directly so ability tick systems appended above
    // are included alongside the original allSystems.
    const toInit = new Set([...this.tickSystems, ...this.frameSystems]);
    for (const system of toInit) {
      system.init(this.context);
    }
  }

  /**
   * Returns a deduplicated set of every registered system (tick + frame).
   * Used by GameWorld to collect systems that implement lifecycle interfaces.
   */
  public getAllSystems(): Set<GameSystem> {
    return new Set([...this.tickSystems, ...this.frameSystems]);
  }

  /**
   * Add a late-initialized frame system
   * Used for systems that need to be created after initial registration
   * Note: The system's init() must be called before adding
   */
  public addFrameSystem(system: GameSystem): void {
    this.frameSystems.push(system);
    this.context.registerSystem(system);
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
