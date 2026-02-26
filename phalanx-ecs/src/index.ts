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
export { GameWorld } from './GameWorld';
export type { GameWorldConfig, GameWorldHooks } from './GameWorld';

// Entity and Component
export { Entity, resetEntityIdCounter } from './Entity';
export { IComponent, createComponentTypeRegistry } from './Component';
export type { IComponent as Component } from './Component';

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
} from './ITickFrameProvider';
