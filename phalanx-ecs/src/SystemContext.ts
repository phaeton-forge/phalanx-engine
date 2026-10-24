import type { EventBus } from './EventBus.js';
import type { EntityManager } from './EntityManager.js';
import type { GameSystem } from './GameSystem.js';

type SystemConstructor = abstract new (...args: never[]) => GameSystem;
import type { GameWorld } from './GameWorld.js';
import { ServiceRegistry, type ServiceKey } from './services.js';
import type { PoolManager } from './pool/PoolManager.js';
import type { IRandom } from './IRandom.js';

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

  /**
   * The world that owns this context. Assigned by `GameWorld` after the
   * registry exists. Systems read it through `GameSystem.world`.
   */
  public world!: GameWorld;

  /** Internal registry of all systems for getSystem() lookup */
  private systemRegistry = new Map<SystemConstructor, GameSystem>();

  private readonly services = new ServiceRegistry();

  /**
   * Entity pool manager for this game world.
   * Wired automatically by GameWorld when pooling is configured.
   * `null` when pooling is disabled.
   */
  public pools: PoolManager | null = null;

  private _random: IRandom | undefined;

  constructor(eventBus: EventBus, entityManager: EntityManager) {
    this.eventBus = eventBus;
    this.entityManager = entityManager;
  }

  /**
   * Match-scoped deterministic RNG.
   * Set by GameWorld from {@link GameWorldConfig.random}; may be set
   * manually in isolated unit tests.
   */
  public set random(r: IRandom) {
    this._random = r;
  }

  public get random(): IRandom {
    if (!this._random) {
      throw new Error(
        'SystemContext.random is not configured: pass GameWorldConfig.random'
      );
    }
    return this._random;
  }

  /**
   * Register `impl` under `key`. Throws when `key`, or another key with the
   * same name, is already provided. Usually called through
   * `GameWorld.provide`.
   */
  public provide<T>(key: ServiceKey<T>, impl: T): void {
    this.services.provide(key, impl);
  }

  /** The service under `key`. Throws with the list of provided names. */
  public getService<T>(key: ServiceKey<T>): T {
    return this.services.get(key);
  }

  /** The service under `key`, or `undefined` when not provided. */
  public tryGetService<T>(key: ServiceKey<T>): T | undefined {
    return this.services.tryGet(key);
  }

  /** Names of provided services, in `provide` order. */
  public serviceNames(): readonly string[] {
    return this.services.names();
  }

  /**
   * Register a system for later retrieval
   * Called by SystemRegistry during system initialization
   */
  public registerSystem(system: GameSystem): void {
    // `constructor` is typed as `Function`. The map key is the class
    // `getSystem` receives.
    this.systemRegistry.set(system.constructor as SystemConstructor, system);
  }

  /**
   * Get a system by its type
   * Usage: context.getSystem(MovementSystem)
   *
   * @param systemClass The system class/constructor
   * @returns The system instance, or undefined if not found
   */
  public getSystem<T extends GameSystem>(
    systemClass: abstract new (...args: never[]) => T
  ): T | undefined {
    return this.systemRegistry.get(systemClass) as T | undefined;
  }
}
