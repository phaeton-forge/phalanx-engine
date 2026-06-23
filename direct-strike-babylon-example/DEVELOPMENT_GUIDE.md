# Development Guide

This guide explains the architectural approach used in the Babylon RTS Demo and provides instructions for adding new features.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Multiplayer Integration](#multiplayer-integration)
- [Core Concepts](#core-concepts)
  - [Entities](#entities)
  - [Components](#components)
  - [Systems](#systems)
  - [EventBus](#eventbus)
  - [EntityManager](#entitymanager)
- [Adding New Features](#adding-new-features)
  - [Adding a New Component](#adding-a-new-component)
  - [Adding a New Entity](#adding-a-new-entity)
  - [Adding a New System](#adding-a-new-system)
  - [Adding New Events](#adding-new-events)
- [Best Practices](#best-practices)

---

## Architecture Overview

This project uses a **component-based Entity-Component-System (ECS)** architecture with an **event-driven communication pattern** and **Single Responsibility Principle (SRP)** for core classes. It also supports **1v1 multiplayer** via the Phalanx Engine.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Game.ts (Thin Orchestrator)                         │
│                    Coordinates initialization & delegates to:                │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
    ┌─────────────┬─────────────┬─────┴─────┬─────────────┬─────────────┐
    │             │             │           │             │             │
    ▼             ▼             ▼           ▼             ▼             ▼
┌─────────┐ ┌───────────┐ ┌───────────┐ ┌─────────┐ ┌──────────┐ ┌─────────┐
│GameWorld│ │ Lockstep  │ │ GameEvent │ │  Game   │ │ Entity   │ │  Asset  │
│ (ECS)   │ │ Manager   │ │Coordinator│ │Initializer│ │Cleanup  │ │ Manager │
└────┬────┘ └─────┬─────┘ └─────┬─────┘ └────┬────┘ └────┬─────┘ └────┬────┘
     │            │             │            │           │            │
     │            │             │            │           │            │
     ▼            ▼             ▼            ▼           ▼            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             SystemContext                                    │
│           (Shared dependencies: EventBus, EntityManager, Scene)              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
            ┌─────────────────────────┼─────────────────────────┐
            │                         │                         │
            ▼                         ▼                         ▼
    ┌───────────────┐       ┌─────────────────┐       ┌───────────────────┐
    │ EntityManager │       │    EventBus     │       │   SceneManager    │
    │  (Registry)   │       │ (Communication) │       │ (Babylon.js Scene)│
    └───────────────┘       └─────────────────┘       └───────────────────┘
            │                         │
            │               ┌─────────┴─────────┐
            │               │                   │
            ▼               ▼                   ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                          Systems (extend GameSystem)                           │
│  CombatSystem │ MovementSystem │ HealthSystem │ FormationGridSystem │ ...     │
└───────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                              Entities                                          │
│        Unit        │  Tower  │  Base  │  ProjectileEntity (extends Entity)    │
│    ┌────────────────────────────────────────────────────────────────────────┐ │
│    │                          Components                                     │ │
│    │  TeamComponent │ HealthComponent │ AttackComponent │ ProjectileComponent │ │
│    └────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Core Classes (SRP)

| Class                    | Responsibility                                          |
| ------------------------ | ------------------------------------------------------- |
| `Game`                   | Thin orchestrator, coordinates initialization           |
| `GameWorld`              | ECS facade (systems, entities, events, tick/frame loop) |
| `SystemContext`          | Shared dependencies container for all systems           |
| `GameEventCoordinator`   | Game event subscriptions (victory, territory, waves)    |
| `GameInitializer`        | World setup, entity creation, asset preloading          |
| `EntityCleanupService`   | Destroyed entity cleanup and disposal                   |
| `AssetManager`           | 3D model preloading and instancing                      |
| `LockstepManager`        | Deterministic command execution                         |
| `EntityFactory`          | Entity creation with ownership tracking                 |
| `UIManager`              | UI updates, notifications, pause/resume, and drag interactions |

### Key Principles

1. **Composition over Inheritance**: Entities are composed of components rather than using deep inheritance hierarchies
2. **Decoupled Systems**: Systems communicate via EventBus, not direct references
3. **Single Responsibility**: Each system handles one aspect of game logic
4. **Data-Driven**: Components are primarily data containers; logic lives in systems

---

## Multiplayer Integration

The game supports **1v1 multiplayer** via the Phalanx Engine using **deterministic lockstep synchronization**. This ensures all clients simulate the exact same game state.

### Architecture

```
┌─────────────────┐         ┌─────────────────┐
│    Player 1     │         │    Player 2     │
│   (Client 1)    │         │   (Client 2)    │
└────────┬────────┘         └────────┬────────┘
         │                           │
         │    Commands + Ticks       │
         └─────────┬─────────────────┘
                   │
                   ▼
         ┌─────────────────┐
         │  Phalanx Server │
         │  (Tick Authority)│
         └─────────────────┘
```

### Lockstep Synchronization

The game uses **lockstep** synchronization where:

1. **Server** runs a tick clock (20 ticks/sec)
2. **Clients** send commands to server
3. **Server** broadcasts all commands to all clients at each tick
4. **Clients** execute commands and simulate deterministically

This ensures all clients see the exact same game state at all times.

### Key Components

| Component             | Location           | Purpose                                     |
| --------------------- | ------------------ | ------------------------------------------- |
| `PhalanxClient`       | phalanx-client     | Network connection, matchmaking, tick/frame |
| `GameWorld`           | phalanx-ecs| ECS facade, automatic tick/frame loop       |
| `LockstepManager`     | direct-strike      | Game-specific command execution              |
| `InterpolationSystem` | direct-strike      | Smooth visual movement between ticks        |

### GameWorld Tick/Frame Loop

The `GameWorld` manages the tick/frame loop and automatically runs all registered systems. You can inject custom logic via **lifecycle hooks**:

```typescript
import { GameWorld } from '@phalanx-engine/ecs';

// Create GameWorld with PhalanxClient as the tick/frame provider
const world = new GameWorld({
  componentTypes: Object.values(ComponentType),
  tickFrameProvider: client,  // PhalanxClient implements ITickFrameProvider
});

// Register tick and frame systems
world.registerSystems(tickSystems, frameSystems);

// Start the loop — systems run automatically!
// Pipeline per tick:  beforeTick → processAllTicks → afterTick
// Pipeline per frame: beforeFrame → updateAll → afterFrame
world.start({
  beforeTick(tick, commands) {
    // Snapshot positions BEFORE simulation for interpolation
    interpolationSystem.snapshotPositions();
    // Execute network commands before tick systems run
    lockstepManager.processTick(tick, commands);
  },
  afterTick(tick) {
    // Capture positions AFTER simulation
    interpolationSystem.captureCurrentPositions();
    // Cleanup destroyed entities
    lockstepManager.cleanup();
  },
  beforeFrame(alpha, dt) {
    // Update camera before frame systems
    cameraController.update(dt);
  },
  afterFrame(alpha, dt) {
    // Interpolate between tick positions for smooth visuals
    interpolationSystem.interpolate(alpha);
    // Render the scene (must be called manually in afterFrame)
    scene.render();
  },
});

// Send commands to server
client.sendCommand('move', { entityId: 1, targetX: 10, targetZ: 20 });
```

**Key Points:**
- `world.start(hooks?)` — Starts the loop. All registered systems run automatically.
- Tick systems (`processTick`) run at fixed rate (20 ticks/sec), deterministically
- Frame systems (`update`) run every render frame
- `scene.render()` must be called manually in the `afterFrame` hook — GameWorld does **not** call it automatically
- Lifecycle hooks (`beforeTick`, `afterTick`, `beforeFrame`, `afterFrame`) are optional — used to inject game-specific logic around the core pipeline
- Commands are sent via `client.sendCommand(type, data)` — automatically batched and synced

### LockstepManager

The `LockstepManager` handles deterministic command execution. It is called from `Game.ts` via GameWorld's `beforeTick` hook, **before** tick systems run automatically:

```typescript
// In Game.ts — setup via GameWorld lifecycle hooks
world.start({
  beforeTick(tick, commands) {
    lockstepManager.processTick(tick, commands);
  },
  afterTick(tick) {
    lockstepManager.cleanup();
  },
});

// LockstepManager.processTick() — command execution only
public processTick(_tick: number, commandsBatch: CommandsBatch): void {
  // Flatten commands from all players in deterministic order
  const allCommands: PlayerCommand[] = [];
  const sortedPlayerIds = Object.keys(commandsBatch.commands).sort();
  for (const playerId of sortedPlayerIds) {
    allCommands.push(...commandsBatch.commands[playerId]);
  }

  // Execute all commands for this tick
  this.executeTickCommands(allCommands);  // Execute move, placeUnit, etc.
}

// Tick systems (Physics, Combat, Projectiles, etc.) run automatically
// via GameWorld after beforeTick returns.

// LockstepManager.cleanup() — called via afterTick hook
public cleanup(): void {
  this.callbacks.onCleanupNeeded();
}
```

**Key Points:**
- Tick system processing is handled automatically by `GameWorld` — no manual `processAllTicks()` calls needed
- `LockstepManager` focuses solely on deterministic command execution
- Commands from **all players** are executed (no filtering)
- Cleanup runs in `afterTick`, after all tick systems have processed

### Visual Interpolation

To achieve smooth visuals at 60 FPS while simulating at 20 ticks/sec:

```
Simulation: |---Tick 0---|---Tick 1---|---Tick 2---|
                 50ms        50ms        50ms

Rendering:  |.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|
             16ms each (60 FPS)

Interpolation: Blends between tick positions based on alpha (0-1)
```

**Entity Position Architecture:**

The entity position system uses three layers for deterministic simulation with smooth rendering:

- `TransformComponent.fpPosition` - Authoritative fixed-point position (FPVector3, SoA-backed `i64` fields, deterministic across all platforms)
- `TransformComponent.visualPosition` - Cached Vector3 derived from fpPosition (for Babylon.js rendering)
- `entity.mesh.position` - Visual position on the actual mesh (set via `IMeshEntity.setVisualPosition()`, can be interpolated)

Position is stored in `TransformComponent` (a SoA component), NOT on the entity class itself. `Unit` is a thin class with only mesh and scene references.

```typescript
// TransformComponent.ts - SoA-backed position (authoritative + visual)
import { SoAComponent, defineSoASchema } from '@phalanx-engine/ecs';
import { FP, FPVector3, type FPVector3 as FPVector3Type } from '@phalanx-engine/math';

export const TransformSoASchema = defineSoASchema({
  fpPositionX: 'i64',       // BigInt64Array — deterministic fixed-point
  fpPositionY: 'i64',
  fpPositionZ: 'i64',
  visualPositionX: 'f64',   // Float64Array — for rendering
  visualPositionY: 'f64',
  visualPositionZ: 'f64',
}, 'Transform');

export class TransformComponent extends SoAComponent<typeof TransformSoASchema.definition> {
  // Facade getter — reads from SoA store
  public get fpPosition(): FPVector3Type {
    const idx = this.getIndex();
    this._fpPosition.x = FP.FromRaw(this.store.arrays.fpPositionX[idx]);
    this._fpPosition.y = FP.FromRaw(this.store.arrays.fpPositionY[idx]);
    this._fpPosition.z = FP.FromRaw(this.store.arrays.fpPositionZ[idx]);
    return this._fpPosition;
  }

  // Facade setter — writes to SoA store and syncs visual position
  public set fpPosition(value: FPVector3Type) {
    const idx = this.getIndex();
    this.store.arrays.fpPositionX[idx] = FP.ToRaw(value.x);
    this.store.arrays.fpPositionY[idx] = FP.ToRaw(value.y);
    this.store.arrays.fpPositionZ[idx] = FP.ToRaw(value.z);
    // Also update visual position
    this.store.arrays.visualPositionX[idx] = FP.ToFloat(value.x);
    this.store.arrays.visualPositionY[idx] = FP.ToFloat(value.y);
    this.store.arrays.visualPositionZ[idx] = FP.ToFloat(value.z);
  }
}

// Unit.ts - Thin entity class with mesh support (no position properties)
import { Entity } from '@phalanx-engine/ecs';
import type { IMeshEntity } from '../interfaces/IMeshEntity';

export class Unit extends Entity implements IMeshEntity {
  protected scene: Scene;
  protected mesh: Mesh | null = null;

  public setVisualPosition(value: Vector3): void {
    if (this.mesh) { this.mesh.position.copyFrom(value); }
  }
  public getMesh(): Mesh | null { return this.mesh; }
}
```

**Why Fixed-Point?**

JavaScript's `Number` type uses IEEE 754 floating-point, which can produce slightly different results on different platforms (Chrome vs Safari, Windows vs Mac, x86 vs ARM). Fixed-point math uses integer arithmetic with a fixed decimal scale, guaranteeing identical results everywhere - critical for lockstep synchronization.

### Command Flow

**Movement Commands (Networked):**

```
Player Right-Click → EventBus (MOVE_REQUESTED)
                           ↓
                     GameEventCoordinator intercepts
                           ↓
                              LockstepManager.queueCommand()
                                          ↓
                              client.sendCommand() (automatic flush)
                                          ↓
                              Server receives, broadcasts
                                          ↓
                              client.onTick() callback
                                          ↓
                              LockstepManager.executeTickCommands()
                                    ↓
                              MovementSystem.moveEntityTo()
```

**Unit Placement Commands (Networked):**

```
Player clicks unit button → FormationGridSystem
                                    ↓
                            EventBus (FORMATION_PLACEMENT_REQUESTED)
                                    ↓
                            LockstepManager.queueCommand()
                                    ↓
                            ... same network flow ...
                                    ↓
                            FormationGridSystem.placeUnit()
```

**Combat (Local, Deterministic):**

```
CombatSystem.processTick()
        ↓
    Query enemies in range
        ↓
    Attack if cooldown ready
        ↓
    Spawn projectile
        ↓
ProjectileSystem.processTick()
        ↓
    Move projectiles
        ↓
    Apply damage on hit
```

### Network Commands

Network commands are defined in `src/core/NetworkCommands.ts`:

```typescript
// Move command
interface NetworkMoveCommand extends PlayerCommand {
  type: 'move';
  data: { entityId: number; targetX: number; targetY: number; targetZ: number };
}

// Place unit command
interface NetworkPlaceUnitCommand extends PlayerCommand {
  type: 'placeUnit';
  data: { unitType: 'sphere' | 'mutant' | 'prisma' | 'lance'; gridX: number; gridZ: number };
}

// Deploy units command
interface NetworkDeployUnitsCommand extends PlayerCommand {
  type: 'deployUnits';
  data: { playerId: string };
}

// Move grid unit command
interface NetworkMoveGridUnitCommand extends PlayerCommand {
  type: 'moveGridUnit';
  data: { fromGridX: number; fromGridZ: number; toGridX: number; toGridZ: number };
}
```

### Adding New Network Commands

To add a new command type (e.g., a manual attack command), follow these steps:

1. **Define the command type** in `NetworkCommands.ts`:

```typescript
export interface AttackCommandData {
  attackerId: number;
  targetId: number;
}

export interface NetworkAttackCommand extends PlayerCommand {
  type: 'attack';
  data: AttackCommandData;
}

// Add to union type
export type NetworkCommand =
  | NetworkMoveCommand
  | NetworkPlaceUnitCommand
  | NetworkDeployUnitsCommand
  | NetworkMoveGridUnitCommand
  | NetworkAttackCommand;
```

2. **Handle in LockstepManager.executeTickCommands()**:

```typescript
if (cmd.type === 'attack') {
  const attackCmd = cmd as NetworkAttackCommand;
  // Implement your attack logic here
  // Note: Current CombatSystem handles attacks automatically via detection
  // You would need to add a method like forceAttackTarget() if needed
  const attacker = this.entityManager.getEntity(attackCmd.data.attackerId);
  const target = this.entityManager.getEntity(attackCmd.data.targetId);
  if (attacker && target) {
    // Set attack target via movement toward enemy
    this.systems.movementSystem.moveEntityTo(attacker.id, target.position);
  }
}
```

3. **Queue command from game code**:

```typescript
this.lockstepManager.queueCommand({
  type: 'attack',
  data: { attackerId: unit.id, targetId: enemy.id },
});
```

> **Note**: The current CombatSystem uses automatic target detection within range.
> Units attack automatically when enemies enter their detection range.
> Manual attack commands can be used to direct units toward specific targets.

### Game Flow

1. **Lobby Scene** (`src/scenes/LobbyScene.ts`)
   - Player enters username
   - Connects to Phalanx server
   - Joins matchmaking queue
   - Waits for opponent
   - Countdown before game starts

2. **Game Scene** (`src/core/Game.ts`)
   - Creates bases, towers, and units per player
   - Teams are hostile to each other
   - All game commands go through network
   - Deterministic simulation ensures sync

### Key Files

| File                                 | Purpose                                        |
| ------------------------------------ | ---------------------------------------------- |
| `src/scenes/LobbyScene.ts`           | Matchmaking UI and server connection           |
| `src/config/constants.ts`            | Server URL, tick rate, spawn positions, unit costs, camera, resources, waves |
| `src/core/Game.ts`                   | Thin orchestrator, coordinates all systems     |
| `src/core/GameEventCoordinator.ts`   | Game event subscriptions (victory, waves)      |
| `src/core/GameInitializer.ts`        | World setup and entity creation                |
| `src/core/EntityCleanupService.ts`   | Destroyed entity cleanup                       |
| `src/core/LockstepManager.ts`        | Deterministic command execution                |
| `src/core/NetworkCommands.ts`        | Network command type definitions               |
| `src/core/MathConversions.ts`        | Fixed-point ↔ Babylon.js vector conversions    |
| `src/core/AssetManager.ts`           | 3D model preloading and instancing             |
| `src/systems/InterpolationSystem.ts` | Smooth visual interpolation                    |

### Desync Detection

Desync detection ensures all clients maintain identical game state. When a desync is detected, the match can be ended gracefully rather than allowing players to continue with divergent game states.

#### How It Works

1. Each client computes a **state hash** after simulation ticks
2. Hashes are submitted to the server via `client.submitStateHash(tick, hash)`
3. Server compares hashes from all connected clients
4. If hashes differ, server broadcasts `hash-comparison` event
5. Client detects mismatch and emits `desync` event
6. Server can optionally end the match

#### Implementation in LockstepManager

Add hash computation and submission to your `LockstepManager`:

```typescript
import { StateHasher } from '@phalanx-engine/client';

export class LockstepManager {
  private hashInterval = 20; // Hash every 20 ticks (once per second)
  private client: PhalanxClient;
  private systems: LockstepSystems;
  private callbacks: LockstepCallbacks;

  constructor(
    client: PhalanxClient,
    systems: LockstepSystems,
    callbacks: LockstepCallbacks
  ) {
    this.client = client;
    this.systems = systems;
    this.callbacks = callbacks;

    // Handle desync events
    this.client.on('desync', (event) => {
      console.error(`Desync at tick ${event.tick}!`);
      console.error(`Local: ${event.localHash}`);
      console.error(`Remote:`, event.remoteHashes);
      // Optionally show UI notification
    });
  }

  /**
   * Process a tick with commands - called via GameWorld's beforeTick hook
   * Tick systems run automatically after this returns.
   */
  public processTick(tick: number, commandsBatch: CommandsBatch): void {
    // Execute all commands for this tick
    this.executeTickCommands(commandsBatch);
  }

  /**
   * Cleanup after tick systems have run - called via GameWorld's afterTick hook
   */
  public cleanup(): void {
    this.callbacks.onCleanupNeeded();
  }

  /**
   * Submit state hash - call from afterTick hook after cleanup
   */
  public submitHashIfNeeded(tick: number, entityManager: EntityManager): void {
    if (tick % this.hashInterval === 0) {
      const hash = this.computeStateHash(tick, entityManager);
      this.client.submitStateHash(tick, hash);
    }
  }

  private computeStateHash(tick: number, entityManager: EntityManager): string {
    const hasher = new StateHasher();

    // Add tick number
    hasher.addInt(tick);

    // Get all entities sorted by ID for deterministic ordering
    const entities = entityManager.getAllEntities()
      .sort((a, b) => a.id - b.id);

    hasher.addInt(entities.length);

    for (const entity of entities) {
      hasher.addInt(entity.id);

      // Hash position via TransformComponent
      const transform = entity.getComponent(ComponentType.Transform) as TransformComponent | undefined;
      if (transform) {
        const pos = transform.fpPosition;
        hasher.addFloat(FP.ToFloat(pos.x));
        hasher.addFloat(FP.ToFloat(pos.y));
        hasher.addFloat(FP.ToFloat(pos.z));
      }

      // Hash health (if has HealthComponent)
      const health = entity.getComponent(ComponentType.Health) as HealthComponent | undefined;
      if (health) {
        hasher.addInt(health.health);
        hasher.addInt(health.maxHealth);
      }

      // Hash movement state (if has MovementComponent)
      const movement = entity.getComponent(ComponentType.Movement) as MovementComponent | undefined;
      if (movement) {
        hasher.addBool(movement.isMoving);
        if (movement.isMoving) {
          const target = movement.targetPosition;
          hasher.addFloat(target.x);
          hasher.addFloat(target.y);
          hasher.addFloat(target.z);
        }
      }

      // Hash attack state (if has AttackComponent)
      const attack = entity.getComponent(ComponentType.Attack) as AttackComponent | undefined;
      if (attack) {
        hasher.addFloat(attack.currentCooldown);
        hasher.addBool(attack.canAttack());
      }
    }

    return hasher.finalize();
  }
}
```

The `processTick` and `cleanup` methods are called from `Game.ts` via the GameWorld's lifecycle hooks. Tick systems run automatically between them:

```typescript
// In Game.ts
world.start({
  beforeTick(tick, commands) {
    interpolationSystem.snapshotPositions();
    lockstepManager.processTick(tick, commands);
  },
  afterTick(tick) {
    interpolationSystem.captureCurrentPositions();
    lockstepManager.cleanup(); // cleanup destroyed entities
    // lockstepManager.submitHashIfNeeded(tick, entityManager); // when desync detection is enabled
  },
});
```

#### StateHasher Best Practices

1. **Always sort entities** by a stable ID before hashing
2. **Include only deterministic state** - no timestamps, no random values
3. **Use `TransformComponent.fpPosition`** for hashing positions (fixed-point for determinism)
4. **Include relevant game state** - health, targets, cooldowns, etc.
5. **Exclude visual-only state** - interpolated positions, particle effects

```typescript
// Good: Deterministic state via components
const transform = entity.getComponent(ComponentType.Transform) as TransformComponent;
const fpPos = transform.fpPosition;
hasher.addFloat(FP.ToFloat(fpPos.x)); // Fixed-point position (deterministic)
hasher.addFloat(FP.ToFloat(fpPos.y));
hasher.addFloat(FP.ToFloat(fpPos.z));
const health = entity.getComponent(ComponentType.Health) as HealthComponent;
hasher.addInt(health.health);            // Game state
hasher.addInt(entity.targetId ?? -1);    // Nullable with default

// Bad: Non-deterministic state
hasher.addFloat(Date.now());             // ❌ Time varies
hasher.addFloat(Math.random());          // ❌ Random
hasher.addFloat(entity.mesh.position.x); // ❌ Visual position (interpolated)
// Use TransformComponent.fpPosition instead of visual position for hashing
```

#### Handling Desync Events

```typescript
// In Game.ts or LockstepManager.ts
this.client.on('desync', (event) => {
  // Log for debugging
  console.error('=== DESYNC DETECTED ===');
  console.error(`Tick: ${event.tick}`);
  console.error(`Our hash: ${event.localHash}`);
  console.error(`All hashes:`, event.remoteHashes);

  // Show player notification
  this.showDesyncWarning();
});

this.client.on('matchEnd', (event) => {
  if (event.reason === 'desync') {
    // Match ended due to desync
    console.error('Match ended due to desync:', event.details);
    this.showDesyncEndScreen();
  }
});
```

#### Testing Desync Detection

To test desync detection during development:

```typescript
// Add to LockstepManager for testing
private computeStateHash(tick: number): string {
  const hasher = new StateHasher();
  // ... normal hash computation ...
  let hash = hasher.finalize();

  // TESTING ONLY: Force desync at tick 100 for player 1
  if (tick === 100 && this.client.getPlayerId() === 'test-player-1') {
    console.warn('⚠️ Intentionally causing desync for testing');
    hash = 'intentional-desync-hash';
  }

  return hash;
}
```

To verify desync detection is working:

1. Start two clients with different player IDs
2. One client should report the forced desync at tick 100
3. Check console for desync event logs
4. Verify match ends correctly (in production mode)

#### Server Configuration

Configure the Phalanx server for desync handling:

```typescript
// Server configuration
const phalanx = new Phalanx({
  enableStateHashing: true,    // Enable hash comparison
  stateHashInterval: 60,       // Server-side interval hint

  desync: {
    enabled: true,
    action: 'end-match',       // 'log-only' | 'end-match'
    gracePeriodTicks: 1,       // Consecutive desyncs before action
  },
});
```

| Option               | Description                              | Recommended      |
| -------------------- | ---------------------------------------- | ---------------- |
| `action: 'end-match'`| End match on confirmed desync            | Production       |
| `action: 'log-only'` | Log desync but continue playing          | Development      |
| `gracePeriodTicks`   | Allow N desyncs before taking action     | `1` (strict)     |

#### TODO: Integrate Desync Detection in Babylon-ECS

The following tasks need to be completed to fully integrate desync detection into the babylon-ecs test game:

- [ ] **Add `StateHasher` import to LockstepManager**
  - File: `src/core/LockstepManager.ts`
  - Import `StateHasher` from `phalanx-client`

- [ ] **Add `EntityManager` reference to LockstepManager**
  - Update constructor to accept `EntityManager`
  - Store reference for hash computation

- [ ] **Implement `computeStateHash()` method in LockstepManager**
  - Hash all entities sorted by ID
  - Include: position, health, movement state, attack cooldowns
  - Exclude: visual-only state (mesh positions, particles)

- [ ] **Call `submitStateHash()` in `afterTick` hook or in `cleanup()`**
  - Submit hash every N ticks (e.g., every 20 ticks = 1 second)
  - Must be called after tick systems have run (i.e., in `afterTick` or `cleanup()`)
  - Use configurable interval via `networkConfig`

- [ ] **Add desync event handler in Game.ts**
  - Listen for `client.on('desync', ...)` event
  - Show UI notification to player
  - Log details for debugging

- [ ] **Add match-end handler for desync reason**
  - Check `event.reason === 'desync'` in `matchEnd` handler
  - Show appropriate end screen with desync info

- [ ] **Add `hashInterval` to `networkConfig`**
  - File: `src/config/constants.ts`
  - Default: `20` (once per second at 20 TPS)

- [ ] **Enable state hashing on server**
  - Update your Phalanx server configuration
  - Set `enableStateHashing: true`
  - Configure `desync.action` based on environment

- [ ] **Test desync detection**
  - Add debug flag to intentionally cause desync
  - Verify desync is detected and reported
  - Verify match ends correctly (in production mode)

### Math Conversions

The `MathConversions.ts` utility provides functions to convert between `phalanx-math` fixed-point types and Babylon.js vectors. This is essential for bridging deterministic simulation with visual rendering.

#### Available Functions

```typescript
import {
  fpToVector3,           // FPVector3 → Vector3 (allocates new)
  fpToVector3Ref,        // FPVector3 → Vector3 (writes to existing, no allocation)
  vector3ToFp,           // Vector3 → FPVector3 (for user input, initialization)
  lerpVector3FromFp,     // Interpolate FPVector3 → Vector3 (allocates new)
  lerpVector3FromFpRef,  // Interpolate FPVector3 → Vector3 (no allocation)
  fpToVector2,           // FPVector2 → Vector2
  fpToVector2Ref,        // FPVector2 → Vector2 (no allocation)
  vector2ToFp,           // Vector2 → FPVector2
  fpVector2ToVector3XZ,  // FPVector2 → Vector3 (on XZ plane)
  fpVector2ToVector3XY,  // FPVector2 → Vector3 (on XY plane)
  vector3XZToFpVector2,  // Vector3 XZ → FPVector2
  lerpVector2FromFp,     // Interpolate FPVector2 → Vector2 (allocates new)
  lerpVector2FromFpRef,  // Interpolate FPVector2 → Vector2 (no allocation)
  fpToNumber,            // FixedPoint → number
  numberToFp,            // number → FixedPoint
} from './core/MathConversions';
```

#### Usage Examples

```typescript
// Convert fixed-point position to Babylon Vector3 for rendering
const transform = entity.getComponent<TransformComponent>(ComponentType.Transform)!;
const renderPos = fpToVector3(transform.fpPosition);

// Interpolate between two fixed-point positions for smooth visuals (no allocation)
lerpVector3FromFpRef(prevFpPos, currFpPos, alpha, visualPosition);

// Convert user input (Vector3) to fixed-point for simulation
const fpTarget = vector3ToFp(clickPosition);
```

#### Performance Tips

- Use `*Ref` variants in hot paths (like render loops) to avoid GC pressure
- Pre-allocate Vector3 objects and reuse them
- Only convert to float at the last moment before rendering

### Configuration

Edit `src/config/constants.ts` to change:

- `SERVER_URL` - Phalanx server address
- `authConfig` - Google OAuth client settings
- `networkConfig.tickRate` - Simulation tick rate (must match server)
- `networkConfig.physicsSubsteps` - Physics sub-steps per tick (default: 3)
- `pauseConfig` - Max pauses per player, resume rules
- `cameraConfig` - RTS camera height, speed, and bounds
- `resourceConfig` - Starting resources and generation rate
- `unitConfig` - Unit costs, health, damage, speed stats for each unit type
- `waveConfig` - Wave duration and staggered deployment settings
- `arenaParams` - Arena dimensions, starting positions for bases and towers
- `UNITS_PER_PLAYER` / `TOWERS_PER_PLAYER` - Per-team entity counts
- `TEAM1_SPAWN` / `TEAM2_SPAWN` - Per-team spawn positions

---

## Core Concepts

### Entities

Entities are containers for components. The base `Entity` class lives in `phalanx-ecs` and provides:

- A unique `id`
- A `Map` of components
- Lifecycle methods (`destroy()`, `dispose()`)

The game-specific base class is `Unit` (in `src/entities/Unit.ts`), which extends `Entity` and adds Babylon.js integration:

- A reference to the Babylon.js `Scene`
- A visual `Mesh`
- Visual position management via `setVisualPosition()` (implements `IMeshEntity`)

Both `Unit` and `ProjectileEntity` implement the `IMeshEntity` interface, which enables `InterpolationSystem` to apply interpolated positions to any entity with a mesh without coupling to a specific class.

**Entity Base Class** (from `phalanx-ecs`):

```typescript
export class Entity {
  public readonly id: number;
  protected components: Map<symbol, IComponent> = new Map();

  // Component management
  addComponent<T extends IComponent>(component: T): T;
  getComponent<T extends IComponent>(type: symbol): T | undefined;
  hasComponent(type: symbol): boolean;
  hasComponents(...types: symbol[]): boolean;
  removeComponent(type: symbol): boolean;

  // Lifecycle
  public get isDestroyed(): boolean;
  public destroy(): void;
  public dispose(): void;
}
```

**Unit Game Class** (`src/entities/Unit.ts`):

```typescript
import { Entity } from '@phalanx-engine/ecs';
import type { IMeshEntity } from '../interfaces/IMeshEntity';

export class Unit extends Entity implements IMeshEntity {
  protected scene: Scene;
  protected mesh: Mesh | null = null;

  public setVisualPosition(value: Vector3): void { ... }
  public getMesh(): Mesh | null { ... }
}
```

**IMeshEntity Interface** (`src/interfaces/IMeshEntity.ts`):

```typescript
export interface IMeshEntity {
  setVisualPosition(position: Vector3): void;
  getMesh(): Mesh | null;
}
```
```

**Existing Entities**:

- `Unit` - Base game entity class with Babylon.js mesh, position management, and components (extends `Entity` from `phalanx-ecs`)
- `Base` - Player base (win condition), extends `Unit`
- `Tower` - Stationary defense structure with health, attack, and team, extends `Unit`
- `PrismaUnit` - Heavy combat unit (2x2 grid), extends `Unit`
- `LanceUnit` - Elongated combat unit (1x2 grid), extends `Unit`
- `MutantUnit` - Animated 3D model melee unit, extends `Unit`
- `ProjectileEntity` - Projectile entity with laser beam mesh, extends `Entity` directly (implements `IMeshEntity`)

---

### Components

Components are data containers attached to entities. There are two types:

#### Standard Components (IComponent)

Simple class-based components for infrequently-accessed or complex data. Implement `IComponent` and store data in regular properties.

**Use for:** flags, configuration, UI state, components with few instances, complex/polymorphic data.

**Existing standard components:**

| Component                | Purpose                          | Key Properties                               |
| ------------------------ | -------------------------------- | -------------------------------------------- |
| `TeamComponent`          | Team affiliation                 | `team: TeamTag`, `isHostileTo()`             |
| `HealthComponent`        | Health management                | `health`, `maxHealth`, `takeDamage()`        |
| `AttackComponent`        | Attack capabilities              | `range`, `damage`, `cooldown`, `canAttack()` |
| `MovementComponent`      | Movement capabilities            | `speed`, `targetPosition`, `moveTo()`        |
| `ResourceComponent`      | Resource generation              | `resourceRate`, `lastGenerationTick`         |
| `UnitTypeComponent`      | Unit type identifier             | `unitType`                                   |
| `HealthBarComponent`     | Health bar visualization         | `healthBar`, `offset`                        |
| `InterpolationComponent` | Visual interpolation state       | `previousFpPosition`, `currentFpPosition`, `visualPosition`, `active` |
| `AnimationComponent`     | 3D model animation state         | `animationGroups`, `currentAnimation`        |
| `RotationComponent`      | Entity rotation toward targets   | `rotationSpeed`                              |
| `AttackLockComponent`    | Attack lock state                | `lockedTargetId`                             |
| `DeathComponent`         | Death animation/cleanup state    | `deathTime`                                  |
| `ProjectileComponent`    | Projectile simulation state      | `fpDirection`, `fpSpeed`, `damage`, `remainingTicks`, `sourceId` |

**Example:**

```typescript
import type { IComponent } from './Component';
import { ComponentType } from './Component';

export class HealthComponent implements IComponent {
  public readonly type = ComponentType.Health;
  private _health: number;
  constructor(maxHealth: number = 100) { this._health = maxHealth; }
  public get health(): number { return this._health; }
}
```

#### SoA Components (SoAComponent)

Components backed by contiguous typed arrays for cache-friendly hot-path iteration. Extend `SoAComponent` from `phalanx-ecs` and define a schema mapping field names to typed-array element types.

**Use for:** data iterated every tick in hot loops (physics, transforms, velocities), components with many instances (hundreds/thousands of entities), flat numeric fields that benefit from cache-friendly memory layout, deterministic fixed-point storage via `BigInt64Array` (`'i64'` fields).

**Avoid for:** complex data (nested objects, strings, variable-length arrays), components with very few instances, components that are rarely queried.

**Existing SoA components:**

| Component              | Schema Fields                                                                  | Purpose                              |
| ---------------------- | ------------------------------------------------------------------------------ | ------------------------------------ |
| `TransformComponent`   | `fpPositionX/Y/Z` (`i64`), `visualPositionX/Y/Z` (`f64`)                      | Entity position (authoritative + visual) |
| `PhysicsBodyComponent` | `velocityX/Y/Z` (`i64`), `radius` (`i64`), `mass` (`i64`), `restitution` (`i64`), `friction` (`i64`), `isStatic` (`u8`), `ignorePhysics` (`u8`), `lastX/Z` (`f64`) | Physics simulation data (from `phalanx-physics`) |

**Example (custom SoA component):**

```typescript
import { SoAComponent, defineSoASchema } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';

// Define a schema — each field maps to a typed array
const TransformSoASchema = defineSoASchema({
  fpPositionX: 'i64',   // BigInt64Array — raw FixedPoint
  fpPositionY: 'i64',
  fpPositionZ: 'i64',
  visualPositionX: 'f64', // Float64Array — visual cache
  visualPositionY: 'f64',
  visualPositionZ: 'f64',
}, 'Transform');
```

> **Note:** `PhysicsBodyComponent` and `PhysicsSoASchema` are provided by the `phalanx-physics` package and re-exported from `components/index.ts`. You do not need to define them — just import and use them.

**Direct store access for hot-path systems:**

Systems should bypass the component facade and access SoA stores directly for maximum performance.
The facade (getters/setters) is convenient for infrequent access (e.g., spawning, event handlers), but
in hot loops the repeated `Map.get()` + index validation per field access negates the cache benefits.

**Pattern: cache store references in `init()`, iterate `entityIds()` in hot methods:**

```typescript
import { GameSystem, SoAComponentStore } from '@phalanx-engine/ecs';
import { PhysicsSoASchema, TransformSoASchema } from '../components';

class MovementSystem extends GameSystem {
  // Cache store references — resolved once
  private physicsStore!: SoAComponentStore<typeof PhysicsSoASchema.definition>;
  private transformStore!: SoAComponentStore<typeof TransformSoASchema.definition>;

  public override init(context: SystemContext): void {
    super.init(context);
    // getOrCreateSoAStore ensures the store exists even before entities are spawned
    this.physicsStore = this.entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    this.transformStore = this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  public override processTick(tick: number): void {
    // Grab typed array references outside the loop
    const velocityX = this.physicsStore.arrays.velocityX;
    const velocityZ = this.physicsStore.arrays.velocityZ;

    const zeroRaw = FP.ToRaw(FP._0);

    // Iterate in deterministic entity ID order
    for (const entityId of this.physicsStore.entityIds()) {
      const physIndex = this.physicsStore.indexOf(entityId);
      if (this.physicsStore.arrays.isStatic[physIndex] === 1) continue;

      const entity = this.entityManager.getEntity(entityId);
      if (!entity) continue;

      // AoS fallback — get movement target from IComponent
      const movement = entity.getComponent<MovementComponent>(ComponentType.Movement);
      if (movement?.isMoving) {
        // Cross-store lookup for position (to compute direction)
        const txIndex = this.transformStore.indexOf(entityId);
        if (txIndex === -1) continue;

        const posX = FP.FromRaw(this.transformStore.arrays.fpPositionX[txIndex]);
        const posZ = FP.FromRaw(this.transformStore.arrays.fpPositionZ[txIndex]);
        // ... compute direction, set velocity
        velocityX[physIndex] = FP.ToRaw(FP.Mul(dirX, speed));
        velocityZ[physIndex] = FP.ToRaw(FP.Mul(dirZ, speed));
      } else {
        velocityX[physIndex] = zeroRaw;
        velocityZ[physIndex] = zeroRaw;
      }
    }
  }
}
```

**Key rules for direct SoA access in systems:**

1. **Cache array references** outside the loop (`const velocityX = store.arrays.velocityX`).
2. **Use `entityIds()`** for deterministic iteration (sorted by entity ID — required for lockstep).
3. **Cross-store lookup** via `indexOf(entityId)` when two stores track the same entities (e.g., physics + transform). This is one `Map.get()` per entity, versus the facade's `Map.get()` per field access.
4. **AoS fallback** for non-SoA components: when a hot loop also needs an AoS component (e.g., `MovementComponent`), get the entity via `entityManager.getEntity(entityId)` and access the AoS component normally. This is a hybrid pattern.
5. **Single-store loops** are the ideal case — iterate dense indices with zero indirection.
6. **Sync visual positions** when writing fp positions directly (the facade setter does this automatically, but direct writes must do it manually).

See `MovementSystem.ts` for a complete real-world example of direct SoA access patterns.

> **Note:** Velocity integration and collision resolution are handled by `PhysicsSystem` and `CollisionSystem` from the `phalanx-physics` package. Game-specific systems like `MovementSystem` only need to set velocities — the physics pipeline takes care of the rest.

#### SoA Field Types

| Type   | TypedArray       | JS Value  | Use Case                                |
| ------ | ---------------- | --------- | --------------------------------------- |
| `f64`  | `Float64Array`   | `number`  | Floating-point values, visual positions |
| `f32`  | `Float32Array`   | `number`  | Lower-precision floats                  |
| `i32`  | `Int32Array`     | `number`  | Signed integers                         |
| `u32`  | `Uint32Array`    | `number`  | Unsigned integers                       |
| `u8`   | `Uint8Array`     | `number`  | Flags, booleans (0/1)                   |
| `i64`  | `BigInt64Array`  | `bigint`  | Fixed-point raw values (deterministic)  |

#### When to Choose Which

| Criterion                        | IComponent           | SoAComponent         |
| -------------------------------- | -------------------- | -------------------- |
| Iterated every tick in hot loop  | ❌                    | ✅                    |
| Hundreds/thousands of instances  | ❌                    | ✅                    |
| Flat numeric fields              | Either               | ✅                    |
| Complex/nested data              | ✅                    | ❌                    |
| Few instances                    | ✅                    | ❌                    |
| Needs deterministic i64 storage  | ❌                    | ✅                    |
| Simple to implement              | ✅                    | Moderate              |

---

### Systems

Systems contain game logic and operate on entities with specific component combinations. All systems extend the `GameSystem` base class from `phalanx-ecs`, which provides:

- Access to `SystemContext` (EventBus, EntityManager)
- Automatic event subscription cleanup via `subscribe()` helper
- Optional `processTick(tick)` for deterministic simulation
- Optional `update(deltaTime)` for frame-based rendering
- `enabled` flag to temporarily disable systems

**GameSystem Base Class** (from `phalanx-ecs`):

```typescript
export abstract class GameSystem {
  protected context!: SystemContext;
  
  // Convenience accessors
  protected get eventBus(): EventBus { return this.context.eventBus; }
  protected get entityManager(): EntityManager { return this.context.entityManager; }
  
  public enabled: boolean = true;
  
  // Called after all systems are created
  public init(context: SystemContext): void { ... }
  
  // Deterministic tick-based logic (optional)
  public processTick(_tick: number): void { }
  
  // Frame-based visual updates (optional)
  public update(_deltaTime: number): void { }
  
  // Subscribe with automatic cleanup on dispose (returns unsubscribe function)
  protected subscribe<T>(event: string, handler: (event: T) => void): () => void { ... }
  
  // Subscribe once with automatic cleanup
  protected subscribeOnce<T>(event: string, handler: (event: T) => void): () => void { ... }
  
  // Concrete dispose - auto-unsubscribes all events. Override and call super.dispose()
  public dispose(): void { ... }
}
```

**Using SystemContext to Access Other Systems**:

```typescript
// In any system, get a reference to another system
const movementSystem = this.context.getSystem(MovementSystem);
if (movementSystem) {
  movementSystem.moveEntity(entityId, targetPosition);
}
```

**Existing Systems**:

| System                | Responsibility                         | Required Components  |
| --------------------- | -------------------------------------- | -------------------- |
| `CombatSystem`        | Target detection, attack logic         | Attack, Team, Health |
| `MovementSystem`      | Set velocities for moving entities     | Movement, PhysicsBody |
| `HealthSystem`        | Damage processing, entity destruction  | Health               |
| `PhysicsSystem`       | Velocity integration (from `phalanx-physics`) | PhysicsBody, Transform |
| `CollisionSystem`     | Collision detection & resolution (from `phalanx-physics`) | PhysicsBody, Transform |
| `ProjectileSystem`    | Projectile movement and collision      | Projectile, Team, Transform |
| `InterpolationSystem` | Smooth visual movement between ticks   | Interpolation        |
| `ResourceSystem`      | Resource generation and spending       | -                    |
| `TerritorySystem`     | Territory control and aggression bonus | Team                 |
| `FormationGridSystem` | Unit placement grid                    | -                    |
| `WaveSystem`          | Wave-based unit deployment             | -                    |
| `VictorySystem`       | Win/lose conditions                    | -                    |
| `AnimationSystem`     | 3D model animations                    | -                    |
| `RotationSystem`      | Entity rotation toward movement        | Movement             |
| `HealthBarSystem`     | Health bar rendering                   | HealthBar            |

**Core Managers**:

| Manager           | Responsibility                                     |
| ----------------- | -------------------------------------------------- |
| `LockstepManager` | Deterministic command execution                    |
| `EntityFactory`   | Entity creation with ownership tracking            |
| `UIManager`       | UI updates and notifications                       |

---

### EventBus

The `EventBus` enables decoupled communication between systems using a publish-subscribe pattern.

**Usage**:

```typescript
// Subscribe to an event
const unsubscribe = eventBus.on<MoveRequestedEvent>(
  GameEvents.MOVE_REQUESTED,
  (event) => {
    console.log(`Move to: ${event.target}`);
  }
);

// Emit an event
eventBus.emit<MoveRequestedEvent>(GameEvents.MOVE_REQUESTED, {
  ...createEvent(),
  entityId: 1,
  target: new Vector3(10, 0, 5),
});

// Unsubscribe when done
unsubscribe();
```

**Event Categories** (defined in `src/events/GameEvents.ts`):

- **Combat**: `ATTACK_REQUESTED`, `PROJECTILE_SPAWNED`, `PROJECTILE_HIT`
- **Health**: `DAMAGE_REQUESTED`, `DAMAGE_APPLIED`, `HEAL_REQUESTED`, `ENTITY_DYING`, `ENTITY_DESTROYED`
- **Movement**: `MOVE_REQUESTED`, `MOVE_STARTED`, `MOVE_COMPLETED`, `STOP_REQUESTED`
- **Input**: `LEFT_CLICK`, `RIGHT_CLICK`, `GROUND_CLICKED`
- **Lifecycle**: `ENTITY_CREATED`, `ENTITY_DISPOSED`
- **UI**: `SHOW_DESTINATION_MARKER`, `HIDE_DESTINATION_MARKER`, `UI_RESOURCES_UPDATED`, `UI_FORMATION_UPDATED`
- **Resource**: `RESOURCES_CHANGED`, `RESOURCES_GENERATED`, `UNIT_PURCHASE_REQUESTED`, `UNIT_PURCHASE_COMPLETED`, `UNIT_PURCHASE_FAILED`
- **Territory**: `TERRITORY_CHANGED`, `AGGRESSION_BONUS_ACTIVATED`, `AGGRESSION_BONUS_DEACTIVATED`
- **Game State**: `GAME_STARTED`, `GAME_OVER`, `BASE_DESTROYED`, `TOWER_DESTROYED`
- **Formation**: `FORMATION_MODE_ENTERED`, `FORMATION_MODE_EXITED`, `FORMATION_PLACEMENT_REQUESTED`, `FORMATION_PLACEMENT_FAILED`, `FORMATION_UNIT_PLACED`, `FORMATION_UNIT_REMOVED`, `FORMATION_COMMITTED`, `FORMATION_UPDATE_MODE_ENTERED`, `FORMATION_UPDATE_MODE_EXITED`, `FORMATION_UNIT_MOVE_REQUESTED`, `FORMATION_UNIT_MOVED`
- **Wave**: `WAVE_STARTED`, `WAVE_COUNTDOWN`, `WAVE_DEPLOYMENT`
- **Animation**: `PLAY_ATTACK_ANIMATION`, `PLAY_DEATH_ANIMATION`, `SHOW_BLOOD_EFFECT`, `ORIENT_TO_TARGET`, `NOTIFY_MOVEMENT_STARTED`, `END_COMBAT`, `ORIENT_TO_MOVEMENT_DIRECTION`

---

### EntityManager

The `EntityManager` is a central registry that provides efficient component-based queries.

**Key Methods**:

```typescript
// Register/remove entities
entityManager.addEntity(entity);
entityManager.removeEntity(entity);

// Query entities by components
const combatants = entityManager.queryEntities(
  ComponentType.Attack,
  ComponentType.Health
);

// Get all entities
const all = entityManager.getAllEntities();

// Get specific entity
const entity = entityManager.getEntity(id);
```

---

## Adding New Features

### Adding a New Component

#### Standard Component (IComponent)

Use this for simple, infrequently-iterated, or complex data.

1. **Create the component file** in `src/components/`:

```typescript
// src/components/ArmorComponent.ts
import type { IComponent } from './Component';
import { ComponentType } from './Component';

export class ArmorComponent implements IComponent {
  public readonly type = ComponentType.Armor;

  private _armor: number;

  constructor(armor: number = 10) {
    this._armor = armor;
  }

  public get armor(): number {
    return this._armor;
  }

  public reducesDamage(incomingDamage: number): number {
    return Math.max(0, incomingDamage - this._armor);
  }
}
```

2. **Register the component type** in `src/components/Component.ts`:

```typescript
export const ComponentType = createComponentTypeRegistry({
  // ...existing types
  Armor: 'Armor', // Add new type
});
```

3. **Export from index** in `src/components/index.ts`:

```typescript
export * from './ArmorComponent';
```

4. **Add to entities** that need it:

```typescript
this.addComponent(new ArmorComponent(5));
```

#### SoA Component (SoAComponent)

Use this for hot-path numeric data iterated every tick with many instances.

1. **Create the component file** in `src/components/`:

```typescript
// src/components/SteeringComponent.ts
import { SoAComponent, defineSoASchema } from '@phalanx-engine/ecs';
import { ComponentType } from './Component';
import { FP, type FixedPoint } from '@phalanx-engine/math';

export const SteeringSoASchema = defineSoASchema({
  desiredVelocityX: 'i64', // BigInt64Array for deterministic fixed-point
  desiredVelocityZ: 'i64',
  weight: 'f64',           // Float64Array for non-deterministic visual weight
  isActive: 'u8',          // Uint8Array for boolean flag
}, 'Steering');

export class SteeringComponent extends SoAComponent<typeof SteeringSoASchema.definition> {
  public readonly type = ComponentType.Steering;
  static readonly soaSchema = SteeringSoASchema;

  constructor(entityId: number) {
    super(SteeringSoASchema, entityId, {
      desiredVelocityX: FP.ToRaw(FP._0),
      desiredVelocityZ: FP.ToRaw(FP._0),
      weight: 1.0,
      isActive: 1,
    });
  }

  public get desiredVelocityX(): FixedPoint {
    return FP.FromRaw(this.store.arrays.desiredVelocityX[this.getIndex()]);
  }

  public set desiredVelocityX(value: FixedPoint) {
    this.store.arrays.desiredVelocityX[this.getIndex()] = FP.ToRaw(value);
  }
}
```

2. **Register the component type** (same as standard):

```typescript
export const ComponentType = createComponentTypeRegistry({
  // ...existing types
  Steering: 'Steering',
});
```

3. **Export and add to entities** (same as standard).

4. **Access in hot-path systems** — bypass the component wrapper:

```typescript
// In SteeringSystem.processTick()
const store = this.entityManager.getSoAStore(SteeringSoASchema);
for (const entityId of store.entityIds()) {
  const idx = store.indexOf(entityId);
  if (store.arrays.isActive[idx] === 0) continue;
  // Direct typed-array access for maximum performance
  const dvx = store.arrays.desiredVelocityX[idx];
  // ... compute steering forces
}
```

> **Note:** SoA stores are lazily created when the first component of that schema is constructed. No manual store registration is needed — `GameWorld` handles the `EntityManager` context automatically.

---

### Adding a New Entity

1. **Create the entity file** in `src/entities/`:

```typescript
// src/entities/Building.ts
import {
  Scene,
  Vector3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
} from '@babylonjs/core';
import { Unit } from './Unit';
import { ComponentType, TeamComponent, HealthComponent } from '../components';
import { TeamTag } from '../enums/TeamTag';

export interface BuildingConfig {
  team: TeamTag;
  health?: number;
  color?: Color3;
}

export class Building extends Unit {
  constructor(scene: Scene, config: BuildingConfig, position: Vector3) {
    super(scene);

    // Create visual mesh
    this.mesh = this.createMesh(config.color ?? new Color3(0.5, 0.5, 0.5));
    this.mesh.position = position;

    // Add components
    this.addComponent(new TeamComponent(config.team));
    this.addComponent(new HealthComponent(config.health ?? 200));
  }

  private createMesh(color: Color3): Mesh {
    const mesh = MeshBuilder.CreateBox(
      `building_${this.id}`,
      { size: 3 },
      this.scene
    );
    const material = new StandardMaterial(`buildingMat_${this.id}`, this.scene);
    material.diffuseColor = color;
    mesh.material = material;
    return mesh;
  }

  public dispose(): void {
    this.mesh?.dispose();
    super.dispose();
  }
}
```

2. **Add creation method** to `SceneManager.ts`:

```typescript
public createBuilding(config: BuildingConfig, position: Vector3): Building {
    return new Building(this.scene, config, position);
}
```

3. **Register in `Game.ts`**:

```typescript
private createBuilding(config: BuildingConfig, position: Vector3): Building {
    const building = this.sceneManager.createBuilding(config, position);
    this.entityManager.addEntity(building);
    return building;
}
```

---

### Adding a New System

Systems should extend the `GameSystem` base class for consistent lifecycle management and automatic cleanup.

1. **Create the system file** in `src/systems/`:

```typescript
// src/systems/BuffSystem.ts
import { GameSystem } from '@phalanx-engine/ecs';
import type { SystemContext } from '@phalanx-engine/ecs';
import { ComponentType } from '../components';
import { GameEvents, createEvent } from '../events';
import type { EntityDestroyedEvent } from '../events';

export class BuffSystem extends GameSystem {
  /**
   * Initialize the system - called after all systems are created
   */
  public init(context: SystemContext): void {
    super.init(context);
    
    // Subscribe to events with automatic cleanup
    this.subscribe<EntityDestroyedEvent>(
      GameEvents.ENTITY_DESTROYED,
      (event) => this.handleEntityDestroyed(event)
    );
  }

  /**
   * Deterministic tick-based logic (optional)
   * Called once per network tick from LockstepManager
   */
  public processTick(tick: number): void {
    if (!this.enabled) return;
    
    // Query entities with Buff component
    const buffedEntities = this.entityManager.queryEntities(
      ComponentType.Buff
    );
    
    for (const entity of buffedEntities) {
      // Process buff expiration, etc.
    }
  }

  /**
   * Frame-based visual updates (optional)
   * Called every render frame
   */
  public update(deltaTime: number): void {
    if (!this.enabled) return;
    
    // Update buff visual effects, particles, etc.
  }

  private handleEntityDestroyed(event: EntityDestroyedEvent): void {
    // Clean up buff data for destroyed entity
  }

  /**
   * Cleanup - must call super.dispose() for auto-cleanup
   */
  public dispose(): void {
    // Custom cleanup here
    super.dispose(); // Auto-unsubscribes all events
  }
}
```

2. **Register in GameWorld** (in `Game.ts`):

```typescript
// Create the system
const buffSystem = new BuffSystem();

// Register with GameWorld
// Tick systems run deterministically (order matters!)
// Frame systems run every render frame
// Both are called automatically when world.start() is called
world.registerSystems(
  [/* other tick systems */, buffSystem],  // tickSystems (if needed)
  [/* other frame systems */, buffSystem]  // frameSystems (if needed)
);
```

3. **Access from other systems via SystemContext**:

```typescript
// In another system
const buffSystem = this.context.getSystem(BuffSystem);
if (buffSystem) {
  buffSystem.applyBuff(entity, buffType);
}
```

---

### Adding New Events

1. **Define the event type** in `src/events/EventTypes.ts`:

```typescript
export interface ResourceCollectedEvent extends GameEvent {
  entityId: number;
  resourceType: string;
  amount: number;
}
```

2. **Add event constant** in `src/events/GameEvents.ts`:

```typescript
export const GameEvents = {
  // ...existing events
  RESOURCE_COLLECTED: 'resource:collected',
} as const;
```

3. **Export from index** in `src/events/index.ts`:

```typescript
export type { ResourceCollectedEvent } from './EventTypes';
```

4. **Use in systems**:

```typescript
// Emit
this.eventBus.emit<ResourceCollectedEvent>(GameEvents.RESOURCE_COLLECTED, {
  ...createEvent(),
  entityId: entity.id,
  resourceType: 'gold',
  amount: 50,
});

// Subscribe
this.eventBus.on<ResourceCollectedEvent>(
  GameEvents.RESOURCE_COLLECTED,
  (event) => {
    console.log(`Collected ${event.amount} ${event.resourceType}`);
  }
);
```

---

## Best Practices

### Multiplayer / Lockstep Design

- ✅ All gameplay-affecting logic must be **deterministic**
- ✅ Use `processTick()` methods instead of frame-based `update(deltaTime)`
- ✅ Send commands through `LockstepManager.queueCommand()`
- ✅ Execute commands in the `beforeTick` hook, before tick systems run
- ✅ Sort entity queries by ID for deterministic iteration order
- ✅ Use `TransformComponent.fpPosition` (fixed-point) for all simulation calculations
- ✅ Use `phalanx-math` FP functions for arithmetic (distances, lerp, etc.)
- ❌ Never use `Math.random()` - use seeded PRNG if needed
- ❌ Never use `Date.now()` or real time in simulation logic
- ❌ Never execute commands immediately on input - queue them
- ❌ Never use visual/float positions for deterministic calculations
- ❌ Never call `processAllTicks()` or `updateAll()` manually — `GameWorld.start()` handles it

### Interpolation Design

- ✅ Separate `TransformComponent.fpPosition` (authoritative fixed-point) from `visualPosition` (interpolated)
- ✅ Use `MathConversions` utilities for FPVector3 ↔ Vector3 conversion
- ✅ Call `snapshotPositions()` BEFORE simulation tick
- ✅ Call `captureCurrentPositions()` AFTER simulation tick
- ✅ Use `getInterpolationAlpha()` each render frame
- ✅ Register entities with `InterpolationSystem` on creation
- ✅ Unregister entities on destruction
- ❌ Never modify `TransformComponent.fpPosition` outside simulation tick

### Component Design

- ✅ Keep components as **pure data containers**
- ✅ Include helper methods for common calculations
- ✅ Use private fields with getters for read-only access
- ✅ Use `SoAComponent` for hot-path data iterated every tick (physics, transforms)
- ✅ Use standard `IComponent` for infrequent, complex, or few-instance data
- ✅ Use `'i64'` fields in SoA schemas for deterministic fixed-point values
- ✅ Use `FP.ToRaw()` / `FP.FromRaw()` when writing/reading `'i64'` fields
- ❌ Avoid putting complex game logic in components
- ❌ Avoid component-to-component dependencies
- ❌ Avoid SoA for complex data (nested objects, strings, variable-length arrays)

### System Design

- ✅ Each system should have a **single responsibility**
- ✅ Use `EntityManager.queryEntities()` to find relevant entities
- ✅ Communicate with other systems via **EventBus only**
- ✅ Clean up event subscriptions in `dispose()`
- ❌ Avoid direct references between systems
- ❌ Avoid storing entity references (query fresh each frame)

### Event Design

- ✅ Use **past tense** for completed actions: `ENTITY_DESTROYED`
- ✅ Use **requested suffix** for requests: `MOVE_REQUESTED`
- ✅ Include all necessary data in the event payload
- ✅ Use `createEvent()` to include timestamps
- ❌ Avoid circular event chains

### Entity Design

- ✅ Use composition to build entity capabilities
- ✅ Call `dispose()` to clean up Babylon.js resources
- ✅ Register with `EntityManager` after creation
- ❌ Avoid deep inheritance hierarchies

### Performance Tips

- Use `queryEntities()` efficiently - it uses indexed lookups
- Avoid creating new `Vector3` objects in update loops
- Use `deltaTime` for frame-independent movement
- Dispose meshes and materials when entities are destroyed

---

## File Structure Reference

```
src/
├── main.ts                  # Entry point - bootstraps LobbyScene or Game
├── style.css                # Global styles
│
├── config/
│   └── constants.ts         # Server URL, tick rate, arena params, unit costs, camera, resources, waves
│
├── core/
│   ├── Game.ts              # Thin orchestrator - coordinates all systems
│   ├── GameInitializer.ts   # World setup and entity creation
│   ├── GameEventCoordinator.ts # Game event subscriptions
│   ├── EntityCleanupService.ts # Destroyed entity cleanup
│   ├── EntityFactory.ts     # Entity creation with ownership
│   ├── SceneManager.ts      # Babylon.js scene setup
│   ├── AssetManager.ts      # 3D model preloading and instancing
│   ├── LockstepManager.ts   # Deterministic command execution
│   ├── NetworkCommands.ts   # Network command type definitions
│   ├── MathConversions.ts   # Fixed-point ↔ Babylon.js conversions
│   ├── UIManager.ts         # UI updates and notifications
│   ├── ModelLoader.ts       # Utility for loading 3D models
│   └── GameRandom.ts        # Seeded random number generator
│
├── scenes/
│   └── LobbyScene.ts        # Matchmaking UI and connection
│
├── entities/                # Game entities (extend Entity from phalanx-ecs)
│   ├── Unit.ts              # Base game entity class (Babylon.js mesh, implements IMeshEntity)
│   ├── Base.ts              # Player base (win condition), extends Unit
│   ├── Tower.ts             # Stationary defense, extends Unit
│   ├── PrismaUnit.ts        # Heavy combat unit (2x2 grid), extends Unit
│   ├── LanceUnit.ts         # Elongated unit (1x2 grid), extends Unit
│   ├── MutantUnit.ts        # Animated 3D model unit, extends Unit
│   └── ProjectileEntity.ts  # Projectile entity (extends Entity, implements IMeshEntity)
│
├── components/
│   ├── Component.ts         # IComponent re-export + ComponentType registry
│   ├── TeamComponent.ts     # Team affiliation (IComponent)
│   ├── HealthComponent.ts   # Health management (IComponent)
│   ├── AttackComponent.ts   # Attack capabilities (IComponent)
│   ├── MovementComponent.ts # Movement capabilities (IComponent)
│   ├── ResourceComponent.ts # Resource generation (IComponent)
│   ├── UnitTypeComponent.ts # Unit type identifier (IComponent)
│   ├── TransformComponent.ts # Entity position — SoA (i64 fp + f64 visual)
│   ├── HealthBarComponent.ts # Health bar visualization (IComponent)
│   ├── InterpolationComponent.ts # Visual interpolation state (IComponent)
│   ├── AnimationComponent.ts # 3D model animation state (IComponent)
│   ├── RotationComponent.ts # Entity rotation toward targets (IComponent)
│   ├── AttackLockComponent.ts # Attack lock state
│   ├── DeathComponent.ts    # Death animation/cleanup state
│   ├── ProjectileComponent.ts # Projectile simulation state (IComponent)
│   └── index.ts             # Re-exports (includes PhysicsBodyComponent from phalanx-physics)
│
├── systems/                 # All extend GameSystem from phalanx-ecs
│   ├── CombatSystem.ts      # Attack logic (deterministic)
│   ├── MovementSystem.ts    # Set velocities for moving entities
│   ├── HealthSystem.ts      # Damage processing
│   ├── ProjectileSystem.ts  # Projectile ECS entity management (deterministic)
│   ├── InterpolationSystem.ts # Smooth visual interpolation
│   ├── ResourceSystem.ts    # Resource generation/spending
│   ├── TerritorySystem.ts   # Territory control
│   ├── FormationGridSystem.ts # Unit placement grid
│   ├── WaveSystem.ts        # Wave-based deployment
│   ├── VictorySystem.ts     # Win/lose conditions
│   ├── AnimationSystem.ts   # 3D model animations
│   ├── RotationSystem.ts    # Entity rotation toward targets
│   ├── HealthBarSystem.ts   # Health bar rendering
│   ├── CameraController.ts  # RTS camera controls
│   └── formation/           # Formation-related helpers
│       ├── FormationDeployer.ts
│       ├── FormationGridData.ts
│       ├── FormationGridRenderer.ts
│       ├── FormationHoverPreview.ts
│       ├── FormationInputHandler.ts
│       ├── FormationTypes.ts
│       └── index.ts
│
├── events/
│   ├── GameEvents.ts        # Event type constants
│   ├── EventTypes.ts        # Event interfaces
│   └── index.ts             # Re-exports
│
├── effects/
│   ├── ExplosionEffect.ts   # Visual explosion effect
│   └── BloodEffect.ts       # Visual blood effect
│
├── visuals/
│   └── characters/          # 3D model assets (GLB files, preview images)
│
├── enums/
│   └── TeamTag.ts           # Team enumeration
│
└── interfaces/
    ├── IMeshEntity.ts       # Interface for entities with visual mesh (Unit, ProjectileEntity)
    ├── IAttacker.ts
    ├── IDamageable.ts
    ├── IMovable.ts
    ├── ITeamMember.ts
    └── index.ts
```
