import type { FixedPoint } from 'phalanx-math';

export type ModifierOp = 'Add' | 'Multiply' | 'Override';

export interface Modifier {
  attributeId: string;
  op: ModifierOp;
  magnitude: FixedPoint;
}
