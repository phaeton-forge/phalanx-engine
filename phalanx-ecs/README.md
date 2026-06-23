# Phalanx ECS

A lightweight, renderer-agnostic Entity-Component-System (ECS) library with optional multiplayer support via Phalanx Engine.

## Features

- **GameWorld Facade**: One-liner setup — construct, register systems, start
- **Pure ECS Architecture**: EntityManager, GameSystem, EventBus
- **Renderer Agnostic**: No rendering dependencies — bring your own renderer (Babylon.js, Three.js, etc.)
- **Flexible Integration**: Use standalone or with Phalanx Client for multiplayer
- **TypeScript First**: Full type safety and excellent IDE support
- **Deterministic Tick/Frame**: Separate tick-based simulation from frame-based rendering
- **SoA Storage**: Optional Structure-of-Arrays component storage for cache-friendly hot-path iteration
- **Object Pooling**: Built-in entity and object pools to minimize GC pressure in hot loops

## Core Components

### GameWorld (Recommended Entry Point)
- **GameWorld**: High-level facade — creates all core dependencies, wires tick/frame loops, provides convenience accessors

### Entity Management
- **Entity**: Base class for all game objects (id + components only, no rendering)
- **EntityManager**: Central registry with efficient component-based queries
- **IComponent**: Interface for all components

### System Architecture
- **GameSystem**: Base class for all game systems (convenience accessors for `eventBus`, `entityManager`, `abilities`, `physics`, `pools`)
- **SystemRegistry**: Low-level system lifecycle and execution order (used internally by GameWorld)
- **SystemContext**: Dependency injection container (`eventBus`, `entityManager`, optional `abilities` / `physics`, `pools`)
- **ISystemLifecycleHooks**: Optional `IBeforeTick`, `IAfterTick`, `IBeforeFrame`, `IAfterFrame` interfaces — GameWorld invokes them automatically

### Event System
- **EventBus**: Decoupled communication between systems

### Tick/Frame Management
- **TickFrameManager**: Built-in no-op client for single-player games
- Compatible with PhalanxClient for multiplayer

### SoA (Structure-of-Arrays) Storage
- **SoAComponent**: Base class for components backed by contiguous typed arrays
- **SoAComponentStore**: Dense, cache-friendly storage with O(1) entity lookup
- **defineSoASchema**: Type-safe schema definition for SoA field layout

### Object Pooling
- **ObjectPool**: Generic LIFO pool for any `IPoolable` object
- **EntityPool**: Low-level entity storage with stable IDs and growth stats
- **PoolManager**: Orchestrates spawn/despawn lifecycle and EntityManager registration
- **IPoolableEntity**: Per-entity `onSpawn(args)` / `onDespawn()` hooks for typed value assignment
- **IPoolableComponent**: Engine-driven `onSpawn()` / `onDespawn()` hooks for backing storage (SoA rows, visibility)

## Installation

```bash
npm install @phalanx-engine/ecs
```

## Usage

### Single-player Mode

```typescript
import { GameWorld } from '@phalanx-engine/ecs';

// Create GameWorld (no rendering dependencies)
const world = new GameWorld({
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
// Automatically runs: processAllTicks(tick), updateAll(dt)
// Note: scene.render() is NOT called automatically — call it in afterFrame hook if needed
world.start();
```

### Multiplayer Mode (with Phalanx Client)

```typescript
import { PhalanxClient } from '@phalanx-engine/client';
import { GameWorld } from '@phalanx-engine/ecs';

// Initialize Phalanx Client
const client = new PhalanxClient({
  serverUrl: 'wss://your-server.com',
  // ... other config
});

// Create GameWorld with external tick/frame provider
const world = new GameWorld({
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
    // Render the scene (must be called manually)
    // Interpolation is handled by phalanx-physics InterpolationSystem when registered
    scene.render();
  },
});

// Connect to match
await client.connect();
```

### Low-level API (SystemRegistry + ITickFrameProvider)

For advanced use-cases you can still use `SystemRegistry` and `ITickFrameProvider` directly:

