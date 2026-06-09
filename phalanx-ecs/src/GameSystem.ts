import type { SystemContext } from './SystemContext';
import type { EventBus } from './EventBus';
import type { EntityManager } from './EntityManager';
import type { IAbilitySystem } from './IAbilitySystem';
import type { IPhysicsWorld } from './IPhysicsWorld';
import type { PoolManager } from './pool/PoolManager';

/**
 * GameSystem - Abstract base class for all game systems
 *
 * Provides:
 * - Common access to SystemContext dependencies via init()
 * - Convenient event subscription with automatic cleanup
 * - Optional processTick() for deterministic simulation (called from lockstep)
 * - Optional update() for frame-based rendering (called every frame)
 * - Consistent disposal pattern
 *
 * Systems should extend this class and override the methods they need:
 * - init(context: SystemContext) to receive context and set up event listeners
 * - processTick(tick: number) for tick-based deterministic logic
 * - update(deltaTime: number) for frame-based visual updates
 * - dispose() must be implemented (call super.dispose() for auto-cleanup)
 */
export abstract class GameSystem {
  /** Shared system dependencies (assigned in init) */
  protected context!: SystemContext;

  /** Convenience accessor for EventBus */
  protected get eventBus(): EventBus {
    return this.context.eventBus;
  }

  /** Convenience accessor for EntityManager */
  protected get entityManager(): EntityManager {
    return this.context.entityManager;
  }

  /**
   * The ability system for this game world, or undefined if the game does not
   * use phalanx-abilities. Set by `createAbilitySystem()` before systems are
   * registered. The concrete AbilitySystem type from phalanx-abilities
   * satisfies this interface structurally.
   */
  protected get abilities(): IAbilitySystem | undefined {
    return this.context.abilities;
  }

  /**
   * The physics world for this game, or undefined if the game does not
   * use phalanx-physics. Set on SystemContext before systems are registered.
   */
  protected get physics(): IPhysicsWorld | undefined {
    return this.context.physics;
  }

  /**
   * Entity pool manager, or null when pooling is not configured.
   * Wired automatically by GameWorld when pooling is enabled.
   */
  protected get pools(): PoolManager | null {
    return this.context.pools;
  }

  /** Whether this system is enabled */
  public enabled: boolean = true;

  /** Tracked unsubscribe functions for automatic cleanup */
  private unsubscribers: (() => void)[] = [];

  /**
   * Initialize the system (called after all systems are created)
   * Override this method to set up event listeners, subscribe to events, etc.
   * This is called before the game starts, so all systems are available.
   *
   * @param context - System context with access to all dependencies
   */
  public init(context: SystemContext): void {
    this.context = context;
    // Subclasses should call super.init(context) and then set up their logic
  }

  /**
   * Process a simulation tick (deterministic)
   * Override this method for tick-based game logic
   * Called from LockstepManager for synchronized state updates
   *
   * @param _tick - Current simulation tick number
   */
  public processTick(_tick: number): void {
    // Default: no-op. Override in subclasses that need tick processing.
  }

  /**
   * Update for frame rendering (non-deterministic)
   * Override this method for visual updates, animations, interpolation
   * Called every render frame
   *
   * @param _deltaTime - Time elapsed since last frame in seconds
   */
  public update(_deltaTime: number): void {
    // Default: no-op. Override in subclasses that need frame updates.
  }

  /**
   * Subscribe to an event with automatic cleanup on dispose
   * This is a convenience helper that tracks subscriptions
   *
   * @param eventType - The event type to subscribe to
   * @param handler - The callback to invoke when the event is emitted
   * @returns Unsubscribe function (also auto-called on dispose)
   */
  protected subscribe<T>(
    eventType: string,
    handler: (event: T) => void
  ): () => void {
    const unsubscribe = this.eventBus.on<T>(eventType, handler);
    this.unsubscribers.push(unsubscribe);
    return unsubscribe;
  }

  /**
   * Subscribe to an event once with automatic cleanup
   *
   * @param eventType - The event type to subscribe to
   * @param handler - The callback to invoke when the event is emitted
   * @returns Unsubscribe function
   */
  protected subscribeOnce<T>(
    eventType: string,
    handler: (event: T) => void
  ): () => void {
    const unsubscribe = this.eventBus.once<T>(eventType, handler);
    this.unsubscribers.push(unsubscribe);
    return unsubscribe;
  }

  /**
   * Dispose the system and clean up all resources
   * Subclasses should override this and call super.dispose()
   * to ensure all event subscriptions are cleaned up
   */
  public dispose(): void {
    // Clean up all event subscriptions
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
  }
}



