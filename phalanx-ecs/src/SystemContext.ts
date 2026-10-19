import type { EventBus } from './EventBus.js';
import type { EntityManager } from './EntityManager.js';
import type { GameSystem } from './GameSystem.js';

type SystemConstructor = abstract new (...args: never[]) => GameSystem;
import type { GameWorld } from './GameWorld.js';
import type { IAbilitySystem } from './IAbilitySystem.js';
import type { IPhysicsWorld } from './IPhysicsWorld.js';
import type { PoolManager } from './pool/PoolManager.js';
import type { IRandom } from './IRandom.js';

/**
 * Physics installs this on a broadphase owner. Assigning `context.physics`
 * calls it so the package can register its save section without a new export.
 */
const PHYSICS_SAVE_ATTACH = Symbol.for('phalanx.physics.attachSaveSection');

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

  /**
   * The ability system for this game world.
   * Set by `createAbilitySystem()` from phalanx-abilities before
   * `registerSystems()` is called. Undefined in games that don't use
   * phalanx-abilities.
   */
  public abilities: IAbilitySystem | undefined = undefined;

  /**
   * The physics world for this game.
   * Set by game bootstrap code (or a phalanx-physics helper) before
   * `registerSystems()` is called. Undefined in games that don't use
   * phalanx-physics.
   */
  public physics: IPhysicsWorld | undefined = undefined;

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
    this.observePhysicsAssignment();
  }

  /**
   * Keep the public field declaration. The runtime accessor notifies physics
   * when a broadphase owner is assigned, which is not visible on the type.
   */
  private observePhysicsAssignment(): void {
    let current = this.physics;
    Object.defineProperty(this, 'physics', {
      configurable: true,
      enumerable: true,
      get: () => current,
      set: (value: IPhysicsWorld | undefined) => {
        current = value;
        if (value === undefined) return;
        // The symbol is a physics-owned callback, not part of IPhysicsWorld.
        const attach = (value as unknown as Record<symbol, unknown>)[
          PHYSICS_SAVE_ATTACH
        ];
        if (typeof attach !== 'function') return;
        (attach as (world: GameWorld) => void).call(value, this.world);
      },
    });
  }

  /**
   * Match-scoped deterministic RNG.
   * Set by GameWorld from config or the tick provider; may be set manually
   * in isolated unit tests.
   */
  public set random(r: IRandom) {
    this._random = r;
  }

  public get random(): IRandom {
    if (!this._random) {
      throw new Error(
        'SystemContext.random is not configured: pass GameWorldConfig.random or a tickFrameProvider that exposes random'
      );
    }
    return this._random;
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