```typescript
import { SystemRegistry, TickFrameManager } from '@phalanx-engine/ecs';

const registry = new SystemRegistry(componentTypes);
registry.registerSystems(tickSystems, frameSystems);

const tickManager = new TickFrameManager({ tickRate: 60 });
tickManager.onTick((tick) => registry.processAllTicks(tick));
tickManager.onFrame((alpha, dt) => { registry.updateAll(dt); });
tickManager.start();
```

## API Reference

### GameWorld

```typescript
class GameWorld {
  constructor(config: GameWorldConfig)

  // Convenience accessors
  get eventBus(): EventBus
  get entityManager(): EntityManager
  get context(): SystemContext
  get pools(): PoolManager | null
  get paused(): boolean
  getSystem<T extends GameSystem>(systemClass: new (...args: any[]) => T): T | undefined

  // System registration
  registerSystems(tickSystems: GameSystem[], frameSystems: GameSystem[]): void
  addFrameSystem(system: GameSystem): void

  // Tick / Frame delegation
  processAllTicks(tick: number): void
  updateAll(dt: number): void

  // Pause / Resume (delegates to tick/frame provider if available)
  pause(): void
  resume(): void

  // Lifecycle
  start(hooks?: GameWorldHooks): void
  stop(): void
  dispose(): void
}

interface GameWorldConfig {
  componentTypes?: symbol[]
  tickRate?: number                    // default 60
  maxFrameTime?: number                // default 0.25
  tickFrameProvider?: ITickFrameProvider  // e.g. PhalanxClient
  pooling?: PoolingConfig              // Object pooling configuration
  debug?: boolean                      // Enable debug features (default: false)
  debugConfig?: DebugDataProviderConfig
  debugPanelConfig?: DebugPanelConfig
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
  getAllEntities(): Entity[]
  queryEntities(...componentTypes: symbol[]): Entity[]
  queryEntitiesAny(...componentTypes: symbol[]): Entity[]
  cleanupDestroyed(): Entity[]
  count: number

  // SoA store management
  getSoAStore<S>(schema: SoASchema<S>): SoAComponentStore<S> | undefined
  getOrCreateSoAStore<S>(schema: SoASchema<S>, capacity?: number): SoAComponentStore<S>
  hasSoAStore(schema: SoASchema): boolean
}
```

### SystemContext

```typescript
class SystemContext {
  readonly eventBus: EventBus
  readonly entityManager: EntityManager
  abilities: IAbilitySystem | undefined   // set by createAbilitySystem() before registerSystems()
  physics: IPhysicsWorld | undefined      // set by game bootstrap before registerSystems()
  pools: PoolManager | null               // wired automatically when pooling is configured

  getSystem<T extends GameSystem>(systemClass: new (...args: any[]) => T): T | undefined
}
```

Set optional services on `world.context` before calling `registerSystems()`:

```typescript
import { PhysicsWorld } from '@phalanx-engine/physics';

const physicsWorld = new PhysicsWorld({ tickRate: 20 });
world.context.physics = physicsWorld;

// Systems access it via the protected getter:
class RenderSystem extends GameSystem {
  update(_dt: number): void {
    const sample = this.physics?.getInterpolatedTransform(entityId);
  }
}
```

### IPhysicsWorld (optional contract)

Implemented by `PhysicsWorld` from phalanx-physics. Keeps phalanx-ecs dependency-free via `unknown` for fixed-point types.

```typescript
interface IPhysicsWorld {
  getInterpolatedTransform(entityId: number): InterpolatedTransformSample | undefined
  getEntityPosition(entityId: number): { x: unknown; z: unknown } | undefined
  applyImpulse(entityId: number, vx: unknown, vz: unknown): void
}

interface InterpolatedTransformSample {
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
}
```

### System Lifecycle Hooks

Systems can implement optional hook interfaces. GameWorld calls them automatically at the correct pipeline phase (before user-supplied `GameWorldHooks` for "before" variants, after tick/frame systems for "after" variants):

```
Tick:  IBeforeTick systems → beforeTick hook → tick systems → IAfterTick systems → afterTick hook
Frame: IBeforeFrame systems → beforeFrame hook → frame systems → IAfterFrame systems → afterFrame hook
```

