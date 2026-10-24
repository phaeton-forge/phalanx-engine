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

- **GameSystem**: Base class for all game systems (convenience accessors for `eventBus`, `entityManager`, `pools`, `random`, `world`)
- **SystemRegistry**: Low-level system lifecycle and execution order (used internally by GameWorld)
- **SystemContext**: Dependency injection container (`eventBus`, `entityManager`, `pools`, services via `provide` / `getService` / `tryGetService`)
- **ISystemLifecycleHooks**: Optional `IBeforeTick`, `IAfterTick`, `IBeforeFrame`, `IAfterFrame` interfaces — GameWorld invokes them automatically

### Event System

- **EventBus**: Decoupled communication between systems

### Tick/Frame Management

- **ITickFrameProvider**: Required clock. The single-player provider lives in `@phalanx-engine/runtime`
- Compatible with PhalanxClient for multiplayer

### SoA (Structure-of-Arrays) Storage

- **SoA components**: `defineComponent` with integer fields, backed by contiguous typed arrays
- **SoAComponentStore**: Dense, cache-friendly storage with O(1) entity lookup
- **defineSoASchema**: Type-safe schema definition for SoA field layout

### Object Pooling

- **ObjectPool**: Generic LIFO pool for any `IPoolable` object
- **EntityPool**: Low-level entity storage with stable IDs and growth stats
- **PoolManager**: Orchestrates spawn/despawn lifecycle and EntityManager registration
- **IPoolableEntity**: Per-entity `onSpawn(args)` / `onDespawn()` hooks for typed value assignment
- **Component lifecycle**: `onCreate` / `onEnable` / `onDisable` / `onDestroy`. The engine calls them. SoA row reset stays internal.

## Installation

```bash
npm install @phalanx-engine/ecs
```

## Usage

### Single-player Mode

```typescript
import { GameWorld } from '@phalanx-engine/ecs';
import { TickFrameManager } from '@phalanx-engine/runtime/advanced';

const provider = new TickFrameManager({ tickRate: 60, maxFrameTime: 0.25 });
const world = new GameWorld({ tickFrameProvider: provider });

// Create and register your systems
const movementSystem = new MovementSystem();
const renderSystem = new RenderSystem();

world.registerSystems(
  [movementSystem], // Tick systems (deterministic)
  [renderSystem] // Frame systems (visual)
);

// The caller starts the provider. GameWorld only subscribes.
provider.start();
world.start();
```

### Multiplayer Mode (with Phalanx Client)

```typescript
import { PhalanxClient } from '@phalanx-engine/client';
import { GameWorld } from '@phalanx-engine/ecs';
import { DeterministicRandom } from '@phalanx-engine/math';

// Initialize Phalanx Client
const client = new PhalanxClient({
  serverUrl: 'wss://your-server.com',
  // ... other config
});

// waitForGameStart() first. randomSeed is the only RNG fact the client has.
const seed = client.randomSeed;
if (seed === null) throw new Error('match seed missing');
const world = new GameWorld({
  tickFrameProvider: client,
  random: new DeterministicRandom(seed),
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
import { SystemRegistry } from '@phalanx-engine/ecs';
import { TickFrameManager } from '@phalanx-engine/runtime/advanced';

const registry = new SystemRegistry();
registry.registerSystems(tickSystems, frameSystems);

const tickManager = new TickFrameManager({ tickRate: 60 });
tickManager.onTick((tick) => registry.processAllTicks(tick));
tickManager.onFrame((alpha, dt) => {
  registry.updateAll(dt);
});
tickManager.start();
```

## API Reference

### GameWorld

```typescript
class GameWorld {
  constructor(config: GameWorldConfig);

  // Convenience accessors
  get eventBus(): EventBus;
  get entityManager(): EntityManager;
  get context(): SystemContext;
  get pools(): PoolManager | null;
  get paused(): boolean;
  getSystem<T extends GameSystem>(
    systemClass: new (...args: any[]) => T
  ): T | undefined;

  // System registration
  registerSystems(tickSystems: GameSystem[], frameSystems: GameSystem[]): void;
  addFrameSystem(system: GameSystem): void;

  // Tick / Frame delegation
  processAllTicks(tick: number): void;
  updateAll(dt: number): void;

  // Pause / Resume (delegates to tick/frame provider if available)
  pause(): void;
  resume(): void;

  // Lifecycle
  start(hooks?: GameWorldHooks): void;
  stop(): void;
  dispose(): void;
}

interface GameWorldConfig {
  tickFrameProvider: ITickFrameProvider; // required; GameWorld does not start it
  pooling?: PoolingConfig; // Object pooling configuration
  random?: IRandom;
}

interface GameWorldHooks {
  beforeTick?(tick: number, commands: CommandsBatch): void;
  afterTick?(tick: number): void;
  beforeFrame?(alpha: number, dt: number): void;
  afterFrame?(alpha: number, dt: number): void;
}
```

