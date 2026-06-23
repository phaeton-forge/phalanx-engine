import { Vector3 } from '@babylonjs/core';
import type { SystemContext, SoAComponentStore } from '@phalanx-engine/ecs';
import { GameSystem } from '@phalanx-engine/ecs';
import type { Unit } from '../entities/Unit';
import { ComponentType, MovementComponent, TransformSoASchema, TransformComponent } from '../components';
import { PhysicsSoASchema, type PhysicsBodyComponent } from '@phalanx-engine/physics';
import { FP } from '@phalanx-engine/math';
import { GameEvents, createEvent } from '../events';
import type {
  MoveStartedEvent,
  MoveCompletedEvent,
  StopRequestedEvent,
} from '../events';

// Pre-computed constants for deterministic physics calculations
const FP_ARRIVAL_THRESHOLD_SQ = FP.FromFloat(0.25); // 0.5^2

/**
 * MovementSystem - Handles entity movement commands and velocity updates
 *
 * Responsibilities:
 * - Set velocities on PhysicsBodyComponent based on movement targets
 * - Check for arrival at targets
 * - Emit movement events
 *
 * Friction is handled per sub-step by PhysicsSystem (phalanx-physics).
 *
 * Runs BEFORE PhysicsSystem in tick order so velocities are set
 * before integration.
 */
export class MovementSystem extends GameSystem {
  private physicsStore!: SoAComponentStore<typeof PhysicsSoASchema.definition>;
  private transformStore!: SoAComponentStore<typeof TransformSoASchema.definition>;
  /**
   * Initialize the system with context
   */
  public override init(context: SystemContext): void {
    super.init(context);
    this.physicsStore = this.entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    this.transformStore = this.entityManager.getOrCreateSoAStore(TransformSoASchema);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // NOTE: We do NOT listen to MOVE_REQUESTED here for lockstep synchronization.
    // Move commands must go through the network and be executed via direct
    // moveEntityTo() calls from Game.ts executeTickCommands().

    // Listen for stop requests
    this.subscribe<StopRequestedEvent>(
      GameEvents.STOP_REQUESTED,
      (event) => {
        this.stopEntity(event.entityId);
      }
    );
  }

  /**
   * Process movement tick:
   * 1. Set velocities on PhysicsBody from movement targets
   * 2. Check for completed movements and emit events
   */
  public override processTick(_tick: number): void {
    this.updateMovementVelocities();
    this.checkArrivals();
  }

  /**
   * Set velocities for entities with active movement targets.
   * Uses direct SoA array access for performance.
   */
  private updateMovementVelocities(): void {
    const physVelocityX = this.physicsStore.arrays.velocityX;
    const physVelocityY = this.physicsStore.arrays.velocityY;
    const physVelocityZ = this.physicsStore.arrays.velocityZ;
    const physIsStatic = this.physicsStore.arrays.isStatic;
    const physIgnorePhysics = this.physicsStore.arrays.ignorePhysics;

    const txFpPositionX = this.transformStore.arrays.fpPositionX;
    const txFpPositionZ = this.transformStore.arrays.fpPositionZ;

    const zeroRaw = FP.ToRaw(FP._0);

    for (const entityId of this.physicsStore.entityIds()) {
      const physIndex = this.physicsStore.indexOf(entityId);

      if (physIsStatic[physIndex] === 1) continue;
      if (physIgnorePhysics[physIndex] === 1) {
        physVelocityX[physIndex] = zeroRaw;
        physVelocityY[physIndex] = zeroRaw;
        physVelocityZ[physIndex] = zeroRaw;
        continue;
      }

      const entity = this.entityManager.getEntity(entityId);
      if (!entity) continue;

      const movement = entity.getComponent<MovementComponent>(ComponentType.Movement);
      if (!movement) continue;

      if (movement.isMoving) {
        const transformIndex = this.transformStore.indexOf(entityId);
        if (transformIndex === -1) continue;

        const target = movement.targetPosition;
        const posX = FP.FromRaw(txFpPositionX[transformIndex]);
        const posZ = FP.FromRaw(txFpPositionZ[transformIndex]);

        const dx = FP.Sub(FP.FromFloat(target.x), posX);
        const dz = FP.Sub(FP.FromFloat(target.z), posZ);
        const distSq = FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz));

        if (FP.Lt(distSq, FP_ARRIVAL_THRESHOLD_SQ)) {
          movement.stop();
          physVelocityX[physIndex] = zeroRaw;
          physVelocityY[physIndex] = zeroRaw;
          physVelocityZ[physIndex] = zeroRaw;
        } else {
          const dist = FP.Sqrt(distSq);
          const speed = FP.FromFloat(movement.speed);
          physVelocityX[physIndex] = FP.ToRaw(FP.Mul(FP.Div(dx, dist), speed));
          physVelocityY[physIndex] = zeroRaw;
          physVelocityZ[physIndex] = FP.ToRaw(FP.Mul(FP.Div(dz, dist), speed));
        }
      } else {
        physVelocityX[physIndex] = zeroRaw;
        physVelocityY[physIndex] = zeroRaw;
        physVelocityZ[physIndex] = zeroRaw;
      }
    }
  }

  /**
   * Check for completed movements and emit arrival events.
   */
  private checkArrivals(): void {
    const movableEntities = this.entityManager.queryEntities(
      ComponentType.Movement
    );

    for (const entity of movableEntities) {
      const movement = entity.getComponent<MovementComponent>(
        ComponentType.Movement
      );
      if (!movement) continue;

      if (movement.hasJustArrived()) {
        movement.acknowledgeArrival();

        const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);

        this.eventBus.emit<MoveCompletedEvent>(GameEvents.MOVE_COMPLETED, {
          ...createEvent(),
          entityId: entity.id,
          position: transform?.visualPosition.clone() ?? new Vector3(),
        });
      }
    }
  }

  /**
   * Command an entity to move to a position
   */
  public moveEntityTo(entityId: number, target: Vector3): boolean {
    const entity = this.entityManager.getEntity(entityId) as Unit | undefined;
    if (!entity) return false;

    // Don't allow entities ignored by physics to move (e.g., dying units)
    const body = entity.getComponent<PhysicsBodyComponent>(ComponentType.PhysicsBody);
    if (body?.ignorePhysics) return false;

    const movement = entity.getComponent<MovementComponent>(
      ComponentType.Movement
    );
    if (!movement) return false;

    const transform = entity.getComponent<TransformComponent>(
      ComponentType.Transform
    );
    if (!transform) return false;

    // Maintain Y position (from visual position)
    const targetWithY = target.clone();
    targetWithY.y = transform.visualPosition.y;

    movement.moveTo(targetWithY);

    // Emit move started event
    this.eventBus.emit<MoveStartedEvent>(GameEvents.MOVE_STARTED, {
      ...createEvent(),
      entityId: entity.id,
      target: targetWithY.clone(),
    });

    return true;
  }

  /**
   * Stop an entity's movement
   */
  public stopEntity(entityId: number): void {
    const entity = this.entityManager.getEntity(entityId);
    const movement = entity?.getComponent<MovementComponent>(
      ComponentType.Movement
    );
    movement?.stop();
  }

  /**
   * Dispose and unsubscribe from all events
   */
  public override dispose(): void {
    super.dispose(); // Clean up subscriptions from base class
  }
}