```typescript
import { GameSystem, type IBeforeTick, type IAfterTick, type IBeforeFrame } from '@phalanx-engine/ecs';

class MySystem extends GameSystem implements IBeforeTick, IAfterTick {
  beforeTick(tick: number, commands: CommandsBatch): void { /* snapshot state */ }
  afterTick(tick: number): void { /* capture state */ }
}
```

Type guards are also exported: `isBeforeTick`, `isAfterTick`, `isBeforeFrame`, `isAfterFrame`.

### SystemRegistry (Low-level)

```typescript
class SystemRegistry {
  constructor(componentTypes?: symbol[])
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
  listenerCount(eventType: string): number
}
```

### TickFrameManager

```typescript
class TickFrameManager implements ITickFrameProvider {
  constructor(config?: { tickRate?: number; maxFrameTime?: number })
  onTick(callback: (tick: number, commands: CommandsBatch) => void): Unsubscribe
  onFrame(callback: (alpha: number, deltaTime: number) => void): Unsubscribe
  onPause(handler: PauseHandler): Unsubscribe
  onResume(handler: PauseHandler): Unsubscribe
  start(): void
  stop(): void
  requestPause(): void
  requestResume(): void
  dispose(): void
  getCurrentTick(): number
  getTickRate(): number
  isActive(): boolean
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

  // Optional pause/resume support
  requestPause?(): void;
  requestResume?(): void;
  onPause?(handler: PauseHandler): Unsubscribe;
  onResume?(handler: PauseHandler): Unsubscribe;
}

type TickHandler = (tick: number, commands: CommandsBatch) => void;
type FrameHandler = (alpha: number, dt: number) => void;
type PauseHandler = () => void;
```

## Component Types: IComponent vs SoAComponent

Phalanx ECS offers two component types. Choose based on your performance and data layout needs.

### IComponent (Standard Components)

Simple class-based components that store data in regular object properties.

**Use when:**
- The component is accessed infrequently (e.g., flags, config, UI state)
- There are few instances (e.g., a single `ResourceComponent` per player)
- The data is complex or polymorphic (nested objects, arrays, callbacks)
- You want maximum simplicity

```typescript
import type { IComponent } from '@phalanx-engine/ecs';

class ArmorComponent implements IComponent {
  public readonly type = ComponentType.Armor;
  constructor(public armor: number = 10) {}
}

// Usage: attach to entity as usual
entity.addComponent(new ArmorComponent(15));
```

### SoAComponent (Structure-of-Arrays Components)

Components backed by contiguous typed arrays (`Float64Array`, `BigInt64Array`, etc.) for cache-friendly memory layout.

**Use when:**
- The component is iterated every tick in a hot loop (physics, transforms, velocities)
- There are many instances (hundreds/thousands of entities)
- The data is flat numeric fields (positions, velocities, radii)
- You need deterministic fixed-point storage via `BigInt64Array` (`'i64'` fields)

**Avoid when:**
- The data is complex (nested objects, strings, variable-length arrays)
- There are very few instances — the typed-array overhead isn't worth it
- The component is rarely queried

```typescript
import { SoAComponent, defineSoASchema } from '@phalanx-engine/ecs';

// 1. Define a schema — maps field names to typed-array element types
const PhysicsSoASchema = defineSoASchema({
  velocityX: 'i64',   // BigInt64Array — deterministic fixed-point
  velocityY: 'i64',
  velocityZ: 'i64',
  radius: 'i64',
  isStatic: 'u8',     // Uint8Array — boolean flag
}, 'PhysicsBody');

// 2. Extend SoAComponent
class PhysicsBodyComponent extends SoAComponent<typeof PhysicsSoASchema.definition> {
  public readonly type = ComponentType.PhysicsBody;
  static readonly soaSchema = PhysicsSoASchema;

  constructor(entityId: number, radius: bigint) {
    super(PhysicsSoASchema, entityId, {
      velocityX: 0n,
      velocityY: 0n,
      velocityZ: 0n,
      radius: radius,
      isStatic: 0,
    });
  }

  // Getters/setters provide a clean API over raw array access
  get radiusRaw(): bigint {
    return this.store.arrays.radius[this.getIndex()];
  }
}

// 3. Hot-path systems should bypass the component facade and access arrays directly
//    Cache store references in init(), iterate entityIds() in tick methods
const store = entityManager.getSoAStore(PhysicsSoASchema)!;

// Single-store loop — ideal case, zero cross-store overhead
for (const entityId of store.entityIds()) {
  const idx = store.indexOf(entityId);
  store.arrays.velocityX[idx] += accelerationX;
}

// Cross-store loop — needed when correlating two SoA stores
const txStore = entityManager.getSoAStore(TransformSoASchema)!;
const velocityX = store.arrays.velocityX;
const fpPositionX = txStore.arrays.fpPositionX;
for (const entityId of store.entityIds()) {
  const physIdx = store.indexOf(entityId);
  const txIdx = txStore.indexOf(entityId);  // one Map.get() per entity
  if (txIdx === -1) continue;
  fpPositionX[txIdx] += velocityX[physIdx];
}
```

