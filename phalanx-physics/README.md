# Phalanx Physics

A deterministic, fixed-point physics engine for the [Phalanx Engine](../README.md). Designed for lockstep multiplayer games where every client must produce identical simulation results.

> Sibling packages: [phalanx-ecs](../phalanx-ecs/README.md) (ECS core), [phalanx-math](../phalanx-math/README.md) (fixed-point math), [phalanx-server](../phalanx-server/README.md), [phalanx-client](../phalanx-client/README.md).

## Features

- **Deterministic by Design**: All math uses `FP.*` fixed-point operations — no floating-point non-determinism
- **SoA Storage**: Physics body data stored in contiguous typed arrays (`BigInt64Array` for fixed-point, `Uint8Array` for flags) via phalanx-ecs `SoAComponent`
- **Spatial Hash Grid**: O(n) broad-phase collision detection with configurable cell size
- **Narrow Phase**: Circle vs Circle, Circle vs AABB, and AABB vs AABB collision tests
- **Impulse Resolution**: Mass-weighted velocity impulse + positional separation for overlap correction
- **Sub-stepping**: Configurable physics sub-steps per tick for higher fidelity at the same tick rate
- **Collision Filtering**: Inject game-specific collision rules via callback — no coupling to game concepts
- **Tick Providers**: Pluggable `IPhysicsTickProvider` interface decouples tick scheduling from simulation logic — supports GameWorld-driven, autonomous (turn-based), and external (rAF) modes
- **Impulse API**: `applyImpulse()` sets body velocity for flick/strike mechanics; `isSettled()` queries whether all bodies are at rest
- **Bounds Exit Mode**: Optional `ejectOnBoundsExit` mode marks out-of-bounds bodies as ignored and emits `BOUNDS_EXIT` events instead of clamping
- **Event-Driven**: Collision, trigger enter, trigger exit, and bounds exit events emitted via phalanx-ecs `EventBus`
- **Visual Position Sync**: Optional automatic sync of f64 visual caches alongside i64 authoritative positions
- **PhysicsWorld Facade**: One-liner setup — wraps PhysicsSystem + CollisionSystem + SpatialHashGrid

## Core Components

### PhysicsWorld (Recommended Entry Point)
- **PhysicsWorld**: High-level facade — creates systems, wires collision pipeline, exposes event subscriptions and spatial queries

### Physics Body
- **PhysicsBodyComponent**: SoA-backed component with velocity, radius, mass, restitution, friction, isStatic, and ignorePhysics fields
- **PhysicsSoASchema**: Schema definition for the SoA storage layout

### Collision Detection
- **SpatialHashGrid**: Broad-phase spatial partitioning with `queryPairs()` and `queryRadius()`
- **NarrowPhase**: Static methods for precise collision geometry tests

### Systems
- **PhysicsSystem**: Velocity integration with sub-stepping, world bounds handling, broad/narrow/resolve collision pipeline, `step()` / `applyImpulse()` / `isSettled()` / `setCollisionFilter()` API. Created and owned by `PhysicsWorld`; retrieve it via `physicsWorld.getSystems().physicsSystem` to register with `GameWorld`.

### Tick Providers
- **IPhysicsTickProvider**: Interface for custom tick scheduling strategies
- **AutonomousPhysicsTickProvider**: Runs physics loop via `setImmediate` (Node.js) or `setTimeout(0)` (browser) until settled or `maxSteps` reached — ideal for turn-based games
- **ExternalPhysicsTickProvider**: Delegates tick control to the caller (e.g. BabylonJS `onBeforeRenderObservable` or unit tests)

### Events
- **PhysicsEvents.COLLISION**: Emitted when two bodies collide
- **PhysicsEvents.TRIGGER_ENTER**: Emitted when a trigger overlap starts
- **PhysicsEvents.TRIGGER_EXIT**: Emitted when a trigger overlap ends
- **PhysicsEvents.BOUNDS_EXIT**: Emitted when a body exits `worldBounds` and `ejectOnBoundsExit` is `true`

## Installation

> ⚠️ **Not on npm yet** — clone the monorepo and install via pnpm.

