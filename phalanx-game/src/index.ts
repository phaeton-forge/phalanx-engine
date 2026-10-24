/**
 * Game-facing Phalanx surface (`@phalanx-engine/game`).
 *
 * This entry re-exports `@phalanx-engine/runtime` and the explicit ecs
 * names below. Fixed-point math is `@phalanx-engine/game/math` only.
 * Physics, abilities and advanced helpers are
 * `@phalanx-engine/game/physics`, `@phalanx-engine/game/abilities` and
 * `@phalanx-engine/game/advanced`.
 *
 * `InterpolatedTransformSample` is exported by physics only
 * (`@phalanx-engine/game/physics`). It is not exported here.
 *
 * Low-level ecs symbols (`PoolManager`, `SoAComponentStore`,
 * `TickFrameManager`, `TYPED_ARRAY_CONSTRUCTORS`, `DebugPanel`) are on
 * `@phalanx-engine/game/advanced`, not here.
 */
export * from '@phalanx-engine/runtime';
export {
  EntityManager,
  EventBus,
  SystemRegistry,
  SystemContext,
  GameSystem,
  GameWorld,
  GameWorldEvents,
  Entity,
  IComponent,
  ObjectPool,
  EntityPool,
  defineSoASchema,
  calculateSchemaByteSize,
  FIELD_BYTE_SIZES,
  isBeforeTick,
  isAfterTick,
  isBeforeFrame,
  isAfterFrame,
  defineService,
} from '@phalanx-engine/ecs';
export type {
  ServiceKey,
  QueryComponent,
  QueryRow,
  QueryAnyRow,
  GameWorldConfig,
  GameWorldHooks,
  Component,
  ComponentLifecycle,
  ComponentRegistration,
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
  IBeforeTick,
  IAfterTick,
  IBeforeFrame,
  IAfterFrame,
  IRandom,
  ITickFrameProvider,
  TickHandler,
  FrameHandler,
  Unsubscribe,
  CommandsBatch,
  PlayerCommand,
  PauseHandler,
} from '@phalanx-engine/ecs';