**Important:** The facade (getters/setters on `SoAComponent`) is convenient for infrequent
access (spawning, event handlers) but adds overhead in hot loops — each field access calls
`getIndex()` (a `Map.get()` + stale check). Direct store access removes this overhead.

### SoA Field Types

| Type   | TypedArray       | JS Value  | Use Case                                |
| ------ | ---------------- | --------- | --------------------------------------- |
| `f64`  | `Float64Array`   | `number`  | Floating-point values, visual positions |
| `f32`  | `Float32Array`   | `number`  | Lower-precision floats                  |
| `i32`  | `Int32Array`     | `number`  | Signed integers                         |
| `u32`  | `Uint32Array`    | `number`  | Unsigned integers                       |
| `u8`   | `Uint8Array`     | `number`  | Flags, booleans (0/1)                   |
| `i64`  | `BigInt64Array`  | `bigint`  | Fixed-point raw values (deterministic)  |

### SoA Store Lifecycle

Stores are **lazily created** when the first `SoAComponent` of a given schema is instantiated. `GameWorld` sets the `EntityManager` context automatically — no manual store registration needed.

```
GameWorld created → SoAComponent.useEntityManager(em)
First PhysicsBodyComponent constructed → store created in EntityManager
Subsequent PhysicsBodyComponents → share the same store
GameWorld disposed → SoAComponent.resetContext()
```

## Object Pooling

Phalanx ECS includes a built-in pooling system to avoid garbage collection spikes in hot loops. This is critical for deterministic lockstep games where GC pauses can cause missed ticks.

### ObjectPool

Generic pool for any object implementing `IPoolable`:

```typescript
import { ObjectPool } from '@phalanx-engine/ecs';
import type { IPoolable } from '@phalanx-engine/ecs';

class Particle implements IPoolable {
  x = 0; y = 0; life = 0;
  reset(): void { this.x = 0; this.y = 0; this.life = 0; }
}

const pool = new ObjectPool(() => new Particle(), { initialSize: 100 });
pool.prewarm(100);

const p = pool.acquire();  // reuses an existing object or creates new
p.x = 10; p.life = 60;
pool.release(p);           // returns to pool, calls reset()
```

### Entity pooling with GameWorld

Attach all components once in the entity constructor. Use `IPoolableEntity` for per-spawn values and let the engine handle SoA row lifecycle automatically:

