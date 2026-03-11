---
name: phalanx-ecs
description: Create game logic using the phalanx-ecs library from the phalanx-engine repository. Use when the user wants to build entities, components, systems, game events, or a GameWorld using the Phalanx ECS architecture. Covers IComponent vs SoAComponent, GameSystem, EntityManager, EventBus, SystemContext, and deterministic lockstep game loop patterns.
metadata:
  author: phaeton2040-AI
  version: '1.0'
---

# Phalanx ECS Skill

## When to Use This Skill

Use this skill when the user asks to:

- Create game entities, components, or systems using phalanx-ecs
- Set up a GameWorld for single-player or multiplayer
- Decide between IComponent and SoAComponent for a given use case
- Implement deterministic game logic with ECS
- Create event-driven communication between systems
- Query entities by component composition
- Integrate phalanx-ecs with a rendering engine (Babylon.js, Three.js, Phaser, etc.)
- Implement hot-path systems with SoA (Structure-of-Arrays) storage

## Prerequisites

- TypeScript project with strict mode
- `phalanx-ecs` package (from monorepo or npm when published)
- For multiplayer: `phalanx-client` (implements `ITickFrameProvider`)
- For deterministic math: `phalanx-math` (FP, FPVector2, FPVector3)

## Architecture Overview

```
GameWorld (Facade)
├── EntityManager        ← Entity registry + component queries + SoA store management
├── EventBus             ← Decoupled system communication
├── SystemContext         ← Dependency injection for systems
├── SystemRegistry       ← System lifecycle and execution order
└── TickFrameManager     ← Built-in single-player tick/frame loop
    or PhalanxClient     ← Multiplayer tick/frame provider
```

Pipeline per tick:  `beforeTick → [tick systems processTick()] → afterTick`
Pipeline per frame: `beforeFrame → [frame systems update()] → afterFrame`

## Step-by-Step Instructions

### 1. Set Up GameWorld

#### Single-Player Mode

```typescript
import { GameWorld } from 'phalanx-ecs';

const world = new GameWorld({
  tickRate: 60,          // Ticks per second (default: 60)
  maxFrameTime: 0.25,   // Max frame time cap in seconds (default: 0.25)
});

world.registerSystems(
  [movementSystem, physicsSystem],     // Tick systems (deterministic)
  [renderSystem, animationSystem],     // Frame systems (visual)
);

world.start();
```

#### Multiplayer Mode (with PhalanxClient)

```typescript
import { PhalanxClient } from 'phalanx-client';
import { GameWorld } from 'phalanx-ecs';

const client = await PhalanxClient.create({ serverUrl: '...' });

const world = new GameWorld({
  tickFrameProvider: client,   // PhalanxClient implements ITickFrameProvider
  componentTypes: Object.values(ComponentType),
});

world.registerSystems(tickSystems, frameSystems);

world.start({
  beforeTick(tick, commands) {
    lockstepManager.processTick(tick, commands);
  },
  afterTick(tick) {
    lockstepManager.cleanup();
  },
  afterFrame(alpha, dt) {
    interpolation.interpolate(alpha);
    scene.render();  // Must call manually — GameWorld does NOT render
  },
});
```

### 2. Create a Component Type Registry

Every game needs a registry mapping component names to unique symbols:

```typescript
// src/components/Component.ts
import { IComponent, createComponentTypeRegistry } from 'phalanx-ecs';
export type { IComponent };

export const ComponentType = createComponentTypeRegistry({
  Health: 'Health',
  Attack: 'Attack',
  Movement: 'Movement',
  Team: 'Team',
  Transform: 'Transform',
  PhysicsBody: 'PhysicsBody',
  Resource: 'Resource',
  UnitType: 'UnitType',
});
```

## Component Types: IComponent vs SoAComponent

Phalanx ECS offers two component types. **Choosing the right one is critical for performance and correctness.**

### IComponent (Standard Components)

