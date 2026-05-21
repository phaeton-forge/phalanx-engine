import type { FixedPoint } from 'phalanx-math';
import type { PhysicsWorld } from '../PhysicsWorld';

/**
 * Adapter for {@link import('phalanx-abilities').ISpatialQuery | ISpatialQuery}
 * backed by a {@link PhysicsWorld}'s broad-phase grid and transform positions.
 *
 * Prefer passing the `PhysicsWorld` directly to
 * `createAbilitySystem({ physicsWorld })` so registration happens automatically.
 * Use this factory when calling `AbilitySystemFacade.registerSpatialQuery` manually
 * or when you need a standalone adapter instance.
 */
export interface PhysicsSpatialQuery {
  queryRadius(x: FixedPoint, z: FixedPoint, radius: FixedPoint): number[];
  getEntityPosition(entityId: number): { x: FixedPoint; z: FixedPoint } | undefined;
}

export function createPhysicsSpatialQuery(physicsWorld: PhysicsWorld): PhysicsSpatialQuery {
  return {
    queryRadius: (x, z, radius) => physicsWorld.spatialGrid.queryRadius(x, z, radius),
    getEntityPosition: (entityId) => physicsWorld.getEntityPosition(entityId),
  };
}
