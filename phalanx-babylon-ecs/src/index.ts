/**
 * Phalanx Babylon ECS - Entity Component System for Babylon.js
 *
 * A lightweight ECS library with optional multiplayer support via Phalanx Engine
 */

// Core ECS
export { EntityManager } from './EntityManager';
export { EventBus, globalEventBus } from './EventBus';
export { SystemRegistry } from './SystemRegistry';
export { SystemContext } from './SystemContext';
export { GameSystem } from './GameSystem';

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
