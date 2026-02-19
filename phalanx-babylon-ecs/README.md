# Phalanx Babylon ECS

A lightweight Entity-Component-System (ECS) library for Babylon.js with optional multiplayer support via Phalanx Engine.

## Features

- **Pure ECS Architecture**: EntityManager, SystemRegistry, EventBus
- **Flexible Integration**: Use standalone or with Phalanx Client for multiplayer
- **TypeScript First**: Full type safety and excellent IDE support
- **Babylon.js Optimized**: Designed specifically for Babylon.js workflows
- **Deterministic Tick/Frame**: Separate tick-based simulation from frame-based rendering

## Core Components

### Entity Management
- **Entity**: Abstract base class for all game objects
- **EntityManager**: Central registry with efficient component-based queries
- **IComponent**: Interface for all components

### System Architecture
- **GameSystem**: Base class for all game systems
- **SystemRegistry**: Manages system lifecycle and execution order
- **SystemContext**: Dependency injection container

### Event System
- **EventBus**: Decoupled communication between systems

### Tick/Frame Management
- **TickFrameManager**: Built-in no-op client for single-player games
- Compatible with PhalanxClient for multiplayer

## Installation

```bash
npm install phalanx-babylon-ecs
```

## Usage

### Single-player Mode (No-Op Client)

```typescript
import { Engine, Scene } from '@babylonjs/core';
import {
  SystemRegistry,
  TickFrameManager,
  EntityManager,
  EventBus
} from 'phalanx-babylon-ecs';

// Create Babylon.js engine and scene
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);

// Create ECS core
const systemRegistry = new SystemRegistry(engine, scene);
systemRegistry.createCoreDependencies();

// Create your systems
const movementSystem = new MovementSystem();
const renderSystem = new RenderSystem();

// Register systems
systemRegistry.registerSystems(
  [movementSystem],      // Tick systems
  [renderSystem]         // Frame systems
);

// Create tick/frame manager
const tickManager = new TickFrameManager({
  tickRate: 60,  // 60 ticks per second
  maxFrameTime: 0.25  // Max 250ms per frame
});

// Hook up tick and frame processing
// onTick receives (tick, commands) - commands is empty in single-player mode
tickManager.onTick((tick, _commands) => {
  systemRegistry.processAllTicks(tick);
});

tickManager.onFrame((alpha, deltaTime) => {
  systemRegistry.updateAll(deltaTime);
  scene.render();
});

// Start the loop
tickManager.start();
```

### Multiplayer Mode (with Phalanx Client)

```typescript
import { PhalanxClient } from 'phalanx-client';
import { SystemRegistry } from 'phalanx-babylon-ecs';

// Initialize Phalanx Client
const client = new PhalanxClient({
  serverUrl: 'wss://your-server.com',
  // ... other config
});

// Create ECS
const systemRegistry = new SystemRegistry(engine, scene);
systemRegistry.createCoreDependencies();
systemRegistry.registerSystems(tickSystems, frameSystems);

// Use PhalanxClient for tick/frame management
client.onTick((tick, commandsBatch) => {
  // Execute network commands
  executeCommands(commandsBatch);

  // Process simulation tick
  systemRegistry.processAllTicks(tick);
});

client.onFrame((alpha, deltaTime) => {
  systemRegistry.updateAll(deltaTime);
  scene.render();
});

// Connect to match
await client.connect();
```

### Pluggable Architecture (ITickFrameProvider)

Both `TickFrameManager` and `PhalanxClient` implement the `ITickFrameProvider` interface,
so you can write game code that works with either:

```typescript
import { ITickFrameProvider, TickFrameManager, SystemRegistry } from 'phalanx-babylon-ecs';

// Choose provider at initialization time
function createGame(provider: ITickFrameProvider, systemRegistry: SystemRegistry, scene: Scene) {
  provider.onTick((tick, commands) => {
    // In single-player: commands is empty
    // In multiplayer: commands contains all players' inputs
    executeCommands(commands);
    systemRegistry.processAllTicks(tick);
  });

  provider.onFrame((alpha, dt) => {
    systemRegistry.updateAll(dt);
    scene.render();
  });
}

// Single-player:
const tickManager = new TickFrameManager({ tickRate: 60 });
createGame(tickManager, systemRegistry, scene);
tickManager.start();

// Multiplayer (PhalanxClient satisfies ITickFrameProvider):
// createGame(phalanxClient, systemRegistry, scene);
```## API Reference

### EntityManager

```typescript
class EntityManager {
  addEntity(entity: Entity): void
  removeEntity(entity: Entity): void
  getEntity(id: number): Entity | undefined
  queryEntities(...componentTypes: symbol[]): Entity[]
  queryEntitiesAny(...componentTypes: symbol[]): Entity[]
  cleanupDestroyed(): Entity[]
}
```

### SystemRegistry

```typescript
class SystemRegistry {
  createCoreDependencies(): void
  registerSystems(tickSystems: GameSystem[], frameSystems: GameSystem[]): void
  processAllTicks(tick: number): void
  updateAll(deltaTime: number): void
  getContext(): SystemContext
  dispose(): void
}
```

### EventBus

```typescript
class EventBus {
  on<T>(eventType: string, callback: (data: T) => void): UnsubscribeFunction
  once<T>(eventType: string, callback: (data: T) => void): UnsubscribeFunction
  off<T>(eventType: string, callback: (data: T) => void): void
  emit<T>(eventType: string, data: T): void
  clear(eventType: string): void
  clearAll(): void
}
```

### TickFrameManager

```typescript
class TickFrameManager implements ITickFrameProvider {
  constructor(config?: { tickRate?: number; maxFrameTime?: number })
  onTick(callback: (tick: number, commands: CommandsBatch) => void): Unsubscribe
  onFrame(callback: (alpha: number, deltaTime: number) => void): Unsubscribe
  start(): void
  stop(): void
  dispose(): void
}
```

### ITickFrameProvider

The shared interface that both `TickFrameManager` and `PhalanxClient` satisfy.
Game code should depend on this interface to allow easy switching between
single-player and multiplayer modes.

```typescript
interface ITickFrameProvider {
  onTick(handler: TickHandler): Unsubscribe;
  onFrame(handler: FrameHandler): Unsubscribe;
}

type TickHandler = (tick: number, commands: CommandsBatch) => void;
type FrameHandler = (alpha: number, dt: number) => void;
```

## Creating Custom Systems

```typescript
import { GameSystem, SystemContext } from 'phalanx-babylon-ecs';

class MySystem extends GameSystem {
  init(context: SystemContext): void {
    super.init(context);

    // Subscribe to events
    this.subscribe('MY_EVENT', (data) => {
      console.log('Event received:', data);
    });
  }

  processTick(tick: number): void {
    // Deterministic simulation logic
    const entities = this.entityManager.queryEntities(ComponentType.Movement);
    for (const entity of entities) {
      // Update entity
    }
  }

  update(deltaTime: number): void {
    // Visual updates, animations, interpolation
  }

  dispose(): void {
    super.dispose();
    // Clean up resources
  }
}
```

## License

MIT
