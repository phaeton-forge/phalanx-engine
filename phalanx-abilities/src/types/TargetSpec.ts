import type { FixedPoint } from 'phalanx-math';

export type TargetOrigin =
  | { kind: 'Caster' }
  | { kind: 'TargetEntity'; entityId: number }
  | { kind: 'Point'; x: FixedPoint; z: FixedPoint }
  | { kind: 'Caller' };

export interface TargetFilter {
  tagsRequired?: string[];
  tagsBlocked?: string[];
}

export type TargetSpec =
  | { kind: 'Self' }
  | { kind: 'Entity'; origin: TargetOrigin }
  | { kind: 'Point'; origin: TargetOrigin };

export interface ProvidedTarget {
  entityId?: number;
  x?: FixedPoint;
  z?: FixedPoint;
}
