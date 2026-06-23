import { GameSystem } from '@phalanx-engine/ecs';
import type { SystemContext, SoAComponentStore } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import type { FixedPoint } from '@phalanx-engine/math';
import { TransformSoASchema } from '../components';
import { PhysicsBodySoASchema } from '../components';
import { ComponentType } from '../components';
import type { CheckerComponent } from '../components';
import {
  PHYSICS_DT,
  STOP_THRESHOLD,
  RESTITUTION,
  BOARD_ELIM_HALF_EXTENT,
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

type TransformArrays = typeof TransformSoASchema.definition;
type PhysicsArrays = typeof PhysicsBodySoASchema.definition;

/**
 * PhysicsSystem — deterministic 2D physics for Chapayev checkers.
 *
 * Registered as a **tick** system. Runs each simulation tick with a fixed dt.
 * All arithmetic uses FixedPoint (FP) for cross-platform determinism.
 *
 * Pipeline per tick:
 *  1. Apply friction
 *  2. Integrate positions
 *  3. Resolve checker-checker collisions (elastic circles)
 *  4. Boundary elimination check
 *  5. Detect all-settled state
 */
export class PhysicsSystem extends GameSystem {
  // ── Pre-computed FP constants ──────────────────────────────────
  private readonly fpDt: FixedPoint = FP.FromFloat(PHYSICS_DT);
  private readonly fpStopThreshold: FixedPoint = FP.FromFloat(STOP_THRESHOLD);
  private readonly fpBoardHalf: FixedPoint = FP.FromFloat(BOARD_ELIM_HALF_EXTENT);
  private readonly fpNegBoardHalf: FixedPoint = FP.Neg(FP.FromFloat(BOARD_ELIM_HALF_EXTENT));
  private readonly fpHalf: FixedPoint = FP.FromFloat(0.5);
  private readonly fpOnePlusRestitution: FixedPoint = FP.Add(FP._1, FP.FromFloat(RESTITUTION));

  /** Whether *any* checker was moving last tick (used for ALL_SETTLED detection) */
  private wasSimulating = false;

  // SoA store references (resolved in init)
  private tStore!: SoAComponentStore<TransformArrays>;
  private pStore!: SoAComponentStore<PhysicsArrays>;

  // ── Lifecycle ──────────────────────────────────────────────────

  public override init(context: SystemContext): void {
    super.init(context);

    // Resolve SoA stores (created by components during entity construction)
    this.tStore = this.entityManager.getOrCreateSoAStore(TransformSoASchema);
    this.pStore = this.entityManager.getOrCreateSoAStore(PhysicsBodySoASchema);

    // Listen for flick events to apply initial impulse
    this.subscribe<FlickExecutedEvent>(FLICK_EXECUTED, (e) => this.onFlickExecuted(e));
  }

  // ── Flick impulse ──────────────────────────────────────────────

  private onFlickExecuted(event: FlickExecutedEvent): void {
    const pi = this.pStore.indexOf(event.entityId);
    if (pi === -1) return;
    if (this.pStore.arrays.isAlive[pi] === 0) return;

    // Impulse = direction * force
    const vx = FP.Mul(event.directionX, event.force);
    const vz = FP.Mul(event.directionZ, event.force);

    this.pStore.arrays.velocityX[pi] = FP.ToRaw(vx);
    this.pStore.arrays.velocityZ[pi] = FP.ToRaw(vz);
    this.pStore.arrays.isMoving[pi] = 1;

    this.wasSimulating = true;
  }

  // ── Tick processing ────────────────────────────────────────────

  public override processTick(_tick: number): void {
    const pArr = this.pStore.arrays;
    const tArr = this.tStore.arrays;
    const entityIds = this.pStore.entityIds();
    const dt = this.fpDt;

    let anyMoving = false;

    // ──── Step 1: Friction ────────────────────────────────────────
    for (const eid of entityIds) {
      const pi = this.pStore.indexOf(eid);
      if (pArr.isAlive[pi] === 0 || pArr.isMoving[pi] === 0) continue;

      const vx = FP.FromRaw(pArr.velocityX[pi]);
      const vz = FP.FromRaw(pArr.velocityZ[pi]);
      const friction = FP.FromRaw(pArr.friction[pi]);

      const speedSq = FP.Add(FP.Mul(vx, vx), FP.Mul(vz, vz));
      const speed = FP.Sqrt(speedSq);

      if (FP.Lte(speed, this.fpStopThreshold)) {
        pArr.velocityX[pi] = 0n;
        pArr.velocityZ[pi] = 0n;
        pArr.isMoving[pi] = 0;
        continue;
      }

      // factor = max(0, 1 - friction * dt)
      const dampFactor = FP.Max(FP._0, FP.Sub(FP._1, FP.Mul(friction, dt)));
      pArr.velocityX[pi] = FP.ToRaw(FP.Mul(vx, dampFactor));
      pArr.velocityZ[pi] = FP.ToRaw(FP.Mul(vz, dampFactor));

      anyMoving = true;
    }

    // ──── Step 2: Integrate positions ─────────────────────────────
    for (const eid of entityIds) {
      const pi = this.pStore.indexOf(eid);
      if (pArr.isAlive[pi] === 0 || pArr.isMoving[pi] === 0) continue;

      const ti = this.tStore.indexOf(eid);
      if (ti === -1) continue;

      const vx = FP.FromRaw(pArr.velocityX[pi]);
      const vz = FP.FromRaw(pArr.velocityZ[pi]);
      const px = FP.FromRaw(tArr.fpPositionX[ti]);
      const pz = FP.FromRaw(tArr.fpPositionZ[ti]);

      const newPx = FP.Add(px, FP.Mul(vx, dt));
      const newPz = FP.Add(pz, FP.Mul(vz, dt));

      tArr.fpPositionX[ti] = FP.ToRaw(newPx);
      tArr.fpPositionZ[ti] = FP.ToRaw(newPz);

      // Sync visual position
      tArr.visualPositionX[ti] = FP.ToFloat(newPx);
      tArr.visualPositionZ[ti] = FP.ToFloat(newPz);
    }

    // ──── Step 3: Checker↔Checker collisions ──────────────────────
    const aliveIds: number[] = [];
    for (const eid of entityIds) {
      const pi = this.pStore.indexOf(eid);
      if (pArr.isAlive[pi] === 1) {
        aliveIds.push(eid);
      }
    }

    for (let a = 0; a < aliveIds.length; a++) {
      for (let b = a + 1; b < aliveIds.length; b++) {
        this.resolveCollision(aliveIds[a], aliveIds[b]);
      }
    }

    // ──── Step 4: Boundary elimination ────────────────────────────
    for (const eid of entityIds) {
      const pi = this.pStore.indexOf(eid);
      if (pArr.isAlive[pi] === 0) continue;

      const ti = this.tStore.indexOf(eid);
      if (ti === -1) continue;

      const px = FP.FromRaw(tArr.fpPositionX[ti]);
      const pz = FP.FromRaw(tArr.fpPositionZ[ti]);

      if (
        FP.Gt(px, this.fpBoardHalf) ||
        FP.Lt(px, this.fpNegBoardHalf) ||
        FP.Gt(pz, this.fpBoardHalf) ||
        FP.Lt(pz, this.fpNegBoardHalf)
      ) {
        this.eliminateChecker(eid, pi, ti);
      }
    }

    // ──── Step 5: All-settled detection ───────────────────────────
    // Re-check if any are still moving after collisions/elimination
    if (!anyMoving) {
      // Double-check all entities
      for (const eid of entityIds) {
        const pi = this.pStore.indexOf(eid);
        if (pArr.isAlive[pi] === 1 && pArr.isMoving[pi] === 1) {
          anyMoving = true;
          break;
        }
      }
    }

    if (this.wasSimulating && !anyMoving) {
      this.wasSimulating = false;
      this.eventBus.emit(ALL_SETTLED, {});
    }

    if (anyMoving) {
      this.wasSimulating = true;
    }
  }

  // ── Collision resolution (elastic 2D circles) ──────────────────

  private resolveCollision(eidA: number, eidB: number): void {
    const pArr = this.pStore.arrays;
    const tArr = this.tStore.arrays;

    const piA = this.pStore.indexOf(eidA);
    const piB = this.pStore.indexOf(eidB);
    const tiA = this.tStore.indexOf(eidA);
    const tiB = this.tStore.indexOf(eidB);

    if (tiA === -1 || tiB === -1) return;

    const pxA = FP.FromRaw(tArr.fpPositionX[tiA]);
    const pzA = FP.FromRaw(tArr.fpPositionZ[tiA]);
    const pxB = FP.FromRaw(tArr.fpPositionX[tiB]);
    const pzB = FP.FromRaw(tArr.fpPositionZ[tiB]);

    const dx = FP.Sub(pxB, pxA);
    const dz = FP.Sub(pzB, pzA);
    const distSq = FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz));

    const rA = FP.FromRaw(pArr.radius[piA]);
    const rB = FP.FromRaw(pArr.radius[piB]);
    const sumR = FP.Add(rA, rB);
    const sumRSq = FP.Mul(sumR, sumR);

    // No collision if distance² >= (rA + rB)²
    if (FP.Gte(distSq, sumRSq)) return;

    const dist = FP.Sqrt(distSq);

    // Avoid division by zero for overlapping centres
    if (dist.isZero()) return;

    // Normal from A to B
    const nx = FP.Div(dx, dist);
    const nz = FP.Div(dz, dist);

    // Separate overlapping checkers
    const overlap = FP.Sub(sumR, dist);
    const halfOverlap = FP.Mul(overlap, this.fpHalf);

    tArr.fpPositionX[tiA] = FP.ToRaw(FP.Sub(pxA, FP.Mul(nx, halfOverlap)));
    tArr.fpPositionZ[tiA] = FP.ToRaw(FP.Sub(pzA, FP.Mul(nz, halfOverlap)));
    tArr.fpPositionX[tiB] = FP.ToRaw(FP.Add(pxB, FP.Mul(nx, halfOverlap)));
    tArr.fpPositionZ[tiB] = FP.ToRaw(FP.Add(pzB, FP.Mul(nz, halfOverlap)));

    // Sync visual positions after separation
    tArr.visualPositionX[tiA] = FP.ToFloat(FP.Sub(pxA, FP.Mul(nx, halfOverlap)));
    tArr.visualPositionZ[tiA] = FP.ToFloat(FP.Sub(pzA, FP.Mul(nz, halfOverlap)));
    tArr.visualPositionX[tiB] = FP.ToFloat(FP.Add(pxB, FP.Mul(nx, halfOverlap)));
    tArr.visualPositionZ[tiB] = FP.ToFloat(FP.Add(pzB, FP.Mul(nz, halfOverlap)));

    // Velocities
    const vxA = FP.FromRaw(pArr.velocityX[piA]);
    const vzA = FP.FromRaw(pArr.velocityZ[piA]);
    const vxB = FP.FromRaw(pArr.velocityX[piB]);
    const vzB = FP.FromRaw(pArr.velocityZ[piB]);

    // Relative velocity of A w.r.t. B
    const dvx = FP.Sub(vxA, vxB);
    const dvz = FP.Sub(vzA, vzB);

    // Relative velocity along collision normal
    const velAlongNormal = FP.Add(FP.Mul(dvx, nx), FP.Mul(dvz, nz));

    // Don't resolve if velocities are separating
    if (FP.Lte(velAlongNormal, FP._0)) return;

    // Masses
    const mA = FP.FromRaw(pArr.mass[piA]);
    const mB = FP.FromRaw(pArr.mass[piB]);
    const invMassSum = FP.Add(FP.Div(FP._1, mA), FP.Div(FP._1, mB));

    // Impulse scalar: j = -(1 + e) * velAlongNormal / (1/mA + 1/mB)
    const j = FP.Div(FP.Mul(this.fpOnePlusRestitution, velAlongNormal), invMassSum);

    // Apply impulse
    const jOverMA = FP.Div(j, mA);
    const jOverMB = FP.Div(j, mB);

    pArr.velocityX[piA] = FP.ToRaw(FP.Sub(vxA, FP.Mul(jOverMA, nx)));
    pArr.velocityZ[piA] = FP.ToRaw(FP.Sub(vzA, FP.Mul(jOverMA, nz)));
    pArr.velocityX[piB] = FP.ToRaw(FP.Add(vxB, FP.Mul(jOverMB, nx)));
    pArr.velocityZ[piB] = FP.ToRaw(FP.Add(vzB, FP.Mul(jOverMB, nz)));

    // Mark both as moving
    pArr.isMoving[piA] = 1;
    pArr.isMoving[piB] = 1;

    // Emit collision event for VFX
    const midX = FP.ToFloat(FP.Mul(FP.Add(FP.FromRaw(tArr.fpPositionX[tiA]), FP.FromRaw(tArr.fpPositionX[tiB])), this.fpHalf));
    const midZ = FP.ToFloat(FP.Mul(FP.Add(FP.FromRaw(tArr.fpPositionZ[tiA]), FP.FromRaw(tArr.fpPositionZ[tiB])), this.fpHalf));
    const midY = BOARD_HEIGHT / 2 + CHECKER_HEIGHT / 2;

    this.eventBus.emit<CheckerCollisionEvent>(CHECKER_COLLISION, {
      x: midX, y: midY, z: midZ,
      entityA: eidA, entityB: eidB,
    });
  }

  // ── Elimination ────────────────────────────────────────────────

  private eliminateChecker(entityId: number, pi: number, ti: number): void {
    const pArr = this.pStore.arrays;
    const tArr = this.tStore.arrays;

    const posX = tArr.visualPositionX[ti];
    const posY = tArr.visualPositionY[ti];
    const posZ = tArr.visualPositionZ[ti];
    const velX = FP.ToFloat(FP.FromRaw(pArr.velocityX[pi]));
    const velZ = FP.ToFloat(FP.FromRaw(pArr.velocityZ[pi]));

    // Mark as dead
    pArr.isAlive[pi] = 0;
    pArr.isMoving[pi] = 0;
    pArr.velocityX[pi] = 0n;
    pArr.velocityZ[pi] = 0n;

    // Determine team
    const entity = this.entityManager.getEntity(entityId);
    const checker = entity?.getComponent<CheckerComponent>(ComponentType.Checker);
    if (checker) {
      checker.isAlive = false;
    }

    const team = checker?.team ?? 'white';

    this.eventBus.emit<CheckerEliminatedEvent>(CHECKER_ELIMINATED, {
      entityId,
      team,
      posX, posY, posZ,
      velX, velZ,
    });
  }

  // ── Cleanup ────────────────────────────────────────────────────

  public override dispose(): void {
    super.dispose();
  }
}


