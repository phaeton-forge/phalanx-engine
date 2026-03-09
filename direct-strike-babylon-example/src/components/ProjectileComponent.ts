import type { IComponent } from './Component';
import { ComponentType } from './Component';
import type { FPVector3 as FPVector3Type, FixedPoint } from 'phalanx-math';

/**
 * ProjectileComponent - Data-only component for projectile state
 *
 * Stores all deterministic simulation state for a projectile entity.
 * Uses fixed-point math for direction and speed to ensure determinism.
 * Lifetime is tick-based (integer countdown) for exact cross-client synchronization.
 */
export class ProjectileComponent implements IComponent {
  public readonly type = ComponentType.Projectile;

  /** Normalized direction of travel (fixed-point, deterministic) */
  public readonly fpDirection: FPVector3Type;

  /** Movement speed per second (fixed-point, deterministic) */
  public readonly fpSpeed: FixedPoint;

  /** Damage dealt on hit */
  public readonly damage: number;

  /** Remaining lifetime in simulation ticks (deterministic integer countdown) */
  public remainingTicks: number;

  /** Entity ID of the shooter (for friendly-fire prevention & event attribution) */
  public readonly sourceId: number;

  constructor(
    fpDirection: FPVector3Type,
    fpSpeed: FixedPoint,
    damage: number,
    remainingTicks: number,
    sourceId: number
  ) {
    this.fpDirection = fpDirection;
    this.fpSpeed = fpSpeed;
    this.damage = damage;
    this.remainingTicks = remainingTicks;
    this.sourceId = sourceId;
  }
}
