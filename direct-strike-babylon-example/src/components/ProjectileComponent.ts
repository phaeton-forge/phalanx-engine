import { ComponentType } from './Component';
import type { IResettableComponent } from '@phalanx-engine/ecs';
import type { FPVector3 as FPVector3Type, FixedPoint } from '@phalanx-engine/math';
import { FP } from '@phalanx-engine/math';

/**
 * ProjectileComponent - Data-only component for projectile state
 *
 * Implements IResettableComponent for pool support.
 * fpDirection is pre-allocated and mutated in-place on reinitialize()
 * to avoid per-spawn heap allocation.
 */
export class ProjectileComponent implements IResettableComponent {
  public readonly type = ComponentType.Projectile;

  /**
   * Normalized direction of travel (fixed-point, deterministic).
   * Pre-allocated once — mutated in-place by reinitialize().
   */
  public readonly fpDirection: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };

  /** Movement speed per second (fixed-point, deterministic) */
  public fpSpeed: FixedPoint;

  /** Damage dealt on hit */
  public damage: number;

  /** Remaining lifetime in simulation ticks (deterministic integer countdown) */
  public remainingTicks: number;

  /** Entity ID of the shooter (for friendly-fire prevention & event attribution) */
  public sourceId: number;

  constructor(
    fpDirection?: FPVector3Type,
    fpSpeed?: FixedPoint,
    damage?: number,
    remainingTicks?: number,
    sourceId?: number
  ) {
    if (fpDirection) {
      this.fpDirection.x = fpDirection.x;
      this.fpDirection.y = fpDirection.y;
      this.fpDirection.z = fpDirection.z;
    }
    this.fpSpeed = fpSpeed ?? FP._0;
    this.damage = damage ?? 0;
    this.remainingTicks = remainingTicks ?? 0;
    this.sourceId = sourceId ?? 0;
  }

  /** IPoolable: reset to default state */
  reset(): void {
    this.fpDirection.x = FP._0;
    this.fpDirection.y = FP._0;
    this.fpDirection.z = FP._0;
    this.fpSpeed = FP._0;
    this.damage = 0;
    this.remainingTicks = 0;
    this.sourceId = 0;
  }

  /** IResettableComponent: reinitialize with new parameters — zero allocation */
  reinitialize(
    fpDirection: FPVector3Type,
    fpSpeed: FixedPoint,
    damage: number,
    remainingTicks: number,
    sourceId: number
  ): void {
    this.fpDirection.x = fpDirection.x;
    this.fpDirection.y = fpDirection.y;
    this.fpDirection.z = fpDirection.z;
    this.fpSpeed = fpSpeed;
    this.damage = damage;
    this.remainingTicks = remainingTicks;
    this.sourceId = sourceId;
  }
}
