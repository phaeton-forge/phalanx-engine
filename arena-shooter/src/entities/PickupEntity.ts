import type { FixedPoint } from 'phalanx-math';
import type { EntityFactory } from '../core/EntityFactory.ts';

export function createPickup(factory: EntityFactory, x: FixedPoint, z: FixedPoint): number {
  return factory.createPickup(x, z);
}