```bash
git clone https://github.com/phaeton2040-AI/phalanx-engine.git
cd phalanx-engine
pnpm install
pnpm --filter phalanx-physics build
```

Peer dependencies: `phalanx-ecs` ^0.1.0, `phalanx-math` ^0.1.0

## Imports

```typescript
import {
  // Facade & config
  PhysicsWorld,
  type PhysicsWorldConfig,

  // Components
  PhysicsBodyComponent,
  PhysicsSoASchema,
  PHYSICS_BODY_COMPONENT_TYPE,
  type PhysicsBodyConfig,

  // Collision primitives
  SpatialHashGrid,
  NarrowPhase,
  type CollisionManifold,

  // System
  PhysicsSystem,

  // Events & event types
  PhysicsEvents,
  type CollisionEvent,
  type BoundsExitEvent,

  // Tick providers
  type IPhysicsTickProvider,
  AutonomousPhysicsTickProvider,
  type AutonomousProviderOptions,
  ExternalPhysicsTickProvider,

  // Misc types
  type TransformFieldMapping,
  type CollisionFilter,
  type PhysicsConfig,
} from 'phalanx-physics';
```

## Quick Start

```typescript
import { GameWorld, GameSystem, defineSoASchema } from 'phalanx-ecs';
import { PhysicsWorld, PhysicsBodyComponent } from 'phalanx-physics';
import { FP } from 'phalanx-math';

// 0. Define the transform schema your game uses (consumer-owned).
//    Physics will read fpPositionX/Y/Z and optionally write visualPositionX/Z.
const TransformSoASchema = defineSoASchema({
  fpPositionX: 'i64',
  fpPositionY: 'i64',
  fpPositionZ: 'i64',
  visualPositionX: 'f64',
  visualPositionY: 'f64',
  visualPositionZ: 'f64',
}, 'Transform');

// Minimal placeholder systems — replace with your real ones.
// MovementSystem runs BEFORE physics and writes velocities onto PhysicsBody SoA.
class MovementSystem extends GameSystem {
  public override processTick(_tick: number): void { /* set velocities here */ }
}
// RenderSystem runs in the frame pipeline (interpolation, scene updates, etc.).
class RenderSystem extends GameSystem {
  public override update(_alpha: number, _dt: number): void { /* render here */ }
}
const movementSystem = new MovementSystem();
const renderSystem = new RenderSystem();

// 1. Create GameWorld and the physics facade
const world = new GameWorld({ componentTypes: { /* your ComponentType registry */ } as any });

const physicsWorld = new PhysicsWorld({
  gridCellSize: FP.FromFloat(8),
  subSteps: 3,
  tickRate: 20,
  maxVelocity: FP.FromFloat(15),
  pushStrength: FP.FromFloat(15),
});

// 2. Register systems with GameWorld (order matters)
//    PhysicsWorld owns one PhysicsSystem that runs the full broad → narrow → resolve pipeline.
const { physicsSystem } = physicsWorld.getSystems();
world.registerSystems(
  [movementSystem, physicsSystem],   // tick systems
  [renderSystem],                    // frame systems
);

// 3. Link transform store on first tick (after stores have been created)
world.start({
  beforeTick: (tick) => {
    if (tick === 0) {
      const txStore = world.entityManager.getOrCreateSoAStore(TransformSoASchema);
      physicsWorld.setTransformStore(txStore as any, {
        fpPositionX: 'fpPositionX',
        fpPositionY: 'fpPositionY',
        fpPositionZ: 'fpPositionZ',
        // Optional: only X and Z are written by PhysicsSystem
        visualPositionX: 'visualPositionX',
        visualPositionZ: 'visualPositionZ',
      });
    }
  },
});

// 4. Add physics bodies to entities
//    (entity here is whatever your game uses — typically obtained via world.entityManager)
declare const entity: { id: number; addComponent(c: unknown): void };
const body = new PhysicsBodyComponent(entity.id, {
  radius: FP.FromFloat(1.0),
});
entity.addComponent(body);

// 5. Subscribe to collision events (must be called after world.start())
physicsWorld.onCollision((event) => {
  console.log(`Collision: ${event.entityA} ↔ ${event.entityB}`);
});
```

