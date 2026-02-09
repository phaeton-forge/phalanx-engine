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

This project uses a **component-based Entity-Component-System (ECS)** architecture with an **event-driven communication pattern**. It also supports **1v1 multiplayer** via the Phalanx Engine.

```
┌─────────────────────────────────────────────────────────────┐
│                          Game.ts                             │
│              (Orchestrates initialization & game loop)       │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐   ┌─────────────────┐   ┌───────────────────┐
│ EntityManager │   │    EventBus     │   │   SceneManager    │
│  (Registry)   │   │ (Communication) │   │ (Babylon.js Scene)│
└───────────────┘   └─────────────────┘   └───────────────────┘
        │                     │
        │           ┌─────────┴─────────┐
        │           │                   │
        ▼           ▼                   ▼
┌───────────────────────────────────────────────────────────────┐
│                          Systems                               │
│  CombatSystem │ MovementSystem │ HealthSystem │ FormationSystem│
└───────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│                          Entities                              │
│               Unit        │        Tower        │   Projectile │
│    ┌────────────────────────────────────────────────────────┐ │
│    │                    Components                           │ │
│    │  TeamComponent │ HealthComponent │ AttackComponent │... │ │
│    └────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

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

| Component             | Location       | Purpose                                     |
| --------------------- | -------------- | ------------------------------------------- |
| `PhalanxClient`       | phalanx-client | Network connection, matchmaking, events     |
| `TickSimulation`      | phalanx-client | Tick timing, interpolation, command queue   |
| `LockstepManager`     | babylon-ecs    | Game-specific command execution, simulation |
| `InterpolationSystem` | babylon-ecs    | Smooth visual movement between ticks        |

### TickSimulation (from phalanx-client)

The `TickSimulation` class handles network-level synchronization:

```typescript
import { PhalanxClient, TickSimulation } from 'phalanx-client';

// Create tick simulation
const simulation = new TickSimulation(client, { tickRate: 20 });

// Register simulation callback - called for each tick
simulation.onSimulationTick((tick, commands) => {
  executeCommands(commands);
  runGameSimulation();
});

// Interpolation hooks for smooth visuals
simulation.onBeforeTick(() => interpolationSystem.snapshotPositions());
simulation.onAfterTick(() => interpolationSystem.captureCurrentPositions());

// In render loop
const alpha = simulation.getInterpolationAlpha();
interpolationSystem.interpolate(alpha);
simulation.flushCommands();
```

### LockstepManager

The `LockstepManager` handles deterministic command execution and simulation. It's called directly from `Game.ts` via the PhalanxClient's tick handler:

```typescript
// In Game.ts - setup
this.client.onTick((tick, commands) => {
  this.lockstepManager.processTick(tick, commands);
});

// LockstepManager.processTick() implementation
public processTick(tick: number, commandsBatch: CommandsBatch): void {
  // Flatten commands from all players
  const allCommands: PlayerCommand[] = [];
  for (const playerId in commandsBatch.commands) {
    allCommands.push(...commandsBatch.commands[playerId]);
  }

  // Execute all commands for this tick
  this.executeTickCommands(allCommands);  // Execute move, placeUnit, etc.

  // Run one tick of deterministic simulation
  this.simulateTick();                    // Physics, combat, projectiles

  // Process systems that need tick-based updates
  this.systems.resourceSystem.processTick(tick);
  this.systems.waveSystem.processTick(tick);

  // Cleanup destroyed entities
  this.callbacks.onCleanupNeeded();
}
```

**Key Points:**
- Network synchronization is handled by `PhalanxClient`
- `LockstepManager` focuses on deterministic game logic
- Commands from **all players** are executed (no filtering)
- Simulation runs the same on all clients

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

- `entity.fpPosition` - Authoritative fixed-point position (FPVector3, deterministic across all platforms)
- `entity.position` - Cached Vector3 derived from fpPosition (for Babylon.js compatibility, deprecated)
- `entity.mesh.position` - Visual position for rendering (can be interpolated for smooth visuals)

```typescript
// Entity.ts - Fixed-point based position system
import { FPVector3, type FPVector3 as FPVector3Type } from 'phalanx-math';

// Fixed-point simulation position (authoritative, deterministic)
private _fpPosition: FPVector3Type = FPVector3.Zero;

// Cached Vector3 (derived from _fpPosition for Babylon.js compatibility)
private _simulationPosition: Vector3 = new Vector3();

