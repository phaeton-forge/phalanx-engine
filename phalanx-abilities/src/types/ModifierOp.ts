import type { FixedPoint } from '@phalanx-engine/math';

export type ModifierOp = 'Add' | 'Multiply' | 'Override';

export interface Modifier {
  attributeId: string;
  op: ModifierOp;
  magnitude: FixedPoint;
}
