import { GameSystem, type SoAComponentStore, type SystemContext } from '@phalanx-engine/ecs';
import { FP, type FixedPoint } from '@phalanx-engine/math';
import { PhysicsSoASchema } from '../components/PhysicsBodyComponent';

/**
 * GravitySystem — applies gravitational ACCELERATION to velocity.
 *
 * On each tick, for every body with `useGravity=true`, it decays the velocity
 * along the configured axis: `velocityY -= gravity * tickDt` (for the default
 * `gravityAxis='y'`). It NEVER writes position — position integration is owned
 * exclusively by PhysicsSystem.applyVelocities (which integrates X/Y/Z). This
 * "one owner per axis" rule avoids double-integration.
 *
 * Ordering: register GravitySystem BEFORE PhysicsSystem so the acceleration is
 * applied before that tick's position integration (semi-implicit Euler).
 *
 * When `gravity` is 0 (default), the system is a no-op. Static bodies are
 * skipped (they never integrate position, so accumulating velocity on them
 * would be dead state) — static+useGravity is therefore a clean no-op.
 *
 * v1 supports only `gravityAxis='y'`. X/Z are integrated by PhysicsSystem, so
 * applying gravity there would double-integrate that axis; `'x'`/`'z'` are
 * reserved and rejected at construction.
 */
export class GravitySystem extends GameSystem {
  private physicsStore!: SoAComponentStore<typeof PhysicsSoASchema.definition>;
  private readonly gravity: FixedPoint;
  private readonly gravityAxis: 'x' | 'y' | 'z';
  private readonly tickDt: FixedPoint;

  constructor(gravity: FixedPoint, gravityAxis: 'x' | 'y' | 'z', tickDt: FixedPoint) {
    super();
    // TODO(v2): supporting 'x'/'z' would require PhysicsSystem to cede
    // integration of that axis to GravitySystem to avoid double-integration.
    if (gravityAxis !== 'y') {
      throw new Error(
        `GravitySystem: gravityAxis='${gravityAxis}' is not supported in v1. ` +
          `Only 'y' is supported — X/Z are owned by PhysicsSystem's position integrator.`,
      );
    }
    this.gravity = gravity;
    this.gravityAxis = gravityAxis;
    this.tickDt = tickDt;
  }

  public override init(context: SystemContext): void {
    super.init(context);
    this.physicsStore = this.entityManager.getOrCreateSoAStore(PhysicsSoASchema);
  }

  public override processTick(_tick: number): void {
    // No gravity configured → nothing to do.
    if (FP.Eq(this.gravity, FP._0)) return;

    const delta = FP.Mul(this.gravity, this.tickDt);
    const physVelocityY = this.physicsStore.arrays.velocityY;
    const physUseGravity = this.physicsStore.arrays.useGravity;
    const physIsStatic = this.physicsStore.arrays.isStatic;
    const physIgnorePhysics = this.physicsStore.arrays.ignorePhysics;

    for (const entityId of this.physicsStore.entityIds()) {
      const physIndex = this.physicsStore.indexOf(entityId);
      if (physUseGravity[physIndex] !== 1) continue;
      if (physIgnorePhysics[physIndex] === 1) continue;
      // Static bodies never integrate position, so accumulating velocity on
      // them is dead state — skip so static+useGravity is a clean no-op.
      if (physIsStatic[physIndex] === 1) continue;
      // velocityY -= gravity * tickDt
      const velY = FP.FromRaw(physVelocityY[physIndex]);
      physVelocityY[physIndex] = FP.ToRaw(FP.Sub(velY, delta));
    }
  }

  /** Configured gravity magnitude (0 = disabled). */
  public getGravity(): FixedPoint {
    return this.gravity;
  }

  /** Configured gravity axis (v1: always `'y'`). */
  public getGravityAxis(): 'x' | 'y' | 'z' {
    return this.gravityAxis;
  }
}