Simple class-based components that store data in regular object properties. Attached to entities via `entity.addComponent()`.

#### When to Use IComponent

- The component is accessed **infrequently** (e.g., flags, config, UI state, death timers)
- There are **few instances** (e.g., a single `ResourceComponent` per player, one `VictoryCondition`)
- The data is **complex or polymorphic** (nested objects, arrays of variable length, callbacks, string identifiers)
- You want **maximum simplicity** — fastest to implement
- The component stores **references to external objects** (meshes, animation groups, DOM elements)

#### When NOT to Use IComponent

- The component is iterated every tick in a hot loop with hundreds/thousands of entities
- You need deterministic fixed-point storage via `BigInt64Array`
- Cache-friendly memory layout matters for performance

#### How to Create an IComponent

```typescript
// src/components/HealthComponent.ts
import type { IComponent } from './Component';
import { ComponentType } from './Component';

export class HealthComponent implements IComponent {
  public readonly type = ComponentType.Health;

  private _health: number;
  private _maxHealth: number;

  constructor(maxHealth: number = 100) {
    this._health = maxHealth;
    this._maxHealth = maxHealth;
  }

  public get health(): number { return this._health; }
  public get maxHealth(): number { return this._maxHealth; }

  public takeDamage(amount: number): void {
    this._health = Math.max(0, this._health - amount);
  }

  public heal(amount: number): void {
    this._health = Math.min(this._maxHealth, this._health + amount);
  }

  public get isDead(): boolean { return this._health <= 0; }
}
```

Usage:

```typescript
entity.addComponent(new HealthComponent(100));

// Later, in a system:
const health = entity.getComponent<HealthComponent>(ComponentType.Health);
if (health && health.isDead) {
  entity.destroy();
}
```

#### More IComponent Examples

```typescript
// Flag component — no data, just marks the entity
class SelectedComponent implements IComponent {
  public readonly type = ComponentType.Selected;
}

// Complex data component
class InventoryComponent implements IComponent {
  public readonly type = ComponentType.Inventory;
  public items: { itemId: string; quantity: number }[] = [];
  public maxSlots: number = 20;
}

// Reference component — stores external object references
class AnimationComponent implements IComponent {
  public readonly type = ComponentType.Animation;
  public animationGroups: AnimationGroup[] = [];
  public currentAnimation: string | null = null;
}

// Render-only component — visual state not part of simulation
class HealthBarComponent implements IComponent {
  public readonly type = ComponentType.HealthBar;
  public healthBar: Mesh | null = null;
  public offset: number = 2.0;
}
```

### SoAComponent (Structure-of-Arrays Components)

Components backed by contiguous typed arrays (`Float64Array`, `BigInt64Array`, `Uint8Array`, etc.) for cache-friendly memory layout. All instances of the same SoA schema share a single store with dense packed arrays.

#### When to Use SoAComponent

- The component is **iterated every tick in a hot loop** (physics, transforms, velocities, steering forces)
- There are **many instances** (hundreds or thousands of entities)
- The data is **flat numeric fields** (positions, velocities, radii, masses, cooldown timers)
- You need **deterministic fixed-point storage** via `BigInt64Array` (`'i64'` fields)
- **Cache-friendly iteration** matters (iterating contiguous arrays vs chasing pointers)

#### When NOT to Use SoAComponent

- The data is **complex** (nested objects, strings, variable-length arrays, callbacks)
- There are **very few instances** — the typed-array overhead is not worth it
- The component is **rarely queried or iterated**
- The component stores **object references** (meshes, scenes, DOM elements)

#### SoA Field Types

