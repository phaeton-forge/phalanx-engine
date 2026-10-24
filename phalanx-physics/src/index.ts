// Components
export {
  PhysicsBody,
  PhysicsSoASchema,
  attachPhysicsBody,
  readVelocity,
  writeVelocity,
  setVelocity,
  addVelocity,
  stopVelocity,
  readRadius,
  readMass,
  readRestitution,
  readFriction,
  readIsStatic,
  readIgnorePhysics,
  writeIgnorePhysics,
  readUseGravity,
  writeUseGravity,
  readGravityMultiplier,
  writeGravityMultiplier,
  Transform,
  TransformSoASchema,
  attachTransform,
  readFpPosition,
  writeFpPosition,
  readFpRotation,
  writeFpRotation,
  readFpRotationEuler,
  writeFpRotationEuler,
  readYaw,
  writeYaw,
  Interpolation,
  attachInterpolation,
  interpolationOf,
  snapshotInterpolation,
  captureInterpolation,
  createInterpolationSample,
} from './components/index.js';
export type { InterpolationSample } from './components/index.js';
export type { PhysicsBodyConfig } from './types.js';

// Collision
export { SpatialHashGrid } from './collision/SpatialHashGrid.js';
export type { BroadphaseCenter } from './collision/SpatialHashGrid.js';
export { NarrowPhase } from './collision/NarrowPhase.js';
export type { CollisionManifold } from './collision/CollisionManifold.js';
export { segmentVsAABB } from './collision/Raycast.js';
export type { RayHit, Vec3FP, AABB } from './collision/Raycast.js';

// Systems
export {
  PhysicsSystem,
  GravitySystem,
  InterpolationSystem,
  CollisionSystem,
} from './systems/index.js';
export type { InterpolatedTransformSample } from './systems/index.js';

// Facade
export { PhysicsWorld } from './PhysicsWorld.js';
export { Physics } from './service.js';

// Config & Types
export type { PhysicsWorldConfig } from './PhysicsWorldConfig.js';
export type {
  CollisionFilter,
  CollisionEvent,
  PhysicsConfig,
} from './types.js';
export { PhysicsEvents } from './events.js';

// Tick providers
export type { IPhysicsTickProvider } from './tick/IPhysicsTickProvider.js';
export { ExternalPhysicsTickProvider } from './tick/ExternalPhysicsTickProvider.js';
export type { BoundsExitEvent } from './types.js';