## Turn-Based Physics (Tick Providers)

For turn-based games like Chapayev checkers, use a tick provider to decouple simulation from the server tick loop:

```typescript
import {
  PhysicsWorld,
  AutonomousPhysicsTickProvider,
} from 'phalanx-physics';
import { FP } from 'phalanx-math';

// Game defines what "settled" means and what happens when it occurs
let physicsWorld: PhysicsWorld;

const provider = new AutonomousPhysicsTickProvider({
  isSettled: () => physicsWorld.isSettled(),
  onSettled: () => {
    // Game-level logic: turn is over
    sendTurnEnd(getCheckerPositions());
  },
});

physicsWorld = new PhysicsWorld({
  tickRate: 60,
  subSteps: 3,
  ejectOnBoundsExit: true,
  worldBounds: {
    minX: FP.FromFloat(-8), maxX: FP.FromFloat(8),
    minZ: FP.FromFloat(-8), maxZ: FP.FromFloat(8),
  },
  tickProvider: provider,
});

// Player flicks a checker
function onFlick(entityId: number, dirX: number, dirZ: number, power: number) {
  const speed = power * 12;
  physicsWorld.applyImpulse(
    entityId,
    FP.FromFloat(dirX * speed),
    FP.FromFloat(dirZ * speed),
  );
}

// Checker exits the board
physicsWorld.onBoundsExit(({ entityId }) => {
  removeChecker(entityId);
});
```

### Tick Provider Options

| Provider | Use Case |
|---|---|
| *(none / default)* | GameWorld `processTick()` drives simulation — real-time games |
| `AutonomousPhysicsTickProvider` | Runs until settled or `maxSteps` — turn-based physics |
| `ExternalPhysicsTickProvider` | Caller invokes `tick()` manually — BabylonJS rAF, unit tests |

## API Reference

### `PhysicsWorld`

```typescript
class PhysicsWorld {
  constructor(config?: PhysicsWorldConfig);

  // System wiring
  getSystems(): { physicsSystem: PhysicsSystem };
  setTransformStore(
    store: SoAComponentStore<SoASchemaDefinition>,
    fieldMapping: TransformFieldMapping
  ): void;
  setCollisionFilter(filter: (entityA: number, entityB: number) => boolean): void;

  // Event subscriptions (must be called after GameWorld.start())
  onCollision(callback: (event: CollisionEvent) => void): () => void;
  onBoundsExit(callback: (event: BoundsExitEvent) => void): () => void;

  // Planned — not yet emitted by PhysicsSystem.
  // The handlers exist and subscribe to PhysicsEvents.TRIGGER_ENTER / TRIGGER_EXIT,
  // but PhysicsSystem currently only emits COLLISION and BOUNDS_EXIT.
  onTriggerEnter(callback: (event: CollisionEvent) => void): () => void;
  onTriggerExit(callback: (event: CollisionEvent) => void): () => void;

  // Impulse / settle queries
  applyImpulse(entityId: number, vx: FixedPoint, vz: FixedPoint): void;
  isSettled(threshold?: FixedPoint): boolean;

  // Spatial query escape hatch
  readonly spatialGrid: SpatialHashGrid;

  // Cleanup
  dispose(): void;
}
```

- **`applyImpulse(entityId, vx, vz)`** — Set body velocity (replaces, does not accumulate). Re-enables previously ejected bodies.
- **`isSettled(threshold?)`** — Pure query: `true` when all non-static, non-ignored bodies are below velocity threshold (default from config, falling back to `FP.FromFloat(0.01)`).
- **`onBoundsExit(callback)`** — Subscribe to `BOUNDS_EXIT` events (requires `ejectOnBoundsExit: true`).
- **`setCollisionFilter(filter)`** — Inject a per-pair predicate. Return `false` to skip collision resolution for that pair.

### `PhysicsWorldConfig`

