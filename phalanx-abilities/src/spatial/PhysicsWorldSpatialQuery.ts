import type { FixedPoint } from 'phalanx-math';
import type { ISpatialQuery } from './ISpatialQuery';

/**
 * Minimal surface of {@link import('phalanx-physics').PhysicsWorld | PhysicsWorld}
 * needed to drive {@link ISpatialQuery} without a hard `phalanx-physics` dependency.
 *
 * Pass a live `PhysicsWorld` instance as `physicsWorld` in
 * {@link CreateAbilitySystemConfig}; `createAbilitySystem` wraps it automatically
 * unless you supply an explicit `spatialQuery` override.
 */
export interface PhysicsWorldSpatialQuery {
  readonly spatialGrid: {
    queryRadius(x: FixedPoint, z: FixedPoint, radius: FixedPoint): number[];
  };
  getEntityPosition(entityId: number): { x: FixedPoint; z: FixedPoint } | undefined;
}

export function spatialQueryFromPhysicsWorld(
  physicsWorld: PhysicsWorldSpatialQuery
): ISpatialQuery {
  return {
    queryRadius: (x, z, radius) => physicsWorld.spatialGrid.queryRadius(x, z, radius),
    getEntityPosition: (entityId) => physicsWorld.getEntityPosition(entityId),
  };
}
