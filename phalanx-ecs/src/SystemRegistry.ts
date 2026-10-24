import { EntityManager } from './EntityManager.js';
import { EventBus } from './EventBus.js';
import { SystemContext } from './SystemContext.js';
import type { GameSystem } from './GameSystem.js';

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

  private readonly moduleTickSystems: GameSystem[] = [];
  private readonly moduleFrameSystems: GameSystem[] = [];
  private registered = false;

  constructor() {
    // Initialize EventBus first (no dependencies)
    this.eventBus = new EventBus();

    // Initialize EntityManager
    this.entityManager = new EntityManager();

    // Create SystemContext for systems
    this.context = new SystemContext(this.eventBus, this.entityManager);
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
    this.tickSystems = [
      ...this.moduleTickSystems.filter((s) => !tickSystems.includes(s)),
      ...tickSystems,
    ];
    this.frameSystems = [
      ...this.moduleFrameSystems.filter((s) => !frameSystems.includes(s)),
      ...frameSystems,
    ];
    this.registered = true;

    // Register all systems with context for getSystem() lookup
    const allSystems = new Set([...this.tickSystems, ...this.frameSystems]);
    for (const system of allSystems) {
      this.context.registerSystem(system);
    }

    for (const system of allSystems) {
      system.init(this.context);
    }
  }

  /** See `GameWorld.addModuleSystems`. */
  public addModuleSystems(
    tickSystems: readonly GameSystem[],
    frameSystems: readonly GameSystem[]
  ): void {
    if (this.registered) {
      throw new Error(
        'addModuleSystems: call before registerSystems (attach modules first)'
      );
    }
    this.moduleTickSystems.push(...tickSystems);
    this.moduleFrameSystems.push(...frameSystems);
    for (const system of [...tickSystems, ...frameSystems]) {
      this.context.registerSystem(system);
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
