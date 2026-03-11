import { ComponentType } from './Component';
import type { IResettableComponent } from 'phalanx-ecs';
import type { FPVector3 as FPVector3Type, FixedPoint } from 'phalanx-math';
import { FP, FPVector3 } from 'phalanx-math';

/**
 * ProjectileComponent - Data-only component for projectile state
 *
 * Implements IResettableComponent for pool support.
 * Fields are mutable to allow reinitialize() without allocation.
 */
export class ProjectileComponent implements IResettableComponent {
  public readonly type = ComponentType.Projectile;

  /** Normalized direction of travel (fixed-point, deterministic) */
  public fpDirection: FPVector3Type;

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
    this.fpDirection = fpDirection ?? FPVector3.Zero;
    this.fpSpeed = fpSpeed ?? FP._0;
    this.damage = damage ?? 0;
    this.remainingTicks = remainingTicks ?? 0;
    this.sourceId = sourceId ?? 0;
  }

  /** IPoolable: reset to default state */
  reset(): void {
    this.fpDirection = FPVector3.Zero;
    this.fpSpeed = FP._0;
    this.damage = 0;
    this.remainingTicks = 0;
    this.sourceId = 0;
  }

  /** IResettableComponent: reinitialize with new parameters */
  reinitialize(
    fpDirection: FPVector3Type,
    fpSpeed: FixedPoint,
    damage: number,
    remainingTicks: number,
    sourceId: number
  ): void {
    this.fpDirection = fpDirection;
    this.fpSpeed = fpSpeed;
    this.damage = damage;
    this.remainingTicks = remainingTicks;
    this.sourceId = sourceId;
  }
}
