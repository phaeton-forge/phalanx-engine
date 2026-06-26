import type { IComponent } from './Component.ts';
import { ComponentType } from './Component.ts';
import { FP, type FixedPoint } from '@phalanx-engine/math';
import { MISSILE_LIFETIME_SECONDS } from '../config/constants';

export const MISSILE_DEFAULT_LIFETIME = FP.FromFloat(MISSILE_LIFETIME_SECONDS);

export type MissilePhase = 'launch' | 'targeting' | 'cruise' | 'attack';

/** Homing data for a missile entity (paired with ProjectileComponent). */
export class MissileComponent implements IComponent {
  public readonly type = ComponentType.Missile;

  /** Entity the missile homes toward. -1 = no lock; movement self-destructs. */
  public targetEntityId = -1;
  public phase: MissilePhase = 'launch';

  /** Ticks remaining in each phase. */
  public launchTicksRemaining = 0;
  public targetingTicksRemaining = 0;

  /** Spawn position — base of the launch arc. */
  public spawnX: FixedPoint = FP._0;
  public spawnY: FixedPoint = FP._0;
  public spawnZ: FixedPoint = FP._0;

  /** Horizontal offset at the launch peak (deterministic per missile). */
  public launchSpreadX: FixedPoint = FP._0;
  public launchSpreadZ: FixedPoint = FP._0;
  /** Multiplier applied to {@link MISSILE_LAUNCH_HEIGHT} for this missile. */
  public launchHeightScale: FixedPoint = FP._1;

  public lifeTime: FixedPoint = MISSILE_DEFAULT_LIFETIME;

  /**
   * Current orientation as a unit quaternion (nose = local +Z).
   * Stored as plain numbers; slerp is float-based (see plan §2.3). Identity = (0,0,0,1).
   */
  public qx = 0;
  public qy = 0;
  public qz = 0;
  public qw = 1;
}
