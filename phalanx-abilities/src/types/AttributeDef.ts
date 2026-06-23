import type { FixedPoint } from '@phalanx-engine/math';

export type AttributeClampMode = 'both' | 'min' | 'max' | 'none';

export interface AttributeDef {
  id: string;
  default: FixedPoint;
  min: FixedPoint;
  max: FixedPoint;
  clamp: AttributeClampMode;
}