| Type  | TypedArray       | JS Value  | Use Case                                       |
| ----- | ---------------- | --------- | ---------------------------------------------- |
| `f64` | `Float64Array`   | `number`  | Floating-point values, visual positions         |
| `f32` | `Float32Array`   | `number`  | Lower-precision floats                          |
| `i32` | `Int32Array`     | `number`  | Signed integers (health, damage, counters)      |
| `u32` | `Uint32Array`    | `number`  | Unsigned integers (entity IDs, indices)         |
| `u8`  | `Uint8Array`     | `number`  | Boolean flags (0/1), small enums                |
| `i64` | `BigInt64Array`  | `bigint`  | Fixed-point raw values (deterministic physics)  |

#### How to Create a SoAComponent

```typescript
// src/components/TransformComponent.ts
import { SoAComponent, defineSoASchema } from 'phalanx-ecs';
import { ComponentType } from './Component';
import { FP, type FixedPoint, FPVector3, type FPVector3 as FPVector3Type } from 'phalanx-math';

// 1. Define the schema — maps field names to typed-array element types
export const TransformSoASchema = defineSoASchema({
  fpPositionX: 'i64',       // BigInt64Array — deterministic fixed-point
  fpPositionY: 'i64',
  fpPositionZ: 'i64',
  visualPositionX: 'f64',   // Float64Array — cached float for rendering
  visualPositionY: 'f64',
  visualPositionZ: 'f64',
}, 'Transform');

// 2. Extend SoAComponent
export class TransformComponent extends SoAComponent<typeof TransformSoASchema.definition> {
  public readonly type = ComponentType.Transform;
  static readonly soaSchema = TransformSoASchema;

  constructor(entityId: number, initialPosition?: FPVector3Type) {
    const pos = initialPosition ?? FPVector3.Zero;
    super(TransformSoASchema, entityId, {
      fpPositionX: FP.ToRaw(pos.x),
      fpPositionY: FP.ToRaw(pos.y),
      fpPositionZ: FP.ToRaw(pos.z),
      visualPositionX: FP.ToFloat(pos.x),
      visualPositionY: FP.ToFloat(pos.y),
      visualPositionZ: FP.ToFloat(pos.z),
    });
  }

  // 3. Getters/setters provide clean API for infrequent access (spawning, event handlers)
  get fpPosition(): FPVector3Type {
    const idx = this.getIndex();
    return {
      x: FP.FromRaw(this.store.arrays.fpPositionX[idx]),
      y: FP.FromRaw(this.store.arrays.fpPositionY[idx]),
      z: FP.FromRaw(this.store.arrays.fpPositionZ[idx]),
    };
  }

  set fpPosition(value: FPVector3Type) {
    const idx = this.getIndex();
    this.store.arrays.fpPositionX[idx] = FP.ToRaw(value.x);
    this.store.arrays.fpPositionY[idx] = FP.ToRaw(value.y);
    this.store.arrays.fpPositionZ[idx] = FP.ToRaw(value.z);
    // Sync visual position
    this.store.arrays.visualPositionX[idx] = FP.ToFloat(value.x);
    this.store.arrays.visualPositionY[idx] = FP.ToFloat(value.y);
    this.store.arrays.visualPositionZ[idx] = FP.ToFloat(value.z);
  }
}
```

Another example — PhysicsBodyComponent:

```typescript
// src/components/PhysicsBodyComponent.ts
import { SoAComponent, defineSoASchema } from 'phalanx-ecs';
import { FP, type FixedPoint } from 'phalanx-math';
import { ComponentType } from './Component';

export const PhysicsSoASchema = defineSoASchema({
  velocityX: 'i64',
  velocityY: 'i64',
  velocityZ: 'i64',
  radius: 'i64',
  mass: 'i64',
  isStatic: 'u8',        // 0 = dynamic, 1 = static
  ignorePhysics: 'u8',   // 0 = active, 1 = skip
}, 'PhysicsBody');

export class PhysicsBodyComponent extends SoAComponent<typeof PhysicsSoASchema.definition> {
  public readonly type = ComponentType.PhysicsBody;
  static readonly soaSchema = PhysicsSoASchema;

  constructor(entityId: number, radius: FixedPoint, isStatic: boolean = false) {
    super(PhysicsSoASchema, entityId, {
      velocityX: FP.ToRaw(FP._0),
      velocityY: FP.ToRaw(FP._0),
      velocityZ: FP.ToRaw(FP._0),
      radius: FP.ToRaw(radius),
      mass: FP.ToRaw(FP._1),
      isStatic: isStatic ? 1 : 0,
      ignorePhysics: 0,
    });
  }
}
```