public get fpPosition(): FPVector3Type {
    return this._fpPosition;
}

public set fpPosition(value: FPVector3Type) {
    this._fpPosition = value;
    // Update cached Vector3 for Babylon.js compatibility
    const nums = FPVector3.ToFloat(value);
    this._simulationPosition.set(nums.x, nums.y, nums.z);
    // Also update mesh position (visual) by default
    if (this.mesh) {
        this.mesh.position.copyFrom(this._simulationPosition);
    }
}

public setVisualPosition(value: Vector3): void {
    if (this.mesh) {
        this.mesh.position.copyFrom(value);  // Override visual only
    }
}
```

**Why Fixed-Point?**

JavaScript's `Number` type uses IEEE 754 floating-point, which can produce slightly different results on different platforms (Chrome vs Safari, Windows vs Mac, x86 vs ARM). Fixed-point math uses integer arithmetic with a fixed decimal scale, guaranteeing identical results everywhere - critical for lockstep synchronization.

### Command Flow

**Movement Commands (Networked):**

```
Player Right-Click → InputManager → EventBus (MOVE_REQUESTED)
                                          ↓
                                    Game intercepts
                                          ↓
                              LockstepManager.queueCommand()
                                          ↓
                              TickSimulation.flushCommands()
                                          ↓
                              Server receives, broadcasts
                                          ↓
                              TickSimulation.onSimulationTick()
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
CombatSystem.simulateTick()
        ↓
    Query enemies in range
        ↓
    Attack if cooldown ready
        ↓
    Spawn projectile
        ↓
ProjectileSystem.simulateTick()
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
  data: { unitType: 'sphere' | 'prisma'; gridX: number; gridZ: number };
}

// Deploy units command
interface NetworkDeployUnitsCommand extends PlayerCommand {
  type: 'deployUnits';
  data: { playerId: string };
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
    this.systems.movementSystem.moveEntity(attacker.id, target.position);
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
| `src/config/constants.ts`            | Server URL, tick rate, spawn positions         |
| `src/core/Game.ts`                   | Network command handling and entity ownership  |
| `src/core/LockstepManager.ts`        | Lockstep synchronization and command execution |
| `src/core/NetworkCommands.ts`        | Network command type definitions               |
| `src/core/MathConversions.ts`        | Fixed-point ↔ Babylon.js vector conversions    |
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
import { StateHasher } from 'phalanx-client';

export class LockstepManager {
  private hashInterval = 20; // Hash every 20 ticks (once per second)
  private client: PhalanxClient;
  private systems: LockstepSystems;
  private entityManager: EntityManager;

  constructor(
    client: PhalanxClient,
    systems: LockstepSystems,
    entityManager: EntityManager
  ) {
    this.client = client;
    this.systems = systems;
    this.entityManager = entityManager;

    // Handle desync events
    this.client.on('desync', (event) => {
      console.error(`Desync at tick ${event.tick}!`);
      console.error(`Local: ${event.localHash}`);
      console.error(`Remote:`, event.remoteHashes);
      // Optionally show UI notification
    });
  }

  /**
   * Process a tick with commands - called from Game.ts via client.onTick()
   */
  public processTick(tick: number, commandsBatch: CommandsBatch): void {
    // Execute all commands for this tick
    this.executeTickCommands(commandsBatch);
    
    // Run deterministic simulation
    this.simulateTick();

    // Submit state hash at regular intervals
    if (tick % this.hashInterval === 0) {
      const hash = this.computeStateHash(tick);
      this.client.submitStateHash(tick, hash);
    }
  }

