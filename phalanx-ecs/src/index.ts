/**
 * Phalanx ECS - Renderer-agnostic Entity Component System
 *
 * A lightweight ECS library with optional multiplayer support via Phalanx Engine.
 * No rendering dependencies - bring your own renderer (Babylon.js, Three.js, etc.)
 */

// Core ECS
export { EntityManager } from './EntityManager.js';
export { EventBus } from './EventBus.js';
export { SystemRegistry } from './SystemRegistry.js';
export { SystemContext } from './SystemContext.js';
export { GameSystem } from './GameSystem.js';

// GameWorld facade
export { GameWorld, GameWorldEvents } from './GameWorld.js';
export type { GameWorldConfig, GameWorldHooks } from './GameWorld.js';

// Entity and Component
export { Entity } from './Entity.js';
export { IComponent, createComponentTypeRegistry } from './Component.js';
export type { IComponent as Component } from './Component.js';
export type { ComponentLifecycle } from './lifecycle.js';
export type { ComponentRegistration } from './ComponentRegistration.js';

// Object Pooling
export { ObjectPool, EntityPool, PoolManager } from './pool/index.js';
export type {
  IPoolable,
  IPoolableComponent,
  IPoolableEntity,
  SpawnArgsOf,
  PoolConfig,
  PoolStats,
  EntityTypeConfig,
  PoolingConfig,
} from './pool/index.js';

// SoA (Structure-of-Arrays) cache-friendly storage
export { SoAComponentStore } from './SoAComponentStore.js';
export type { SoAComponentStoreOptions } from './SoAComponentStore.js';
export { SoAComponent } from './SoAComponent.js';
export {
  defineSoASchema,
  calculateSchemaByteSize,
  TYPED_ARRAY_CONSTRUCTORS,
  FIELD_BYTE_SIZES,
} from './SoASchema.js';
export type {
  SoASchema,
  SoASchemaDefinition,
  SoAFieldType,
  SoAFieldsOf,
  SoAArraysOf,
  SoAValueType,
  SoAArrayType,
  TypedArrayLike,
} from './SoASchema.js';

// Optional system lifecycle hook interfaces
export type {
  IBeforeTick,
  IAfterTick,
  IBeforeFrame,
  IAfterFrame,
} from './ISystemLifecycleHooks.js';
export {
  isBeforeTick,
  isAfterTick,
  isBeforeFrame,
  isAfterFrame,
} from './ISystemLifecycleHooks.js';

// Ability system contract (implemented by phalanx-abilities)
export type { IAbilitySystem } from './IAbilitySystem.js';

// Physics world contract (implemented by phalanx-physics)
export type {
  IPhysicsWorld,
  InterpolatedTransformSample,
} from './IPhysicsWorld.js';

// Match-scoped deterministic RNG contract
export type { IRandom } from './IRandom.js';

// Snapshot port. Modules register sections; the runtime writes them.
export type { StateWriter, StateReader } from './state/StateIO.js';
export type { SaveSection } from './state/sections.js';
export { BinaryStateWriter, BinaryStateReader } from './state/BinaryState.js';

// Tick/Frame Management
export type {
  ITickFrameProvider,
  TickHandler,
  FrameHandler,
  Unsubscribe,
  CommandsBatch,
  PlayerCommand,
  PauseHandler,
} from './ITickFrameProvider.js';