#### SoA Store Lifecycle

Stores are **lazily created** when the first SoAComponent of a given schema is constructed. GameWorld sets the EntityManager context automatically:

```
GameWorld created → SoAComponent.useEntityManager(em)
First PhysicsBodyComponent constructed → store created in EntityManager
Subsequent PhysicsBodyComponents → share the same store
GameWorld disposed → SoAComponent.resetContext()
```

No manual store registration needed.

### Decision Matrix: IComponent vs SoAComponent

| Criterion                        | IComponent            | SoAComponent          |
| -------------------------------- | --------------------- | --------------------- |
| Iterated every tick in hot loop  | No                    | **Yes**               |
| Hundreds/thousands of instances  | No                    | **Yes**               |
| Flat numeric fields              | Either                | **Yes**               |
| Complex/nested data              | **Yes**               | No                    |
| Few instances                    | **Yes**               | No                    |
| Needs deterministic i64 storage  | No                    | **Yes**               |
| Stores object references         | **Yes**               | No                    |
| Strings / variable-length data   | **Yes**               | No                    |
| Simple to implement              | **Yes**               | Moderate              |

### 3. Create Entities

Entities are containers for components. The base `Entity` class from phalanx-ecs provides:
- Auto-incrementing `id` (deterministic across all clients)
- A `Map<symbol, IComponent>` of components
- Lifecycle: `destroy()`, `dispose()`

```typescript
import { Entity } from 'phalanx-ecs';
import { HealthComponent, TeamComponent, TransformComponent } from './components';
import { FPVector3 } from 'phalanx-math';

// Option A: Use Entity directly
const entity = new Entity();
entity.addComponent(new HealthComponent(100));
entity.addComponent(new TeamComponent('red'));
entity.addComponent(new TransformComponent(entity.id, FPVector3.FromFloat(10, 0, 20)));
entityManager.addEntity(entity);

// Option B: Extend Entity for game-specific entities
class Unit extends Entity {
  public mesh: Mesh | null = null;

  constructor(scene: Scene, health: number, team: string, position: FPVector3Type) {
    super();
    this.addComponent(new HealthComponent(health));
    this.addComponent(new TeamComponent(team));
    this.addComponent(new TransformComponent(this.id, position));
    this.mesh = this.createMesh(scene);
  }

  private createMesh(scene: Scene): Mesh {
    // Create visual mesh (renderer-specific)
  }

  public dispose(): void {
    this.mesh?.dispose();
    super.dispose();
  }
}
```

Entity API:

```typescript
entity.addComponent(component)           // Add a component
entity.getComponent<T>(ComponentType.X)  // Get component by type
entity.hasComponent(ComponentType.X)     // Check if has component
entity.hasComponents(TypeA, TypeB)       // Check if has ALL components
entity.removeComponent(ComponentType.X)  // Remove a component
entity.destroy()                         // Mark for destruction
entity.dispose()                         // Full cleanup (called by EntityManager)
entity.isDestroyed                       // Check if destroyed
```

**Important:** Call `resetEntityIdCounter()` when starting a new game to ensure deterministic IDs across all clients:

```typescript
import { resetEntityIdCounter } from 'phalanx-ecs';
resetEntityIdCounter();
```

### 4. Create Systems

All systems extend `GameSystem` from phalanx-ecs:

```typescript
import { GameSystem } from 'phalanx-ecs';
import type { SystemContext } from 'phalanx-ecs';

class CombatSystem extends GameSystem {
  public init(context: SystemContext): void {
    super.init(context);

    // Subscribe to events with automatic cleanup
    this.subscribe<DamageRequestedEvent>('damage:requested', (event) => {
      this.applyDamage(event.targetId, event.amount);
    });
  }

  // Deterministic tick logic — called once per simulation tick
  public processTick(tick: number): void {
    if (!this.enabled) return;

    const attackers = this.entityManager.queryEntities(
      ComponentType.Attack,
      ComponentType.Team,
    );

    for (const attacker of attackers) {
      this.findAndAttackTarget(attacker);
    }
  }

  // Frame-based visual updates (optional) — called every render frame
  public update(deltaTime: number): void {
    if (!this.enabled) return;
    // Visual effects, particles, etc.
  }

  public dispose(): void {
    // Custom cleanup
    super.dispose();  // Auto-unsubscribes all events
  }
}
```

#### System Registration

Systems are registered with GameWorld as either **tick systems** or **frame systems**:

```typescript
const combatSystem = new CombatSystem();
const physicsSystem = new PhysicsSystem();
const renderSystem = new RenderSystem();

world.registerSystems(
  [physicsSystem, combatSystem],  // Tick systems: run in order, deterministically
  [renderSystem],                 // Frame systems: run every render frame
);
```

A system can be registered as both tick and frame:

```typescript
world.registerSystems(
  [movementSystem],   // processTick() called per tick
  [movementSystem],   // update() called per frame
);
```

#### Accessing Other Systems

```typescript
// In any system
const movementSystem = this.context.getSystem(MovementSystem);
if (movementSystem) {
  movementSystem.moveEntity(entityId, targetPosition);
}
```

#### Hot-Path System with Direct SoA Access

For maximum performance, bypass the component facade and access SoA stores directly:

```typescript
import { GameSystem, type SoAComponentStore } from 'phalanx-ecs';
import { PhysicsSoASchema, TransformSoASchema } from '../components';
import { FP, type FixedPoint } from 'phalanx-math';

class PhysicsSystem extends GameSystem {
  // Cache store references — resolved once in init()
  private physicsStore!: SoAComponentStore<typeof PhysicsSoASchema.definition>;
  private transformStore!: SoAComponentStore<typeof TransformSoASchema.definition>;

  public override init(context: SystemContext): void {
    super.init(context);
    this.physicsStore = this.entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    this.transformStore = this.entityManager.getOrCreateSoAStore(TransformSoASchema);
  }

  public processTick(tick: number): void {
    if (!this.enabled) return;
    this.applyVelocities();
  }

  private applyVelocities(): void {
    // Grab typed array references outside the loop
    const velocityX = this.physicsStore.arrays.velocityX;
    const velocityZ = this.physicsStore.arrays.velocityZ;
    const fpPositionX = this.transformStore.arrays.fpPositionX;
    const fpPositionZ = this.transformStore.arrays.fpPositionZ;

    // Iterate in deterministic entity ID order
    for (const entityId of this.physicsStore.entityIds()) {
      const physIdx = this.physicsStore.indexOf(entityId);
      // Cross-store lookup (one Map.get() per entity)
      const txIdx = this.transformStore.indexOf(entityId);
      if (txIdx === -1) continue;

      const velX = FP.FromRaw(velocityX[physIdx]);
      const velZ = FP.FromRaw(velocityZ[physIdx]);
      const posX = FP.FromRaw(fpPositionX[txIdx]);
      const posZ = FP.FromRaw(fpPositionZ[txIdx]);

      fpPositionX[txIdx] = FP.ToRaw(FP.Add(posX, velX));
      fpPositionZ[txIdx] = FP.ToRaw(FP.Add(posZ, velZ));
    }
  }
}
```

**Key rules for direct SoA access:**