```typescript
interface PhysicsWorldConfig {
  gridCellSize?: FixedPoint;     // default FP.FromFloat(4)
  subSteps?: number;             // default 3
  tickRate?: number;             // default 20 — used to compute tickDt
  worldBounds?: { minX: FixedPoint; minZ: FixedPoint; maxX: FixedPoint; maxZ: FixedPoint };
  defaultRestitution?: FixedPoint;
  defaultFriction?: FixedPoint;  // default FP.FromFloat(0.92)
  maxVelocity?: FixedPoint;      // default FP.FromFloat(15)
  pushStrength?: FixedPoint;     // default FP.FromFloat(15)
  tickProvider?: IPhysicsTickProvider;
  ejectOnBoundsExit?: boolean;   // default false
  settleThreshold?: FixedPoint;  // default FP.FromFloat(0.01)
}
```

### `PhysicsBodyComponent`

```typescript
class PhysicsBodyComponent extends SoAComponent<typeof PhysicsSoASchema.definition> {
  static readonly soaSchema: typeof PhysicsSoASchema;
  readonly type: symbol; // PHYSICS_BODY_COMPONENT_TYPE

  constructor(entityId: number, config: PhysicsBodyConfig);

  // Velocity
  velocity: FPVector3;                                       // get/set (returns cached object)
  setVelocity(x: FixedPoint, y: FixedPoint, z: FixedPoint): void;
  addVelocity(velocity: FPVector3): void;
  stopVelocity(): void;

  // Read-only attributes
  readonly radius: FixedPoint;
  readonly radiusFloat: number;
  readonly mass: FixedPoint;
  readonly restitution: FixedPoint;
  readonly friction: FixedPoint;
  readonly isStatic: boolean;
  ignorePhysics: boolean;        // get/set

  // Spatial-grid bookkeeping
  lastX: number;
  lastZ: number;
}

interface PhysicsBodyConfig {
  radius: FixedPoint;
  mass?: FixedPoint;             // default FP._1
  isStatic?: boolean;            // default false
  restitution?: FixedPoint;      // default FP.FromFloat(0.5)
  friction?: FixedPoint;         // default FP._0
}
```

For hot-path access, prefer the SoA store directly:

```typescript
const store = entityManager.getOrCreateSoAStore(PhysicsSoASchema);
const idx = store.indexOf(entityId);
store.arrays.velocityX[idx] = FP.ToRaw(newVx);
```

### Collision primitives

- **`SpatialHashGrid`** — broad-phase O(n) neighbor pairing. Methods: `clear()`, `insert(...)`, `queryPairs()`, `queryRadius(...)`. Access via `physicsWorld.spatialGrid` for ad-hoc range queries.
- **`NarrowPhase`** — static methods for circle/AABB intersection tests. Returns `CollisionManifold | null`.
- **`CollisionManifold`** — `{ entityA, entityB, normalX, normalZ, penetration }`.

### Tick providers

```typescript
interface IPhysicsTickProvider {
  /** Start the provider; it calls `onStep` whenever physics should advance one step. */
  start(onStep: () => void): void;
  /** Stop the provider and release any timers/handles. */
  stop(): void;
}

interface AutonomousProviderOptions {
  /** Called every step to decide whether to stop (defined by the game). */
  isSettled: () => boolean;
  /** Called once when simulation settles or `maxSteps` is reached. */
  onSettled: () => void;
  /** Max simulation steps before forcing a stop. Default: 10000. */
  maxSteps?: number;
}

class AutonomousPhysicsTickProvider implements IPhysicsTickProvider {
  constructor(options: AutonomousProviderOptions);
  // Schedules `onStep` via setImmediate (Node) or setTimeout(0) (browser)
  // until isSettled() returns true or maxSteps is reached.
}

class ExternalPhysicsTickProvider implements IPhysicsTickProvider {
  /** Manually advance one physics step from your render loop / test harness. */
  tick(): void;
}
```

### Events

```typescript
const PhysicsEvents = {
  COLLISION:     'physics:collision',
  TRIGGER_ENTER: 'physics:trigger:enter',
  TRIGGER_EXIT:  'physics:trigger:exit',
  BOUNDS_EXIT:   'physics:bounds:exit',
} as const;

interface CollisionEvent { entityA: number; entityB: number; manifold: CollisionManifold; }
interface BoundsExitEvent { entityId: number; }
```
