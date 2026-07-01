import { GameSystem } from '@phalanx-engine/ecs';
import type {
  SystemContext,
  SoAComponentStore,
  CommandsBatch,
  IBeforeTick,
} from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import {
  PhysicsSystem,
  PhysicsEvents,
  PhysicsSoASchema,
  TransformSoASchema,
} from '@phalanx-engine/physics';
import type { CollisionEvent, BoundsExitEvent } from '@phalanx-engine/physics';
import { ComponentType } from '../components';
import type { CheckerComponent } from '../components';
import {
  STOP_THRESHOLD,
  BOARD_HEIGHT,
  CHECKER_HEIGHT,
} from '../config/constants.ts';
import {
  FLICK_EXECUTED,
  ALL_SETTLED,
  CHECKER_ELIMINATED,
  CHECKER_COLLISION,
} from '../events';
import type {
  FlickExecutedEvent,
  CheckerEliminatedEvent,
  CheckerCollisionEvent,
} from '../events';
import { TeamTag } from '../enums/TeamTag.ts';

type TransformArrays = typeof TransformSoASchema.definition;
type PhysicsArrays = typeof PhysicsSoASchema.definition;

/**
 * PhysicsEventAdapterSystem — bridges the generic @phalanx-engine/physics
 * PhysicsSystem to Chapayev's gameplay events.
 *
 * Registered as a **tick** system, ordered *after* the library PhysicsSystem
 * and *before* GameRulesSystem so that ALL_SETTLED is observed by the rules
 * state machine in the same tick it is emitted.
 *
 * Responsibilities:
 *  - FLICK_EXECUTED → PhysicsSystem.applyImpulse
 *  - PhysicsEvents.COLLISION → CHECKER_COLLISION (with a contact midpoint)
 *  - PhysicsEvents.BOUNDS_EXIT → CHECKER_ELIMINATED (with pre-tick velocity)
 *  - ALL_SETTLED once the simulation comes to rest after a flick
 *
 * The library zeroes velocity before emitting BOUNDS_EXIT, so this system
 * snapshots every body's velocity each tick (IBeforeTick) and uses that
 * snapshot to populate the elimination event's velX/velZ — the fly-off VFX
 * (RapierVFXSystem) depends on those values.
 */
export class PhysicsEventAdapterSystem extends GameSystem implements IBeforeTick {
  private readonly physicsSystem: PhysicsSystem;

  private tStore!: SoAComponentStore<TransformArrays>;
  private pStore!: SoAComponentStore<PhysicsArrays>;

  /** Whether a simulation is in flight (a flick or collision produced motion). */
  private wasSimulating = false;

  /** Pre-tick raw velocity per entity, captured in beforeTick. */
  private readonly preTickVelocity = new Map<number, { vx: bigint; vz: bigint }>();

  private readonly fpStopThreshold = FP.FromFloat(STOP_THRESHOLD);
  private readonly elimY = BOARD_HEIGHT / 2 + CHECKER_HEIGHT / 2;
  private readonly collisionY = BOARD_HEIGHT / 2 + CHECKER_HEIGHT / 2;

  constructor(physicsSystem: PhysicsSystem) {
    super();
    this.physicsSystem = physicsSystem;
  }

  public override init(context: SystemContext): void {
    super.init(context);

    this.tStore = this.entityManager.getOrCreateSoAStore(TransformSoASchema);
    this.pStore = this.entityManager.getOrCreateSoAStore(PhysicsSoASchema);

    this.subscribe<FlickExecutedEvent>(FLICK_EXECUTED, (e) => this.onFlickExecuted(e));
    this.subscribe<CollisionEvent>(PhysicsEvents.COLLISION, (e) => this.onCollision(e));
    this.subscribe<BoundsExitEvent>(PhysicsEvents.BOUNDS_EXIT, (e) => this.onBoundsExit(e));
  }

  /** Capture each body's velocity before the physics step runs this tick. */
  public beforeTick(_tick: number, _commands: CommandsBatch): void {
    this.preTickVelocity.clear();
    const vx = this.pStore.arrays.velocityX;
    const vz = this.pStore.arrays.velocityZ;
    for (const entityId of this.pStore.entityIds()) {
      const pi = this.pStore.indexOf(entityId);
      this.preTickVelocity.set(entityId, { vx: vx[pi], vz: vz[pi] });
    }
  }

  private onFlickExecuted(event: FlickExecutedEvent): void {
    const entity = this.entityManager.getEntity(event.entityId);
    const checker = entity?.getComponent<CheckerComponent>(ComponentType.Checker);
    if (!checker || !checker.isAlive) return;

    const vx = FP.Mul(event.directionX, event.force);
    const vz = FP.Mul(event.directionZ, event.force);
    this.physicsSystem.applyImpulse(event.entityId, vx, vz);

    this.wasSimulating = true;
  }

  private onCollision(event: CollisionEvent): void {
    const tiA = this.tStore.indexOf(event.entityA);
    const tiB = this.tStore.indexOf(event.entityB);
    if (tiA === -1 || tiB === -1) return;

    const posX = this.tStore.arrays.fpPositionX;
    const posZ = this.tStore.arrays.fpPositionZ;

    const midX = FP.ToFloat(FP.FromRaw(posX[tiA])) + FP.ToFloat(FP.FromRaw(posX[tiB]));
    const midZ = FP.ToFloat(FP.FromRaw(posZ[tiA])) + FP.ToFloat(FP.FromRaw(posZ[tiB]));

    this.eventBus.emit<CheckerCollisionEvent>(CHECKER_COLLISION, {
      x: midX / 2,
      y: this.collisionY,
      z: midZ / 2,
      entityA: event.entityA,
      entityB: event.entityB,
    });
  }

  private onBoundsExit(event: BoundsExitEvent): void {
    const entityId = event.entityId;
    const ti = this.tStore.indexOf(entityId);
    if (ti === -1) return;

    const posX = FP.ToFloat(FP.FromRaw(this.tStore.arrays.fpPositionX[ti]));
    const posZ = FP.ToFloat(FP.FromRaw(this.tStore.arrays.fpPositionZ[ti]));

    const snapshot = this.preTickVelocity.get(entityId);
    const velX = snapshot ? FP.ToFloat(FP.FromRaw(snapshot.vx)) : 0;
    const velZ = snapshot ? FP.ToFloat(FP.FromRaw(snapshot.vz)) : 0;

    const entity = this.entityManager.getEntity(entityId);
    const checker = entity?.getComponent<CheckerComponent>(ComponentType.Checker);
    if (checker) {
      checker.isAlive = false;
    }
    const team = checker?.team ?? TeamTag.White;

    this.eventBus.emit<CheckerEliminatedEvent>(CHECKER_ELIMINATED, {
      entityId,
      team,
      posX,
      posY: this.elimY,
      posZ,
      velX,
      velZ,
    });
  }

  public override processTick(_tick: number): void {
    if (this.wasSimulating && this.physicsSystem.isSettled(this.fpStopThreshold)) {
      this.wasSimulating = false;
      this.eventBus.emit(ALL_SETTLED, {});
    }
  }

  public override dispose(): void {
    super.dispose();
    this.preTickVelocity.clear();
  }
}