  private computeStateHash(tick: number): string {
    const hasher = new StateHasher();

    // Add tick number
    hasher.addInt(tick);

    // Get all entities sorted by ID for deterministic ordering
    const entities = this.entityManager.getAllEntities()
      .sort((a, b) => a.id - b.id);

    hasher.addInt(entities.length);

    for (const entity of entities) {
      hasher.addInt(entity.id);

      // Hash position
      const pos = entity.position;
      hasher.addFloat(pos.x);
      hasher.addFloat(pos.y);
      hasher.addFloat(pos.z);

      // Hash health (if has HealthComponent)
      const health = entity.getComponent(HealthComponent);
      if (health) {
        hasher.addInt(health.health);
        hasher.addInt(health.maxHealth);
      }

      // Hash movement state (if has MovementComponent)
      const movement = entity.getComponent(MovementComponent);
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
      const attack = entity.getComponent(AttackComponent);
      if (attack) {
        hasher.addFloat(attack.currentCooldown);
        hasher.addBool(attack.canAttack());
      }
    }

    return hasher.finalize();
  }
}
```

The `processTick` method is called from `Game.ts` via the PhalanxClient's tick handler:

```typescript
// In Game.ts
this.client.onTick((tick, commands) => {
  this.lockstepManager.processTick(tick, commands);
});
```

#### StateHasher Best Practices

1. **Always sort entities** by a stable ID before hashing
2. **Include only deterministic state** - no timestamps, no random values
3. **Use `entity.fpPosition`** for hashing positions (fixed-point for determinism)
4. **Include relevant game state** - health, targets, cooldowns, etc.
5. **Exclude visual-only state** - interpolated positions, particle effects

```typescript
// Good: Deterministic state
const fpPos = entity.fpPosition;
hasher.addFloat(FP.ToFloat(fpPos.x)); // Fixed-point position (deterministic)
hasher.addFloat(FP.ToFloat(fpPos.y));
hasher.addFloat(FP.ToFloat(fpPos.z));
hasher.addInt(entity.health);            // Game state
hasher.addInt(entity.targetId ?? -1);    // Nullable with default

// Bad: Non-deterministic state
hasher.addFloat(Date.now());             // ❌ Time varies
hasher.addFloat(Math.random());          // ❌ Random
hasher.addFloat(entity.mesh.position.x); // ❌ Visual position (interpolated)
hasher.addFloat(entity.position.x);      // ❌ Cached float (may have precision issues)
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
4. Verify match ends if server is configured with `action: 'end-match'`

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

- [ ] **Call `submitStateHash()` in `processTick()`**
  - Submit hash every N ticks (e.g., every 20 ticks = 1 second)
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
  - Update `game-test-server` configuration
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
  fpToVector3,        // FPVector3 → Vector3 (allocates new)
  fpToVector3Ref,     // FPVector3 → Vector3 (writes to existing, no allocation)
  vector3ToFp,        // Vector3 → FPVector3 (for user input, initialization)
  lerpVector3FromFp,  // Interpolate FPVector3 → Vector3 (allocates new)
  lerpVector3FromFpRef, // Interpolate FPVector3 → Vector3 (no allocation)
  fpToVector2,        // FPVector2 → Vector2
  vector2ToFp,        // Vector2 → FPVector2
} from './core/MathConversions';
```

#### Usage Examples

```typescript
// Convert fixed-point position to Babylon Vector3 for rendering
const renderPos = fpToVector3(entity.fpPosition);

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
- `networkConfig.tickRate` - Simulation tick rate (must match server)
- `arenaParams` - Starting positions for bases and towers

---

## Core Concepts

### Entities

Entities are containers for components. They have:

- A unique `id`
- A reference to the Babylon.js `Scene`
- A visual `Mesh`
- A `Map` of components

**Base Entity Class** (`src/entities/Entity.ts`):

```typescript
export abstract class Entity {
  public readonly id: number;
  protected scene: Scene;
  protected mesh: Mesh | null = null;
  protected components: Map<symbol, IComponent> = new Map();

  // Component management
  addComponent<T extends IComponent>(component: T): T;
  getComponent<T extends IComponent>(type: symbol): T | undefined;
  hasComponent(type: symbol): boolean;
  hasComponents(...types: symbol[]): boolean;
  removeComponent(type: symbol): boolean;
}
```

**Existing Entities**:

- `Unit` - Movable combat unit with health, attack, movement, and team
- `Tower` - Stationary defense structure with health, attack, and team
- `Projectile` - Temporary entity for visual attack effects

---

### Components

Components are pure data containers that implement `IComponent`. Each component has a unique `type` symbol for identification.

**Component Interface** (`src/components/Component.ts`):

```typescript
export interface IComponent {
  readonly type: symbol;
}

export const ComponentType = {
  Team: Symbol('Team'),
  Health: Symbol('Health'),
  Attack: Symbol('Attack'),
  Movement: Symbol('Movement'),
  Selectable: Symbol('Selectable'),
  Renderable: Symbol('Renderable'),
} as const;
```

**Existing Components**:

