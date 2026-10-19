/**
 * Game-facing Phalanx surface (`@phalanx-engine/game`).
 *
 * This entry re-exports `@phalanx-engine/runtime` and the explicit ecs
 * names below. Fixed-point math is `@phalanx-engine/game/math` only.
 * Physics, abilities and advanced helpers are
 * `@phalanx-engine/game/physics`, `@phalanx-engine/game/abilities` and
 * `@phalanx-engine/game/advanced`.
 *
 * `InterpolatedTransformSample` is exported by both ecs and physics. It is
 * not exported here; games import the physics type from
 * `@phalanx-engine/game/physics`.
 *
 * Low-level ecs symbols (`setWorldModuleHost`, `setEntityIdCounter`,
 * `nextEntityId`, `PoolManager`, `SoAComponentStore`, `TickFrameManager`,
 * `TYPED_ARRAY_CONSTRUCTORS`, `DebugPanel`) are on
 * `@phalanx-engine/game/advanced`, not here.
 */
export * from '@phalanx-engine/runtime';
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
