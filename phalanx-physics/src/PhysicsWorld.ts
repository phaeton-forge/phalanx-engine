import { type EventBus, type SoAComponentStore } from 'phalanx-ecs';
import type { SoASchemaDefinition } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import { PhysicsSystem } from './systems/PhysicsSystem';
import { SpatialHashGrid } from './collision/SpatialHashGrid';
import { PhysicsEvents } from './events';
import type { PhysicsWorldConfig } from './PhysicsWorldConfig';
import type { FixedPoint } from 'phalanx-math';
import type { TransformFieldMapping, CollisionEvent, PhysicsConfig, BoundsExitEvent } from './types';

/**
 * PhysicsWorld — high-level facade that wires PhysicsSystem.
 *
 * Consumers create a PhysicsWorld, get the system from getSystems(),
 * register it with GameWorld, and then link their TransformComponent store
 * via setTransformStore().
 */
export class PhysicsWorld {
  private readonly physicsSystem: PhysicsSystem;
  private eventBusRef: EventBus | null = null;
  private readonly unsubscribers: (() => void)[] = [];
  private readonly settleThreshold: FixedPoint | undefined;

  constructor(config?: PhysicsWorldConfig) {
    const tickRate = config?.tickRate ?? 20;
    const subSteps = config?.subSteps ?? 3;
    const tickDt = FP.FromFloat(1 / tickRate);
    const gridCellSize = config?.gridCellSize ?? FP.FromFloat(4);
    const maxVelocity = config?.maxVelocity ?? FP.FromFloat(15.0);
    const pushStrength = config?.pushStrength ?? FP.FromFloat(15.0);
    const defaultFriction = config?.defaultFriction ?? FP.FromFloat(0.92);

    const physicsConfig: PhysicsConfig = {
      tickDt,
      subSteps,
      maxVelocity,
      defaultFriction,
      pushStrength,
      gridCellSize,
      worldBounds: config?.worldBounds,
      ejectOnBoundsExit: config?.ejectOnBoundsExit,
    };

    this.physicsSystem = new PhysicsSystem(physicsConfig);
    this.settleThreshold = config?.settleThreshold;

    if (config?.tickProvider) {
      this.physicsSystem.setTickProvider(config.tickProvider);
    }
  }

  /**
   * Returns the physics system to register with GameWorld.
   */
  public getSystems(): { physicsSystem: PhysicsSystem } {
    return {
      physicsSystem: this.physicsSystem,
    };
  }

  /**
   * Set an optional collision filter. Return false to skip a pair.
   * Useful for game-specific rules like team-based collision filtering.
   */
  public setCollisionFilter(filter: (entityA: number, entityB: number) => boolean): void {
    this.physicsSystem.setCollisionFilter(filter);
  }

  /**
   * Link the consumer's TransformComponent SoA store.
   */
  public setTransformStore(
    store: SoAComponentStore<SoASchemaDefinition>,
    fieldMapping: TransformFieldMapping
  ): void {
    this.physicsSystem.setTransformStore(store, fieldMapping);
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

  /** Apply a velocity impulse to a body ("flick" mechanic). Replaces existing velocity. */
  public applyImpulse(entityId: number, vx: FixedPoint, vz: FixedPoint): void {
    this.physicsSystem.applyImpulse(entityId, vx, vz);
  }

  /**
   * Returns true when all non-static bodies are below the velocity threshold.
   * Pure query — game code decides what to do with the result.
   */
  public isSettled(threshold?: FixedPoint): boolean {
    return this.physicsSystem.isSettled(threshold ?? this.settleThreshold);
  }

  /** Subscribe to BOUNDS_EXIT. Fires when a body exits worldBounds in eject mode. */
  public onBoundsExit(callback: (event: BoundsExitEvent) => void): () => void {
    const eb = this.getEventBus();
    if (!eb) throw new Error('PhysicsWorld: Cannot subscribe before systems are initialized');
    const unsub = eb.on<BoundsExitEvent>(PhysicsEvents.BOUNDS_EXIT, callback);
    this.unsubscribers.push(unsub);
    return unsub;
  }

  /** Direct access to the spatial grid for custom queries (e.g. range finding) */
  public get spatialGrid(): SpatialHashGrid {
    return this.physicsSystem.getSpatialGrid();
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
    try {
      this.eventBusRef = this.physicsSystem.getEventBus() ?? null;
    } catch {
      return null;
    }
    return this.eventBusRef;
  }
}
