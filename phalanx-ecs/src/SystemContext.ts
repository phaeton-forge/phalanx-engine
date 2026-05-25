import type { EventBus } from './EventBus';
import type { EntityManager } from './EntityManager';
import type { GameSystem } from './GameSystem';
import type { IAbilitySystem } from './IAbilitySystem';

/**
 * SystemContext - Shared dependencies container for all game systems
 *
 * This class provides a centralized way to pass common dependencies
 * to systems, reducing constructor parameter counts and making it
 * easier to add new shared services without changing all system signatures.
 *
 * Usage:
 * - Created once in SystemRegistry
 * - Passed to all systems via their constructor
 * - Systems access dependencies via context.eventBus, context.entityManager, etc.
 *
 * Benefits:
 * - Single source of truth for shared services
 * - Easy to extend with new services
 * - Reduces boilerplate in system constructors
 * - Makes testing easier (mock the context)
 */
export class SystemContext {
  /** Central event bus for decoupled communication */
  public readonly eventBus: EventBus;

  /** Entity manager for component queries */
  public readonly entityManager: EntityManager;

  /** Internal registry of all systems for getSystem() lookup */
  private systemRegistry: Map<Function, GameSystem> = new Map();

  /**
   * The ability system for this game world.
   * Set by `createAbilitySystem()` from phalanx-abilities before
   * `registerSystems()` is called. Undefined in games that don't use
   * phalanx-abilities.
   */
  public abilities: IAbilitySystem | undefined = undefined;

  constructor(
    eventBus: EventBus,
    entityManager: EntityManager
  ) {
    this.eventBus = eventBus;
    this.entityManager = entityManager;
  }

  /**
   * Register a system for later retrieval
   * Called by SystemRegistry during system initialization
   */
  public registerSystem(system: GameSystem): void {
    this.systemRegistry.set(system.constructor, system);
  }

  /**
   * Get a system by its type
   * Usage: context.getSystem(MovementSystem)
   *
   * @param systemClass The system class/constructor
   * @returns The system instance, or undefined if not found
   */
  public getSystem<T extends GameSystem>(systemClass: new (...args: any[]) => T): T | undefined {
    return this.systemRegistry.get(systemClass) as T | undefined;
  }
}