### EntityManager

```typescript
class EntityManager {
  addEntity(entity: Entity): void;
  removeEntity(entity: Entity): void;
  getEntity(id: number): Entity | undefined;
  getAllEntities(): Entity[];
  queryEntities(...componentTypes: symbol[]): Entity[];
  queryEntitiesAny(...componentTypes: symbol[]): Entity[];
  cleanupDestroyed(): Entity[];
  count: number;

  // SoA store management
  getSoAStore<S>(schema: SoASchema<S>): SoAComponentStore<S> | undefined;
  getOrCreateSoAStore<S>(
    schema: SoASchema<S>,
    capacity?: number
  ): SoAComponentStore<S>;
  hasSoAStore(schema: SoASchema): boolean;
}
```

### SystemContext

```typescript
class SystemContext {
  readonly eventBus: EventBus;
  readonly entityManager: EntityManager;
  pools: PoolManager | null; // wired automatically when pooling is configured

  provide<T>(key: ServiceKey<T>, impl: T): void; // same as world.provide
  getService<T>(key: ServiceKey<T>): T; // throws, listing provided names
  tryGetService<T>(key: ServiceKey<T>): T | undefined;
  serviceNames(): readonly string[];
  getSystem<T extends GameSystem>(
    systemClass: new (...args: any[]) => T
  ): T | undefined;
}
```

### Services

A service is a per-world object found by a typed key. Keys compare by
reference; the name is for error messages.

```typescript
import { defineService } from '@phalanx-engine/ecs';

export const Clock = defineService<ClockService>('clock'); // module scope
world.provide(Clock, new ClockService()); // before registerSystems()

class MySystem extends GameSystem {
  processTick(): void {
    const clock = this.context.getService(Clock);
  }
}
```

`world.provide` throws on a second provide of the same key, and on a
different key with a name that is already taken (usually two copies of one
package in the bundle). `getService` throws with the missing name and the
provided ones. Services talk to each other through the world event bus;
direct calls go through `getService`.

`PhysicsWorld.attach(world)` provides `Physics` (`@phalanx-engine/physics`).
`createAbilitySystem(world, ...)` provides `Abilities`
(`@phalanx-engine/abilities`). Ability tick systems are not appended by
`registerSystems`; pass `abilities.tickSystems` yourself.

### Query

```typescript
for (const [entity, hpRow, tag] of world.query(Hp, Tag)) {
  hp[hpRow] -= 1; // SoA slot: row index into store.arrays
  tag.label; // object or transient slot: the stored value
}
for (const [entity, hpRow, tag] of world.queryAny(Hp, Tag)) {
  // absent components are undefined
}
```

- Entities come ascending by id.
- The id list is taken when the loop starts. An entity removed, or one that
  lost a queried component, before its turn is skipped. Entities created
  during the loop are not visited in this pass.
- The row array is reused between steps. Do not keep it.
- A SoA row index is valid until the next add or remove in that store.
  Removal swaps the last row into the hole, so read the index inside the
  step that produced it.
- Reading a transient component during a tick throws.
- An empty component list throws.
- Pass `defineComponent` results directly. A component widened to
  `QueryComponent` types its slot as `number | object`.
- A SoA component attached without a store row throws (store desync).

`EntityManager.queryEntities(...symbols)` stays for code not yet on
`defineComponent`.

### System Lifecycle Hooks

Systems can implement optional hook interfaces. GameWorld calls them automatically at the correct pipeline phase (before user-supplied `GameWorldHooks` for "before" variants, after tick/frame systems for "after" variants):

```
Tick:  IBeforeTick systems → beforeTick hook → tick systems → IAfterTick systems → afterTick hook
Frame: IBeforeFrame systems → beforeFrame hook → frame systems → IAfterFrame systems → afterFrame hook
```

```typescript
import {
  GameSystem,
  type IBeforeTick,
  type IAfterTick,
  type IBeforeFrame,
} from '@phalanx-engine/ecs';

class MySystem extends GameSystem implements IBeforeTick, IAfterTick {
  beforeTick(tick: number, commands: CommandsBatch): void {
    /* snapshot state */
  }
  afterTick(tick: number): void {
    /* capture state */
  }
}
```

