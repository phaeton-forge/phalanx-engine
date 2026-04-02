import type { FixedPoint } from 'phalanx-math';
import type { EntityFactory } from '../core/EntityFactory.ts';

export function createEnemy(factory: EntityFactory, x: FixedPoint, z: FixedPoint, speed: FixedPoint, targetId: number): number {
  return factory.createEnemy(x, z, speed, targetId);
}