1. **Cache array references** outside the loop — `const velocityX = store.arrays.velocityX`
2. **Use `entityIds()`** for deterministic iteration (sorted by entity ID — required for lockstep)
3. **Cross-store lookup** via `indexOf(entityId)` when correlating two stores (one `Map.get()` per entity vs the facade's `Map.get()` per field access)
4. **Single-store loops** are the ideal case — zero cross-store overhead
5. **Sync visual positions** when writing fp positions directly (the facade setter does it automatically, but direct writes must do it manually)
6. **Hybrid pattern** for AoS+SoA: get the entity via `entityManager.getEntity(entityId)` to access IComponent data alongside SoA stores

### 5. EventBus — Decoupled Communication

```typescript
import { EventBus } from 'phalanx-ecs';

// Access via GameWorld
const eventBus = world.eventBus;

// Subscribe
const unsub = eventBus.on<DamageEvent>('damage:applied', (event) => {
  console.log(`Entity ${event.entityId} took ${event.amount} damage`);
});

// Subscribe once
eventBus.once<GameOverEvent>('game:over', (event) => {
  console.log(`Winner: ${event.winnerId}`);
});

// Emit
eventBus.emit<DamageEvent>('damage:applied', {
  entityId: 1,
  amount: 25,
  sourceId: 2,
});

// Unsubscribe
unsub();

// Inside systems, use the subscribe() helper for automatic cleanup:
this.subscribe<DamageEvent>('damage:applied', (event) => { ... });
```

Event naming conventions:
- **Past tense** for completed actions: `entity:destroyed`, `damage:applied`
- **Requested suffix** for requests: `move:requested`, `attack:requested`
- Use colon-separated namespaces: `combat:attack`, `resource:collected`

### 6. EntityManager — Queries

```typescript
const em = world.entityManager;

// Add/remove entities
em.addEntity(entity);
em.removeEntity(entity);

// Query by component — AND (all components required)
const combatants = em.queryEntities(ComponentType.Attack, ComponentType.Health);

// Query by component — OR (any component matches)
const movableOrPhysics = em.queryEntitiesAny(ComponentType.Movement, ComponentType.PhysicsBody);

// Get specific entity by ID
const entity = em.getEntity(42);

// Cleanup destroyed entities (returns removed entities for disposal)
const removed = em.cleanupDestroyed();
for (const e of removed) {
  e.dispose();
}

// SoA store access
const store = em.getSoAStore(TransformSoASchema);
const store2 = em.getOrCreateSoAStore(PhysicsSoASchema, 1024);
const hasStore = em.hasSoAStore(PhysicsSoASchema);
```

### 7. GameWorld Lifecycle Hooks

```typescript
world.start({
  beforeTick(tick: number, commands: CommandsBatch): void {
    // Called before tick systems run
    // Use for: command execution, position snapshots
  },
  afterTick(tick: number): void {
    // Called after all tick systems have run
    // Use for: cleanup, state hashing, position capture
  },
  beforeFrame(alpha: number, dt: number): void {
    // Called before frame systems run
    // Use for: camera updates, input processing
  },
  afterFrame(alpha: number, dt: number): void {
    // Called after all frame systems have run
    // Use for: interpolation, scene.render()
  },
});

// Stop the loop
world.stop();

// Full cleanup
world.dispose();
```

### 8. Implementing a LockstepManager

For multiplayer, create a LockstepManager to handle deterministic command execution:

```typescript
import type { CommandsBatch, PlayerCommand } from 'phalanx-ecs';

class LockstepManager {
  private client: PhalanxClient;
  private entityManager: EntityManager;

  constructor(client: PhalanxClient, entityManager: EntityManager) {
    this.client = client;
    this.entityManager = entityManager;
  }

  // Called from beforeTick hook
  processTick(tick: number, commandsBatch: CommandsBatch): void {
    // Flatten commands from all players in deterministic order
    const allCommands: PlayerCommand[] = [];
    const sortedPlayerIds = Object.keys(commandsBatch.commands).sort();
    for (const playerId of sortedPlayerIds) {
      allCommands.push(...commandsBatch.commands[playerId]);
    }

    // Execute all commands
    for (const cmd of allCommands) {
      this.executeCommand(cmd);
    }
  }

  // Called from afterTick hook
  cleanup(): void {
    const removed = this.entityManager.cleanupDestroyed();
    for (const entity of removed) {
      entity.dispose();
    }
  }

  private executeCommand(cmd: PlayerCommand): void {
    switch (cmd.type) {
      case 'move':
        // Handle move command
        break;
      case 'attack':
        // Handle attack command
        break;
    }
  }

  // Queue command to be sent to server
  queueCommand(command: { type: string; data: unknown }): void {
    this.client.sendCommand(command.type, command.data);
  }
}
```

## Exports from phalanx-ecs

```typescript
// GameWorld facade
import { GameWorld, GameWorldEvents } from 'phalanx-ecs';
import type { GameWorldConfig, GameWorldHooks } from 'phalanx-ecs';

// Core ECS
import { Entity, resetEntityIdCounter } from 'phalanx-ecs';
import { EntityManager } from 'phalanx-ecs';
import { EventBus, globalEventBus } from 'phalanx-ecs';
import { GameSystem } from 'phalanx-ecs';
import { SystemRegistry } from 'phalanx-ecs';
import { SystemContext } from 'phalanx-ecs';

// Components
import { IComponent, createComponentTypeRegistry } from 'phalanx-ecs';

// SoA storage
import { SoAComponent, SoAComponentStore, defineSoASchema } from 'phalanx-ecs';
import type { SoASchema, SoASchemaDefinition, SoAFieldType, SoAFieldsOf } from 'phalanx-ecs';

// Tick/Frame management
import { TickFrameManager } from 'phalanx-ecs';
import type { ITickFrameProvider, TickHandler, FrameHandler, Unsubscribe, CommandsBatch, PlayerCommand } from 'phalanx-ecs';
```

## Best Practices

### Deterministic Lockstep Rules

- All gameplay logic must be **deterministic** — use `processTick()`, not `update()`
- Use `phalanx-math` FP functions for all simulation arithmetic (FP.Add, FP.Mul, etc.)
- Use `'i64'` SoA fields with `FP.ToRaw()`/`FP.FromRaw()` for deterministic fixed-point storage
- Sort entity queries by ID for deterministic iteration order
- Never use `Math.random()`, `Date.now()`, or `performance.now()` in simulation logic
- Never execute commands immediately on input — queue them through the lockstep manager
- Never call `processAllTicks()` or `updateAll()` manually — `world.start()` handles it

### Component Design

- Keep components as **pure data containers** with optional helper methods
- Use `IComponent` for: flags, config, UI state, complex data, few instances, external references
- Use `SoAComponent` for: hot-path data, many instances, flat numerics, deterministic i64 storage
- Avoid component-to-component dependencies
- Avoid putting complex game logic in components — that belongs in systems

### System Design

- Each system should have a **single responsibility**
- Communicate between systems via **EventBus only** — no direct references
- Query entities fresh each tick — don't cache entity references (entities can be destroyed)
- Use `subscribe()` helper for automatic event cleanup on dispose
- Cache SoA store references in `init()` for hot-path access

### Event Design

- Use **past tense** for completed actions: `entity:destroyed`, `damage:applied`
- Use **requested** suffix for requests: `move:requested`, `attack:requested`
- Include all necessary data in the event payload
- Avoid circular event chains

### Performance

- Use SoA direct store access in hot-path systems (bypass component facade)
- Cache array references outside loops
- Avoid `new` inside update loops (reuse objects, use pools)
- Use `queryEntities()` efficiently — it uses indexed lookups
- Dispose meshes and materials when entities are destroyed
