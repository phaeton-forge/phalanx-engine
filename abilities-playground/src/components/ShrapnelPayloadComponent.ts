import type { IComponent } from './Component.ts';
import { ComponentType } from './Component.ts';
import { FP, type FixedPoint } from '@phalanx-engine/math';
import type { TeamId } from './UnitComponents';

/**
 * ShrapnelPayloadComponent — secondary-blast data carried by a flying shrapnel
 * fragment plus the previous-tick position needed for swept landing detection.
 *
 * ShrapnelLandingSystem sweeps prev→cur each tick to find the exact ground
 * crossing (v1: ground plane only), then applies the secondary AoE from the
 * original firing unit — resolved even if that unit has since died.
 */
export class ShrapnelPayloadComponent implements IComponent {
  public readonly type = ComponentType.ShrapnelPayload;

  /** Firing unit (source of the secondary damage; may be dead by landing). */
  public sourceEntityId = -1;
  public teamId: TeamId = 0;

  public secondaryEffectId = 'Effect.Damage.SAU.Secondary';
  public secondaryRadius: FixedPoint = FP._0;

  /** Previous-tick world position, for the prev→cur landing sweep. */
  public prevPosX: FixedPoint = FP._0;
  public prevPosY: FixedPoint = FP._0;
  public prevPosZ: FixedPoint = FP._0;

  /** Set true once the fragment has landed and resolved its blast. */
  public landed = false;
}