| Component           | Purpose               | Key Properties                               |
| ------------------- | --------------------- | -------------------------------------------- |
| `TeamComponent`     | Team affiliation      | `team: TeamTag`, `isHostileTo()`             |
| `HealthComponent`   | Health management     | `health`, `maxHealth`, `takeDamage()`        |
| `AttackComponent`   | Attack capabilities   | `range`, `damage`, `cooldown`, `canAttack()` |
| `MovementComponent` | Movement capabilities | `speed`, `targetPosition`, `moveTo()`        |

---

### Systems

Systems contain game logic and operate on entities with specific component combinations. They:

- Query entities through `EntityManager`
- Communicate through `EventBus`
- Have an `update()` method called each frame

**Existing Systems**:

| System                | Responsibility                         | Required Components  |
| --------------------- | -------------------------------------- | -------------------- |
| `CombatSystem`        | Target detection, attack logic         | Attack, Team, Health |
| `MovementSystem`      | Entity movement commands               | Movement             |
| `HealthSystem`        | Damage processing, entity destruction  | Health               |
| `PhysicsSystem`       | Deterministic physics, collision       | -                    |
| `ProjectileSystem`    | Projectile movement and collision      | -                    |
| `InputManager`        | User input handling                    | -                    |
| `InterpolationSystem` | Smooth visual movement between ticks   | -                    |
| `ResourceSystem`      | Resource generation and spending       | -                    |
| `TerritorySystem`     | Territory control and aggression bonus | Team                 |
| `FormationGridSystem` | Unit placement grid                    | -                    |
| `WaveSystem`          | Wave-based unit deployment             | -                    |
| `VictorySystem`       | Win/lose conditions                    | -                    |

**Core Managers**:

| Manager           | Responsibility                                     |
| ----------------- | -------------------------------------------------- |
| `LockstepManager` | Deterministic command execution and simulation     |
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
- **Health**: `DAMAGE_REQUESTED`, `DAMAGE_APPLIED`, `ENTITY_DESTROYED`
- **Movement**: `MOVE_REQUESTED`, `MOVE_STARTED`, `MOVE_COMPLETED`
- **Input**: `LEFT_CLICK`, `RIGHT_CLICK`, `GROUND_CLICKED`
- **Lifecycle**: `ENTITY_CREATED`, `ENTITY_DISPOSED`

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
export const ComponentType = {
  // ...existing types
  Armor: Symbol('Armor'), // Add new type
} as const;
```

3. **Export from index** in `src/components/index.ts`:

```typescript
export * from './ArmorComponent';
```

4. **Add to entities** that need it:

```typescript
// In Unit.ts or Tower.ts constructor
this.addComponent(new ArmorComponent(5));
```

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
import { Entity } from './Entity';
import { ComponentType, TeamComponent, HealthComponent } from '../components';
import { TeamTag } from '../enums/TeamTag';

export interface BuildingConfig {
  team: TeamTag;
  health?: number;
  color?: Color3;
}

export class Building extends Entity {
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

1. **Create the system file** in `src/systems/`:

```typescript
// src/systems/ResourceSystem.ts
import { Engine } from '@babylonjs/core';
import { EntityManager } from '../core/EntityManager';
import { EventBus } from '../core/EventBus';
import { ComponentType } from '../components';
import { GameEvents, createEvent } from '../events';

export class ResourceSystem {
  private engine: Engine;
  private entityManager: EntityManager;
  private eventBus: EventBus;
  private unsubscribers: (() => void)[] = [];

  constructor(
    engine: Engine,
    entityManager: EntityManager,
    eventBus: EventBus
  ) {
    this.engine = engine;
    this.entityManager = entityManager;
    this.eventBus = eventBus;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Subscribe to relevant events
    this.unsubscribers.push(
      this.eventBus.on(GameEvents.ENTITY_DESTROYED, (event) => {
        // Handle resource drops, etc.
      })
    );
  }

  public update(): void {
    const deltaTime = this.engine.getDeltaTime() / 1000;

    // Query entities with Resource component
    const resourceEntities = this.entityManager.queryEntities(
      ComponentType.Resource
    );

    for (const entity of resourceEntities) {
      // Process resource logic
    }
  }

  public dispose(): void {
    this.unsubscribers.forEach((unsub) => unsub());
  }
}
```

2. **Initialize in `Game.ts`**:

```typescript
// In constructor
this.resourceSystem = new ResourceSystem(
  this.engine,
  this.entityManager,
  this.eventBus
);

