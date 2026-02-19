# Phalanx Babylon ECS

A lightweight Entity-Component-System (ECS) library for Babylon.js with optional multiplayer support via Phalanx Engine.

## Features

- **GameWorld Facade**: One-liner setup — construct, register systems, start
- **Pure ECS Architecture**: EntityManager, GameSystem, EventBus
- **Flexible Integration**: Use standalone or with Phalanx Client for multiplayer
- **TypeScript First**: Full type safety and excellent IDE support
- **Babylon.js Optimized**: Designed specifically for Babylon.js workflows
- **Deterministic Tick/Frame**: Separate tick-based simulation from frame-based rendering

## Core Components

### GameWorld (Recommended Entry Point)
- **GameWorld**: High-level facade — creates all core dependencies, wires tick/frame loops, provides convenience accessors

### Entity Management
- **Entity**: Abstract base class for all game objects
- **EntityManager**: Central registry with efficient component-based queries
- **IComponent**: Interface for all components

### System Architecture
- **GameSystem**: Base class for all game systems
- **SystemRegistry**: Low-level system lifecycle and execution order (used internally by GameWorld)
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

### Single-player Mode

```typescript
import { Engine, Scene } from '@babylonjs/core';
import { GameWorld } from 'phalanx-babylon-ecs';

// Create Babylon.js engine and scene
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);

// Create GameWorld (internally creates TickFrameManager)
const world = new GameWorld({
  engine,
  scene,
  tickRate: 60,        // optional, default 60
  maxFrameTime: 0.25,  // optional, default 0.25
});

// Create and register your systems
const movementSystem = new MovementSystem();
const renderSystem = new RenderSystem();

world.registerSystems(
  [movementSystem],  // Tick systems (deterministic)
  [renderSystem]     // Frame systems (visual)
);

// Start the game loop
// Automatically runs: processAllTicks(tick), updateAll(dt), scene.render()
world.start();
```

### Multiplayer Mode (with Phalanx Client)

```typescript
import { PhalanxClient } from 'phalanx-client';
import { GameWorld } from 'phalanx-babylon-ecs';

// Initialize Phalanx Client
const client = new PhalanxClient({
  serverUrl: 'wss://your-server.com',
  // ... other config
});

// Create GameWorld with external tick/frame provider
const world = new GameWorld({
  engine,
  scene,
  tickFrameProvider: client,
});

world.registerSystems(tickSystems, frameSystems);

// Start with lifecycle hooks (tick systems and frame systems run automatically)
world.start({
  beforeTick(tick, commandsBatch) {
    // Execute network commands before tick systems run
    lockstepManager.processTick(tick, commandsBatch);
  },
  afterTick(tick) {
    // Cleanup after tick systems have run
    cleanupDestroyedEntities();
  },
  beforeFrame(alpha, dt) {
    // Update camera before frame systems
    cameraController.update(dt);
  },
  afterFrame(alpha, dt) {
    // Interpolate after frame systems, before scene.render()
    interpolationSystem.interpolate(alpha);
  },
});

// Connect to match
await client.connect();
```

### Low-level API (SystemRegistry + ITickFrameProvider)

For advanced use-cases you can still use `SystemRegistry` and `ITickFrameProvider` directly:

```typescript
import { SystemRegistry, TickFrameManager } from 'phalanx-babylon-ecs';

const registry = new SystemRegistry(engine, scene, componentTypes);
registry.registerSystems(tickSystems, frameSystems);

const tickManager = new TickFrameManager({ tickRate: 60 });
tickManager.onTick((tick) => registry.processAllTicks(tick));
tickManager.onFrame((alpha, dt) => { registry.updateAll(dt); scene.render(); });
tickManager.start();
```## API Reference

### GameWorld

```typescript
class GameWorld {
  constructor(config: GameWorldConfig)

  // Convenience accessors
  get eventBus(): EventBus
  get entityManager(): EntityManager
  get context(): SystemContext
  getSystem<T extends GameSystem>(systemClass: new (...args: any[]) => T): T | undefined

  // System registration
  registerSystems(tickSystems: GameSystem[], frameSystems: GameSystem[]): void
  addFrameSystem(system: GameSystem): void

  // Tick / Frame delegation
  processAllTicks(tick: number): void
  updateAll(dt: number): void

  // Lifecycle
  start(hooks?: GameWorldHooks): void
  stop(): void
  dispose(): void
}

interface GameWorldConfig {
  engine: Engine
  scene: Scene
  componentTypes?: symbol[]
  tickRate?: number          // default 60
  maxFrameTime?: number      // default 0.25
  tickFrameProvider?: ITickFrameProvider  // e.g. PhalanxClient
}

interface GameWorldHooks {
  beforeTick?(tick: number, commands: CommandsBatch): void
  afterTick?(tick: number): void
  beforeFrame?(alpha: number, dt: number): void
  afterFrame?(alpha: number, dt: number): void
}
```

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

### SystemRegistry (Low-level)

```typescript
class SystemRegistry {
  constructor(engine: Engine, scene: Scene, componentTypes?: symbol[])
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
