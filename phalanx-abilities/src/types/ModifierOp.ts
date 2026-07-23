import type { FixedPoint } from '@phalanx-engine/math';
import type { MagnitudeCalculation } from './MagnitudeCalculation';

export type ModifierOp = 'Add' | 'Multiply' | 'Override';

export interface Modifier {
  attributeId: string;
  op: ModifierOp;
  magnitude: FixedPoint;
  /**
   * Optional dynamic magnitude calculation (Unreal GAS ModMagnitudeCalculation
   * analog). When present, the engine evaluates it once at effect-application
   * time and uses its result instead of `magnitude` as the effective value
   * fed into `op`. `magnitude` is still passed through as `baseMagnitude` in
   * the calculation context, so it remains useful as a base/default value.
   * Omitting `calculation` preserves the exact pre-existing behavior.
   */
  calculation?: MagnitudeCalculation;
}
