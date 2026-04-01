import { type EventBus, type SoAComponentStore } from 'phalanx-ecs';
import type { SoASchemaDefinition } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import { PhysicsSystem } from './systems/PhysicsSystem';
import { CollisionSystem } from './systems/CollisionSystem';
import { SpatialHashGrid } from './collision/SpatialHashGrid';
import { PhysicsEvents } from './events';
import type { PhysicsWorldConfig } from './PhysicsWorldConfig';
import type { TransformFieldMapping, CollisionEvent, PhysicsConfig } from './types';

/**
 * PhysicsWorld — high-level facade that wires PhysicsSystem + CollisionSystem.
 *
 * Consumers create a PhysicsWorld, get the two systems from getSystems(),
 * register them with GameWorld, and then link their TransformComponent store
 * via setTransformStore().
 */
export class PhysicsWorld {
  private readonly physicsSystem: PhysicsSystem;
  private readonly collisionSystem: CollisionSystem;
  private eventBusRef: EventBus | null = null;
  private readonly unsubscribers: (() => void)[] = [];

  constructor(config?: PhysicsWorldConfig) {
    const tickRate = config?.tickRate ?? 20;
    const subSteps = config?.subSteps ?? 3;
    const tickDt = FP.FromFloat(1 / tickRate);
    const gridCellSize = config?.gridCellSize ?? FP.FromFloat(4);
    const maxVelocity = config?.maxVelocity ?? FP.FromFloat(15.0);
    const pushStrength = config?.pushStrength ?? FP.FromFloat(15.0);

    const physicsConfig: PhysicsConfig = {
      tickDt,
      subSteps,
      maxVelocity,
      worldBounds: config?.worldBounds,
    };

    this.physicsSystem = new PhysicsSystem(physicsConfig);
    this.collisionSystem = new CollisionSystem(gridCellSize, pushStrength);
  }

  /**
   * Returns the two systems to register with GameWorld.
   * PhysicsSystem should run before CollisionSystem in tick system order.
   */
  public getSystems(): { physicsSystem: PhysicsSystem; collisionSystem: CollisionSystem } {
    return {
      physicsSystem: this.physicsSystem,
      collisionSystem: this.collisionSystem,
    };
  }

  /**
   * Link the consumer's TransformComponent SoA store to both systems.
   */
  public setTransformStore(
    store: SoAComponentStore<SoASchemaDefinition>,
    fieldMapping: TransformFieldMapping
  ): void {
    this.physicsSystem.setTransformStore(store, fieldMapping);
    this.collisionSystem.setTransformStore(store, fieldMapping);
  }

  /**
   * Subscribe to collision events.
   * Returns an unsubscribe function.
   * Must be called after systems are initialized (after GameWorld.start()).
   */
  public onCollision(callback: (event: CollisionEvent) => void): () => void {
    const eb = this.getEventBus();
    if (!eb) {
      throw new Error('PhysicsWorld: Cannot subscribe before systems are initialized');
    }
    const unsub = eb.on<CollisionEvent>(PhysicsEvents.COLLISION, callback);
    this.unsubscribers.push(unsub);
    return unsub;
  }

  /**
   * Subscribe to trigger enter events.
   */
  public onTriggerEnter(callback: (event: CollisionEvent) => void): () => void {
    const eb = this.getEventBus();
    if (!eb) {
      throw new Error('PhysicsWorld: Cannot subscribe before systems are initialized');
    }
    const unsub = eb.on<CollisionEvent>(PhysicsEvents.TRIGGER_ENTER, callback);
    this.unsubscribers.push(unsub);
    return unsub;
  }

  /**
   * Subscribe to trigger exit events.
   */
  public onTriggerExit(callback: (event: CollisionEvent) => void): () => void {
    const eb = this.getEventBus();
    if (!eb) {
      throw new Error('PhysicsWorld: Cannot subscribe before systems are initialized');
    }
    const unsub = eb.on<CollisionEvent>(PhysicsEvents.TRIGGER_EXIT, callback);
    this.unsubscribers.push(unsub);
    return unsub;
  }

  /** Direct access to the spatial grid for custom queries (e.g. range finding) */
  public get spatialGrid(): SpatialHashGrid {
    return this.collisionSystem.getSpatialGrid();
  }

  /** Clean up all subscriptions and system resources */
  public dispose(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers.length = 0;
  }

  private getEventBus(): EventBus | null {
    if (this.eventBusRef) return this.eventBusRef;
    // Try to access from the system's context (set after init)
    try {
      this.eventBusRef = (this.physicsSystem as unknown as { context: { eventBus: EventBus } }).context?.eventBus ?? null;
    } catch {
      return null;
    }
    return this.eventBusRef;
  }
}
