import type { IComponent } from './Component.ts';
import { ComponentType } from './Component.ts';
import { FP, type FixedPoint } from '@phalanx-engine/math';
import type { FPVector3 as FPVector3Type } from '@phalanx-engine/math';
import type { TeamId } from './UnitComponents';

/** Deterministic shrapnel spray configuration carried by a shell. */
export interface ShrapnelConfig {
  /** Number of fragments to spawn on detonation. */
  count: number;
  /** Half-angle (radians) of the upward launch cone. */
  cone: FixedPoint;
  /** Launch speed (world units/s) of each fragment. */
  speed: FixedPoint;
}

/**
 * ArtilleryShellComponent — logic-only marker for an in-flight SAU shell.
 *
 * The shell is NOT a visible flying projectile: it has no PhysicsBody and no
 * mesh. It is a delayed-detonation timer that records the snapshotted impact
 * point and the parameters ArtilleryShellSystem needs to resolve the blast and
 * spawn shrapnel at `detonateTick`.
 */
export class ArtilleryShellComponent implements IComponent {
  public readonly type = ComponentType.ArtilleryShell;

  /** World-space point where the shell detonates (snapshotted at fire time). */
  public readonly impactPoint: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };

  /** Firing unit (source of the resulting damage effects). */
  public sourceEntityId = -1;
  /** Firing unit's team; enemy-only blasts filter against this. */
  public teamId: TeamId = 0;

  /** Tick at which the shell detonates. */
  public detonateTick = 0;

  public primaryRadius: FixedPoint = FP._0;
  public primaryEffectId = 'Effect.Damage.SAU.Primary';
  public secondaryRadius: FixedPoint = FP._0;
  public secondaryEffectId = 'Effect.Damage.SAU.Secondary';

  public shrapnelConfig: ShrapnelConfig = {
    count: 0,
    cone: FP._0,
    speed: FP._0,
  };

  /** One-shot latch so the falling-shadow cue is emitted exactly once. */
  public shadowEmitted = false;
}