Type guards are also exported: `isBeforeTick`, `isAfterTick`, `isBeforeFrame`, `isAfterFrame`.

### SystemRegistry (Low-level)

```typescript
class SystemRegistry {
  constructor();
  registerSystems(tickSystems: GameSystem[], frameSystems: GameSystem[]): void;
  processAllTicks(tick: number): void;
  updateAll(deltaTime: number): void;
  getContext(): SystemContext;
  dispose(): void;
}
```

### EventBus

```typescript
class EventBus {
  on<T>(eventType: string, callback: (data: T) => void): UnsubscribeFunction;
  once<T>(eventType: string, callback: (data: T) => void): UnsubscribeFunction;
  off<T>(eventType: string, callback: (data: T) => void): void;
  emit<T>(eventType: string, data: T): void;
  clear(eventType: string): void;
  clearAll(): void;
  listenerCount(eventType: string): number;
}
```

### Tick provider

`TickFrameManager` and the debug overlay (`attachDebug`, `DebugDataProvider`, `DebugPanel`) live in `@phalanx-engine/runtime`. `GameWorld` does not construct them. `start()` / `stop()` subscribe and unsubscribe; they do not start or stop the provider.

### ITickFrameProvider

The shared interface that both the runtime single-player provider and `PhalanxClient` satisfy.
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

`ITickFrameProvider` does not carry the match RNG. `GameWorldConfig.random` is the only source. When it is omitted, `world.random` throws `SystemContext.random is not configured: pass GameWorldConfig.random`.

## Component Types: IComponent vs SoA components

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

### SoA components (Structure-of-Arrays)

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
import { defineComponent } from '@phalanx-engine/ecs';

// 1. Define the component: integer fields, saved and part of configHash
export const Velocity = defineComponent(
  'Velocity',
  { velocityX: 'i64', velocityY: 'i64', velocityZ: 'i64', speed: 'i64' },
  { defaults: { speed: 0n } }
);
world.registerComponent(Velocity);

// 2. Attach in the entity constructor; the row reaches the store of the
//    world that owns the entity (createEntity, pool factory or addEntity)
class Mover extends Entity {
  constructor(id: number, speed: bigint) {
    super(id);
    this.addComponent(Velocity.create(id, { speed }));
  }
}
// On a registered entity, world.addComponent / world.getComponent / world.removeComponent work too.

// 3. Hot-path systems should bypass the component facade and access arrays directly
//    Cache store references in init(), iterate entityIds() in tick methods
const store = entityManager.getSoAStore(Velocity.schema)!;

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
  const txIdx = txStore.indexOf(entityId); // one Map.get() per entity
  if (txIdx === -1) continue;
  fpPositionX[txIdx] += velocityX[physIdx];
}
```

**Important:** `world.getComponent` returns a copy and allocates. Use it for infrequent access
(spawning, event handlers); hot loops read the store arrays directly.

### SoA Field Types

| Type  | TypedArray      | JS Value | Use Case                                |
| ----- | --------------- | -------- | --------------------------------------- |
| `f64` | `Float64Array`  | `number` | Floating-point values, visual positions |
| `f32` | `Float32Array`  | `number` | Lower-precision floats                  |
| `i32` | `Int32Array`    | `number` | Signed integers                         |
| `u32` | `Uint32Array`   | `number` | Unsigned integers                       |
| `u8`  | `Uint8Array`    | `number` | Flags, booleans (0/1)                   |
| `i64` | `BigInt64Array` | `bigint` | Fixed-point raw values (deterministic)  |

### SoA Store Lifecycle

Stores belong to one world. `registerComponent` creates the store; an
unregistered schema gets its store on the first row. There is no
process-global context: a row is written when the entity's owning world
binds it, so two worlds in one process never share a store and disposing
one does not touch the other.

```
world.createEntity / pool factory / addEntity → entity owned by that world
Constructor rows → written to that world's stores
Later rows of that schema → share the same store
```

## Object Pooling

Phalanx ECS includes a built-in pooling system to avoid garbage collection spikes in hot loops. This is critical for deterministic lockstep games where GC pauses can cause missed ticks.

### ObjectPool

Generic pool for any object implementing `IPoolable`:

```typescript
import { ObjectPool } from '@phalanx-engine/ecs';
import type { IPoolable } from '@phalanx-engine/ecs';

