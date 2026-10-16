/**
 * Game-facing Phalanx surface. Advanced helpers (`StateHelpers`,
 * `spawnWithId`, `SaveHandler`, `CommandSchema`, `WorldScope`) stay on
 * `@phalanx-engine/runtime/advanced` and are not re-exported here.
 *
 * `InterpolatedTransformSample` is exported by both ecs and physics. The
 * physics type is the one games read from `getInterpolatedTransform`.
 *
 * Low-level ecs symbols (`setWorldModuleHost`, `setEntityIdCounter`,
 * `nextEntityId`, `PoolManager`, `SoAComponentStore`, `TickFrameManager`,
 * `TYPED_ARRAY_CONSTRUCTORS`, `DebugPanel`) are on
 * `@phalanx-engine/runtime/advanced`, not here.
 */
export * from '@phalanx-engine/runtime';
export * from '@phalanx-engine/abilities';
export * from '@phalanx-engine/math';
export * from '@phalanx-engine/physics';
export {
  EntityManager,
  EventBus,
  globalEventBus,
  SystemRegistry,
  SystemContext,
  GameSystem,
  GameWorld,
  GameWorldEvents,
  Entity,
  resetEntityIdCounter,
  getEntityIdCounter,
  IComponent,
  createComponentTypeRegistry,
  ObjectPool,
  EntityPool,
  SoAComponent,
  defineSoASchema,
  calculateSchemaByteSize,
  FIELD_BYTE_SIZES,
  DebugDataProvider,
  isBeforeTick,
  isAfterTick,
  isBeforeFrame,
  isAfterFrame,
} from '@phalanx-engine/ecs';
export type {
  GameWorldConfig,
  GameWorldHooks,
  Component,
  ComponentLifecycle,
  ComponentRegistration,
  WorldModuleHost,
  IPoolable,
  IPoolableEntity,
  SpawnArgsOf,
  PoolConfig,
  PoolStats,
  EntityTypeConfig,
  PoolingConfig,
  SoAComponentStoreOptions,
  SoASchema,
  SoASchemaDefinition,
  SoAFieldType,
  SoAFieldsOf,
  SoAArraysOf,
  SoAValueType,
  SoAArrayType,
  TypedArrayLike,
  DebugSnapshot,
  DebugEntitySnapshot,
  DebugComponentSnapshot,
  DebugSoAStoreSnapshot,
  DebugPoolSnapshot,
  DebugDataProviderConfig,
  IBeforeTick,
  IAfterTick,
  IBeforeFrame,
  IAfterFrame,
  IAbilitySystem,
  IPhysicsWorld,
  IRandom,
  ITickFrameProvider,
  TickHandler,
  FrameHandler,
  Unsubscribe,
  CommandsBatch,
  PlayerCommand,
  PauseHandler,
} from '@phalanx-engine/ecs';
