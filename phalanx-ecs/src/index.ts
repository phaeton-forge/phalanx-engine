/**
 * Phalanx ECS - Renderer-agnostic Entity Component System
 *
 * A lightweight ECS library with optional multiplayer support via Phalanx Engine.
 * No rendering dependencies - bring your own renderer (Babylon.js, Three.js, etc.)
 */

// Core ECS
export { EntityManager } from './EntityManager';
export { EventBus, globalEventBus } from './EventBus';
export { SystemRegistry } from './SystemRegistry';
export { SystemContext } from './SystemContext';
export { GameSystem } from './GameSystem';

// GameWorld facade
export { GameWorld, GameWorldEvents } from './GameWorld';
export type { GameWorldConfig, GameWorldHooks, PoolingConfig } from './GameWorld';

// Entity and Component
export { Entity, resetEntityIdCounter, nextEntityId } from './Entity';
export { IComponent, createComponentTypeRegistry } from './Component';
export type { IComponent as Component } from './Component';

// SoA (Structure-of-Arrays) high-performance storage
export { SoAComponentStore } from './SoAComponentStore';
export { SoAComponent } from './SoAComponent';
export {
  defineSoASchema,
  calculateSchemaByteSize,
  TYPED_ARRAY_CONSTRUCTORS,
  FIELD_BYTE_SIZES,
} from './SoASchema';
export type {
  SoASchema,
  SoASchemaDefinition,
  SoAFieldType,
  SoAFieldsOf,
  SoAArraysOf,
  SoAValueType,
  SoAArrayType,
  TypedArrayLike,
} from './SoASchema';

// Tick/Frame Management
export { TickFrameManager } from './TickFrameManager';
export type { TickFrameManagerConfig } from './TickFrameManager';
export type {
  ITickFrameProvider,
  TickHandler,
  FrameHandler,
  Unsubscribe,
  CommandsBatch,
  PlayerCommand,
  PauseHandler,
} from './ITickFrameProvider';

// Object Pooling
export type { IPoolable } from './pool/IPoolable';
export type { IResettableComponent } from './pool/IResettableComponent';
export type { PoolConfig, PoolStats } from './pool/types';
export { ObjectPool } from './pool/ObjectPool';
export { EntityPool } from './pool/EntityPool';
export type { ComponentTemplate, EntityPoolConfig } from './pool/EntityPool';
export { PoolManager } from './pool/PoolManager';
export type { EntityTypeConfig } from './pool/PoolManager';
export { ComponentPoolRegistry } from './pool/ComponentPoolRegistry';