// In game loop (start method)
this.resourceSystem.update();
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
- ✅ Use `simulateTick()` methods instead of frame-based `update(deltaTime)`
- ✅ Send commands through `LockstepManager.queueCommand()`
- ✅ Execute commands only in `onSimulationTick()` callback
- ✅ Sort entity queries by ID for deterministic iteration order
- ✅ Use `entity.fpPosition` (fixed-point) for all simulation calculations
- ✅ Use `phalanx-math` FP functions for arithmetic (distances, lerp, etc.)
- ❌ Never use `Math.random()` - use seeded PRNG if needed
- ❌ Never use `Date.now()` or real time in simulation logic
- ❌ Never execute commands immediately on input - queue them
- ❌ Never use `entity.position` (float) for deterministic calculations

### Interpolation Design

- ✅ Separate `fpPosition` (authoritative fixed-point) from `visualPosition` (interpolated)
- ✅ Use `MathConversions` utilities for FPVector3 ↔ Vector3 conversion
- ✅ Call `snapshotPositions()` BEFORE simulation tick
- ✅ Call `captureCurrentPositions()` AFTER simulation tick
- ✅ Use `getInterpolationAlpha()` each render frame
- ✅ Register entities with `InterpolationSystem` on creation
- ✅ Unregister entities on destruction
- ❌ Never modify `entity.fpPosition` outside simulation tick

### Component Design

- ✅ Keep components as **pure data containers**
- ✅ Include helper methods for common calculations
- ✅ Use private fields with getters for read-only access
- ❌ Avoid putting complex game logic in components
- ❌ Avoid component-to-component dependencies

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
│   └── constants.ts         # Server URL, tick rate, arena params, unit costs
│
├── core/
│   ├── Game.ts              # Main game orchestrator
│   ├── EntityManager.ts     # Entity registry + queries
│   ├── EntityFactory.ts     # Entity creation with ownership
│   ├── EventBus.ts          # Pub/sub event system
│   ├── SceneManager.ts      # Babylon.js scene setup
│   ├── LockstepManager.ts   # Deterministic lockstep synchronization
│   ├── NetworkCommands.ts   # Network command type definitions
│   └── UIManager.ts         # UI updates and notifications
│
├── scenes/
│   └── LobbyScene.ts        # Matchmaking UI and connection
│
├── entities/
│   ├── Entity.ts            # Base entity class (simulation + visual position)
│   ├── Unit.ts              # Movable combat unit
│   ├── PrismaUnit.ts        # Heavy combat unit (2x2 grid)
│   ├── Tower.ts             # Stationary defense
│   ├── Base.ts              # Player base (win condition)
│   └── Projectile.ts        # Attack projectile
│
├── components/
│   ├── Component.ts         # IComponent interface + types
│   ├── TeamComponent.ts     # Team affiliation
│   ├── HealthComponent.ts   # Health management
│   ├── AttackComponent.ts   # Attack capabilities
│   ├── MovementComponent.ts # Movement capabilities
│   ├── ResourceComponent.ts # Resource generation
│   ├── UnitTypeComponent.ts # Unit type identifier
│   └── index.ts             # Re-exports
│
├── systems/
│   ├── CombatSystem.ts      # Attack logic (deterministic)
│   ├── MovementSystem.ts    # Movement commands
│   ├── PhysicsSystem.ts     # Deterministic physics simulation
│   ├── HealthSystem.ts      # Damage processing
│   ├── ProjectileSystem.ts  # Projectile management
│   ├── InputManager.ts      # User input handling
│   ├── InterpolationSystem.ts # Smooth visual interpolation
│   ├── ResourceSystem.ts    # Resource generation/spending
│   ├── TerritorySystem.ts   # Territory control
│   ├── FormationGridSystem.ts # Unit placement grid
│   ├── WaveSystem.ts        # Wave-based deployment
│   ├── VictorySystem.ts     # Win/lose conditions
│   └── CameraController.ts  # RTS camera controls
│
├── events/
│   ├── GameEvents.ts        # Event type constants
│   ├── EventTypes.ts        # Event interfaces
│   └── index.ts             # Re-exports
│
├── effects/
│   └── ExplosionEffect.ts   # Visual explosion effect
│
├── enums/
│   └── TeamTag.ts           # Team enumeration
│
└── interfaces/
    ├── IAttacker.ts
    ├── IDamageable.ts
    ├── IMovable.ts
    └── ITeamMember.ts
```
