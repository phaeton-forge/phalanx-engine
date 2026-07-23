import type { FixedPoint } from '@phalanx-engine/math';

/** `base` + `current` snapshot of a single attribute, as read through the facade. */
export interface AttributeValue {
  base: FixedPoint;
  current: FixedPoint;
}
