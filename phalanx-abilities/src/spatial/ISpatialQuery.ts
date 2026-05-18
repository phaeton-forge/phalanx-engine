import type { FixedPoint } from 'phalanx-math';

export interface ISpatialQuery {
  queryRadius(x: FixedPoint, z: FixedPoint, radius: FixedPoint): number[];
}