```typescript
import { GameWorld, Entity, type IPoolableEntity } from '@phalanx-engine/ecs';

export interface ProjectileSpawnArgs {
  fpPosition: FPVector3;
  fpDirection2: FPVector2;
  teamId: number;
}

export class ProjectileEntity extends Entity implements IPoolableEntity<ProjectileSpawnArgs> {
  private readonly transform: TransformComponent;
  private readonly projectile: ProjectileComponent;

  constructor() {
    super();
    this.addComponent(MeshComponent.createProjectile(radius));
    this.projectile = this.addComponent(new ProjectileComponent());
    // SoA rows are auto-managed — attach wrappers once, never call reattach/detach
    this.transform = this.addComponent(new TransformComponent(this.id));
    this.addComponent(new PhysicsBodyComponent(this.id, { radius }));
  }

  onSpawn(args: ProjectileSpawnArgs): void {
    this.transform.fpPosition = args.fpPosition;
    this.projectile.fpDirection2 = args.fpDirection2;
    this.teamId = args.teamId;
  }

  onDespawn(): void {
    this.active = false;
  }
}

const world = new GameWorld({
  componentTypes: Object.values(ComponentType),
  pooling: {
    autoPrewarm: true,
    entityTypes: {
      projectile: {
        factory: () => new ProjectileEntity(),
        pool: { initialSize: 50, maxSize: 200 },
      },
    },
  },
});

// Spawn: component onSpawn() → entity.onSpawn(args) → EntityManager.addEntity()
const projectile = world.pools!.spawn<ProjectileEntity>('projectile', {
  fpPosition: spawnPosition,
  fpDirection2: direction2,
  teamId: caster.teamId,
});

// Despawn: EntityManager.removeEntity() → entity.onDespawn() → component onDespawn() → pool
world.pools!.despawn(projectile);
```

### PoolManager

`PoolManager` is constructed with an `EntityManager` and wired automatically when `pooling` is configured on `GameWorld`. Game code uses `spawn()` / `despawn()` — not low-level `acquire()` / `release()`:

```typescript
// Diagnostics
const stats = world.pools!.getStats(); // Map<string, PoolStats>
```

### IPoolableComponent

Components that manage backing storage (SoA rows, mesh visibility) implement `IPoolableComponent`. The engine calls these hooks automatically — game code never does:

```typescript
import type { IPoolableComponent } from '@phalanx-engine/ecs';

// SoAComponent implements IPoolableComponent generically — subclasses need no changes.
// Custom render components can toggle visibility in onSpawn/onDespawn:

class MeshComponent implements IPoolableComponent {
  onSpawn(): void { this.mesh.isVisible = true; }
  onDespawn(): void { this.mesh.isVisible = false; }
}
```

`EntityPool` remains available as a low-level storage primitive; prefer `PoolManager.spawn()` / `despawn()` for gameplay entities.

## Creating Custom Systems

```typescript
import { GameSystem, SystemContext } from '@phalanx-engine/ecs';

class MySystem extends GameSystem {
  init(context: SystemContext): void {
    super.init(context);

    // Optional: resolve other systems or optional services
    const movement = context.getSystem(MovementSystem);
    const physics = this.physics;   // IPhysicsWorld | undefined
    const abilities = this.abilities; // IAbilitySystem | undefined

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

## EventBus vs Direct System Calls

In a deterministic lockstep game, not every action needs to go through the network. Use this guideline to decide:

| Scenario | Mechanism | Why |
| --- | --- | --- |
| **Player commands** (move, attack, place unit) | Network → EventBus | Only player intent crosses the wire; all clients execute the same commands |
| **Simulation-internal decisions** (combat chase, resume movement after target dies, AI pathing) | Direct system call via `context.getSystem()` | These are deterministic outcomes computed identically on every client during tick processing — sending them through the network would be redundant and add latency |
| **Cross-system notifications** (damage dealt, entity spawned, animation trigger) | EventBus (local) | Keeps systems decoupled without network overhead |

### Example: Direct System Call for Combat Movement

When CombatSystem decides a unit should chase a target or resume its original waypoint after killing an enemy, it calls `MovementSystem.moveEntityTo()` directly instead of emitting a network event:

```typescript
export class CombatSystem extends GameSystem {
  private movementSystem!: MovementSystem;

  init(context: SystemContext): void {
    super.init(context);
    // Resolve at init — guaranteed to be available during tick processing
    const ms = context.getSystem(MovementSystem);
    if (!ms) throw new Error('CombatSystem requires MovementSystem');
    this.movementSystem = ms;
  }

  private requestMove(entityId: number, target: Vector3): void {
    // Direct call — deterministic, no network round-trip
    this.movementSystem.moveEntityTo(entityId, target);
  }
}
```

**Rule of thumb:** if every client will compute the same result from the same game state, call the system directly. If the action originates from a specific player's input, send it through the network.

## License

MIT
