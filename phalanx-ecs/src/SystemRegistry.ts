import { EntityManager } from './EntityManager.js';
import { EventBus } from './EventBus.js';
import { SystemContext } from './SystemContext.js';
import type { GameSystem } from './GameSystem.js';

/**
 * SystemRegistry - Runs the systems {@link GameWorld} has ordered.
 *
 * Registration and phase order live on `GameWorld.addSystem`. This class
 * owns the event bus, the entity manager and the context, and walks the
 * ordered lists.
 */
export class SystemRegistry {
  public readonly eventBus: EventBus;
  public readonly entityManager: EntityManager;
  private readonly context: SystemContext;

  /** Tick systems in phase order. Order matters for determinism. */
  private tickSystems: GameSystem[] = [];

  /** Frame systems in phase order. */
  private frameSystems: GameSystem[] = [];

  /** Every system passed to {@link add}, in registration order. */
  private readonly owned: GameSystem[] = [];

  constructor() {
    this.eventBus = new EventBus();
    this.entityManager = new EntityManager();
    this.context = new SystemContext(this.eventBus, this.entityManager);
  }

  /** Remember `system` so dispose reaches it even before the order is built. */
  public add(system: GameSystem): void {
    this.context.registerSystem(system);
    this.owned.push(system);
  }

  /**
   * Replace the execution lists. {@link GameWorld} calls `init` inside
   * `addSystem`. The low-level path calls {@link init} after this.
   */
  public setOrder(
    tickSystems: readonly GameSystem[],
    frameSystems: readonly GameSystem[]
  ): void {
    this.tickSystems = [...tickSystems];
    this.frameSystems = [...frameSystems];
  }

  /**
   * Call `init` on each ordered system, tick then frame. A system listed
   * in both lanes is initialized once.
   */
  public init(context: SystemContext = this.context): void {
    const seen = new Set<GameSystem>();
    for (const system of [...this.tickSystems, ...this.frameSystems]) {
      if (seen.has(system)) continue;
      seen.add(system);
      system.init(context);
    }
  }

  public orderedTick(): readonly GameSystem[] {
    return this.tickSystems;
  }

  public orderedFrame(): readonly GameSystem[] {
    return this.frameSystems;
  }

  /**
   * Returns a deduplicated set of every ordered system (tick, then frame).
   * Used by GameWorld to collect lifecycle hooks in execution order.
   */
  public getAllSystems(): Set<GameSystem> {
    return new Set([...this.tickSystems, ...this.frameSystems]);
  }

  /**
   * Process all tick-based systems in order.
   * Called once per network tick for deterministic simulation.
   */
  public processAllTicks(tick: number): void {
    for (const system of this.tickSystems) {
      if (system.enabled) {
        system.processTick(tick);
      }
    }
  }

  /**
   * Update all frame-based systems.
   * Called every render frame for visual updates.
   */
  public updateAll(deltaTime: number): void {
    for (const system of this.frameSystems) {
      if (system.enabled) {
        system.update(deltaTime);
      }
    }
  }

  /** Get SystemContext for creating systems. */
  public getContext(): SystemContext {
    return this.context;
  }

  /**
   * Dispose all systems. Ordered systems go tick-reverse then frame-reverse.
   * Anything not yet ordered is disposed in reverse registration order.
   */
  public dispose(): void {
    const seen = new Set<GameSystem>();
    const lists: readonly (readonly GameSystem[])[] =
      this.tickSystems.length === 0 && this.frameSystems.length === 0
        ? [this.owned]
        : [this.tickSystems, this.frameSystems];
    for (const list of lists) {
      for (let i = list.length - 1; i >= 0; i--) {
        const system = list[i];
        if (system === undefined || seen.has(system)) continue;
        seen.add(system);
        system.dispose();
      }
    }
    for (let i = this.owned.length - 1; i >= 0; i--) {
      const system = this.owned[i];
      if (system === undefined || seen.has(system)) continue;
      system.dispose();
    }

    this.eventBus.clearAll();
    this.entityManager.clear();
  }
}
