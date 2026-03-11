import type { Vector3, Mesh } from '@babylonjs/core';

/**
 * IMeshEntity - Interface for entities that have a visual mesh representation.
 *
 * Implemented by both Unit (base class for all game units) and ProjectileEntity.
 * Used by InterpolationSystem to apply interpolated positions to meshes
 * without coupling to a specific entity class.
 */
export interface IMeshEntity {
  setVisualPosition(position: Vector3): void;
  getMesh(): Mesh | null;
}
