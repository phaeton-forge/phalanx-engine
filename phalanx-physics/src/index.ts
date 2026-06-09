// Components
export {
  PhysicsBodyComponent,
  PhysicsSoASchema,
  PHYSICS_BODY_COMPONENT_TYPE,
  TransformComponent,
  TransformSoASchema,
  TRANSFORM_COMPONENT_TYPE,
  InterpolationComponent,
  INTERPOLATION_COMPONENT_TYPE,
} from './components';
export type { PhysicsBodyConfig } from './types';

// Collision
export { SpatialHashGrid } from './collision/SpatialHashGrid';
export { NarrowPhase } from './collision/NarrowPhase';
export type { CollisionManifold } from './collision/CollisionManifold';

// Systems
export { PhysicsSystem, InterpolationSystem } from './systems';
export type { InterpolatedTransformSample } from './systems';

// Facade
export { PhysicsWorld } from './PhysicsWorld';

// Config & Types
export type { PhysicsWorldConfig } from './PhysicsWorldConfig';
export type { TransformFieldMapping, CollisionFilter, CollisionEvent, PhysicsConfig } from './types';
export { PhysicsEvents } from './events';

// Tick providers
export type { IPhysicsTickProvider } from './tick/IPhysicsTickProvider';
export { AutonomousPhysicsTickProvider } from './tick/AutonomousPhysicsTickProvider';
export type { AutonomousProviderOptions } from './tick/AutonomousPhysicsTickProvider';
export { ExternalPhysicsTickProvider } from './tick/ExternalPhysicsTickProvider';
export type { BoundsExitEvent } from './types';