class Particle implements IPoolable {
  x = 0;
  y = 0;
  life = 0;
  reset(): void {
    this.x = 0;
    this.y = 0;
    this.life = 0;
  }
}

const pool = new ObjectPool(() => new Particle(), { initialSize: 100 });
pool.prewarm(100);

const p = pool.acquire(); // reuses an existing object or creates new
p.x = 10;
p.life = 60;
pool.release(p); // returns to pool, calls reset()
```

### Entity pooling with GameWorld

Attach all components once in the entity constructor. Use `IPoolableEntity` for per-spawn values and let the engine handle SoA row lifecycle automatically:

```typescript
import { GameWorld, Entity, type IPoolableEntity } from '@phalanx-engine/ecs';
import {
  attachPhysicsBody,
  attachTransform,
  writeFpPosition,
} from '@phalanx-engine/physics';

export interface ProjectileSpawnArgs {
  fpPosition: FPVector3;
  fpDirection2: FPVector2;
  teamId: number;
}

export class ProjectileEntity
  extends Entity
  implements IPoolableEntity<ProjectileSpawnArgs>
{
  private readonly projectile: ProjectileComponent;

  constructor(id: number) {
    super(id);
    this.addComponent(MeshComponent.createProjectile(radius));
    this.projectile = this.addComponent(new ProjectileComponent());
    attachTransform(this);
    attachPhysicsBody(this, { radius });
  }

  onSpawn(args: ProjectileSpawnArgs): void {
    writeFpPosition(this, args.fpPosition);
    this.projectile.fpDirection2 = args.fpDirection2;
    this.teamId = args.teamId;
  }

  onDespawn(): void {
    this.active = false;
  }
}

