/**
 * Interpolated position and rotation sample for rendering.
 *
 * Populated by phalanx-physics after InterpolationSystem runs its frame hooks.
 */
export interface InterpolatedTransformSample {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
}

/**
 * Minimal physics-world contract known to phalanx-ecs.
 *
 * Methods that involve fixed-point types use `unknown` here so that
 * phalanx-ecs stays dependency-free. The concrete PhysicsWorld class in
 * phalanx-physics satisfies this interface structurally.
 *
 * GameSystem exposes this as a protected `physics` getter; systems in
 * games that don't use phalanx-physics will simply receive `undefined`.
 *
 * Set on `SystemContext.physics` before `registerSystems()` is called,
 * typically by game bootstrap code or a `createPhysicsWorld()` helper.
 */
export interface IPhysicsWorld {
  /**
   * Interpolated position and rotation for rendering.
   */
  getInterpolatedTransform(entityId: number): InterpolatedTransformSample | undefined;

  /**
   * Fixed-point position for gameplay queries (e.g. ability targeting).
   */
  getEntityPosition(entityId: number): { x: unknown; z: unknown } | undefined;

  /** Apply a velocity impulse to a body. Replaces existing velocity. */
  applyImpulse(entityId: number, vx: unknown, vz: unknown): void;
}
