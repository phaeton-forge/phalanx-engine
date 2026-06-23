import type { FixedPoint } from '@phalanx-engine/math';
import type { EntityFactory } from '../core/EntityFactory.ts';

export function createProjectile(factory: EntityFactory, x: FixedPoint, z: FixedPoint, dirX: FixedPoint, dirZ: FixedPoint, ownerId: number): number {
  return factory.createProjectile(x, z, dirX, dirZ, ownerId);
}