const world = new GameWorld({
  pooling: {
    autoPrewarm: true,
    entityTypes: {
      projectile: {
        factory: (id) => new ProjectileEntity(id),
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

### Component lifecycle

`onCreate` runs when the component is added. `onEnable` runs on pool spawn, on `spawn`, and again after `restoreWorld`. `onDisable` runs when a live entity returns to the pool or is despawned. `onDestroy` runs from `dispose`, including pool `drain`.

`onEnable` after restore must not overwrite saved fields. Per-spawn simulation writes belong in the entity `onSpawn`.

SoA rows are reset by internal storage hooks (the row's `onSpawn` / `onDespawn`). Those hooks are not a public import. Presentation such as mesh visibility belongs in `onEnable` / `onDisable`:

```typescript
import type { IComponent } from '@phalanx-engine/ecs';

class MeshComponent implements IComponent {
  readonly type = MeshType;
  onEnable(): void {
    this.mesh.isVisible = true;
  }
  onDisable(): void {
    this.mesh.isVisible = false;
  }
}
```

Saving, restoring and spawning by component name are `@phalanx-engine/runtime` functions (`saveWorld`, `restoreWorld`, `spawn`, `despawn`, `each`); `GameWorld` has no such methods. `registerComponent` records a `defineComponent` result in registration order. The object passed to `each` is one view reused for every row. Do not store it, and do not read it after the callback returns.

`defineComponent` in this package is the component definition domain code imports. The runtime package still exports its SoA-only helper for `defineGame`.

```typescript
import { defineComponent, writeSorted, GameWorld } from '@phalanx-engine/ecs';

const Hp = defineComponent('Hp', { hp: 'i64' }, { defaults: { hp: 10n } });
const Bag = defineComponent('Bag', {
  kind: 'object',
  create: () => ({ tags: new Set<string>() }),
  save(value, writer) {
    writeSorted(writer, value.tags, (tag, item) => item.str(tag));
  },
  load(reader) {
    return { tags: new Set(reader.list((item) => item.str())) };
  },
});
const Visual = defineComponent('Visual', {
  kind: 'transient',
  create: () => ({ x: 0 }),
});

world.registerComponent(Hp);
world.registerComponent(Bag);
world.registerComponent(Visual);
world.addComponent(entity, Hp, { hp: 4n });
world.getComponent(entity, Hp); // { hp: 4n }
```

SoA fields are `i32`, `u32`, `u8`, `i64`. They are saved and included in `configHash`. An object component without `save` and `load` throws at `registerComponent`. `writeSorted` orders `Set` and `Map` keys (UTF-16 for strings, numeric for safe integers). A transient component is display-only: it is omitted from the save and from `configHash`, and a tick system that reads it (`world.getComponent`, `getComponent`, `hasComponent`, `hasComponents`, or a query) throws. `restoreWorld` drops transient components first. Physics does not use the discarded-id list: `readBroadphase` attaches `Interpolation` to every entity with `Transform` and `PhysicsBody` and seeds both samples from the transform. Object and transient values are stored in `ValueComponent`. A module that saves, attaches and resets an object component itself registers it with `world.registerComponent(def, { module, attachWith })` (`ModuleComponentOptions`): no per-component save section, not dropped on pool return, and `world.addComponent` throws `world.addComponent: 'Name' is owned by <module>; attach it with <attachWith>`. `entity.addComponents(list)` attaches several prebuilt components (e.g. `abilities.initComponent(init)`).

`EntityPool` remains available as a low-level storage primitive; prefer `PoolManager.spawn()` / `despawn()` for gameplay entities.

## Creating Custom Systems

```typescript
import { GameSystem, SystemContext } from '@phalanx-engine/ecs';

class MySystem extends GameSystem {
  init(context: SystemContext): void {
    super.init(context);

    // Optional: resolve other systems or services
    const movement = context.getSystem(MovementSystem);
    const physics = context.tryGetService(Physics); // PhysicsWorld | undefined
    const abilities = context.tryGetService(Abilities); // AbilitySystem | undefined

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

| Scenario                                                                                        | Mechanism                                    | Why                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Player commands** (move, attack, place unit)                                                  | Network → EventBus                           | Only player intent crosses the wire; all clients execute the same commands                                                                                         |
| **Simulation-internal decisions** (combat chase, resume movement after target dies, AI pathing) | Direct system call via `context.getSystem()` | These are deterministic outcomes computed identically on every client during tick processing — sending them through the network would be redundant and add latency |
| **Cross-system notifications** (damage dealt, entity spawned, animation trigger)                | EventBus (local)                             | Keeps systems decoupled without network overhead                                                                                                                   |

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

## Save sections

`StateWriter`, `StateReader`, `BinaryStateWriter` and `BinaryStateReader` are the snapshot codec. A module implements `SaveSection` (`key`, `version`, `write`, `read`) and calls `world.registerSaveSection`. Keys sort by UTF-16 code units (`'Z' < 'a'`). `saveSections` returns a copy. An empty key throws `registerSaveSection: key is empty`. A repeated key throws `registerSaveSection: duplicate key '<key>'`. The runtime writes the registered sections; ecs does not.

Restore rejects a modules container with:

- `restore: unknown save section '<key>' (registered: a, b)`
- `restore: save section '<key>' is missing from the snapshot`
- `restore: save sections out of order`
- `restore: save section '<key>' has version N, expected M`

## Entity ids

Each `EntityManager` owns its id counter, starting at `0`. `GameWorld` does not reset a process-global counter. `world.createEntity((id) => new Entity(id))` allocates the next id and does not register the entity. `world.createEntityWithId(id, create?)` builds that exact id, raises the high-water mark to `max(current, id)` and registers it. A hole does not rewind the next id. Pass the id into a subclass constructor (`super(id)`). Pool factories are `(id: number, manager: EntityManager) => T`; `manager` owns the entity and its SoA rows.

```typescript
const entity = world.createEntity((id) => new Entity(id));
const restored = world.createEntityWithId(5, (id) => new Unit(id));
const highWater = world.entityManager.entityIdHighWater(); // last allocated id
world.entityManager.restoreEntityIdHighWater(highWater); // next id is highWater + 1

const typeKeys = world.pools?.typeKeys() ?? []; // registration order
const owned = world.pools?.ownedIds(typeKeys[0]); // creation order
const freeList = world.pools?.freeListIds(typeKeys[0]); // oldest release first; acquire pops the last
```

`restoreEntityIdHighWater` throws if the value is not an integer `>= 0` (`restoreEntityIdHighWater: value must be an integer >= 0`). A lower value is accepted and the next id can collide. `createEntityWithId` throws `createEntityWithId: entity N already exists` when that id is registered, and `createEntityWithId: id must be an integer >= 1` for a bad id. There is no process-global SoA context: an entity's rows live in its owning world, and adding an entity owned by another world throws `entity N belongs to another world`. Pool `ownedIds` include checked-out entities and the free list, and omit an entity disposed outside despawn. `destroy()` does not remove the entity; the next acquire revives the same instance. `PoolManager.restore(typeKey, entities, freeListIds)` puts that free list back so the next spawn returns the same id. `drain()` still drops free-list objects.

## License

MIT
