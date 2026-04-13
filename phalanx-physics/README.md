# Phalanx Physics

A deterministic, fixed-point physics engine for the Phalanx Engine. Designed for lockstep multiplayer games where every client must produce identical simulation results.

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
- **PhysicsSystem**: Velocity integration with sub-stepping, world bounds handling, `step()` / `applyImpulse()` / `isSettled()` API
- **CollisionSystem**: Broad → narrow → resolve → emit pipeline per tick

### Tick Providers
- **IPhysicsTickProvider**: Interface for custom tick scheduling strategies
- **AutonomousPhysicsTickProvider**: Runs physics loop via `setImmediate`/`queueMicrotask` until settled or `maxSteps` reached — ideal for turn-based games
- **ExternalPhysicsTickProvider**: Delegates tick control to the caller (e.g. BabylonJS `onBeforeRenderObservable` or unit tests)

### Events
- **PhysicsEvents.COLLISION**: Emitted when two bodies collide
- **PhysicsEvents.TRIGGER_ENTER**: Emitted when a trigger overlap starts
- **PhysicsEvents.TRIGGER_EXIT**: Emitted when a trigger overlap ends
- **PhysicsEvents.BOUNDS_EXIT**: Emitted when a body exits `worldBounds` and `ejectOnBoundsExit` is `true`

## Installation

```bash
npm install phalanx-physics
```

Peer dependencies: `phalanx-ecs` ^0.1.0, `phalanx-math` ^0.1.0

## Quick Start

```typescript
import { GameWorld } from 'phalanx-ecs';
import { PhysicsWorld, PhysicsBodyComponent } from 'phalanx-physics';
import { FP } from 'phalanx-math';

// 1. Create the physics facade
const physicsWorld = new PhysicsWorld({
  gridCellSize: FP.FromFloat(8),
  subSteps: 3,
  tickRate: 20,
  maxVelocity: FP.FromFloat(15),
  pushStrength: FP.FromFloat(15),
});

// 2. Register systems with GameWorld (order matters)
const { physicsSystem, collisionSystem } = physicsWorld.getSystems();
world.registerSystems(
  [movementSystem, physicsSystem, collisionSystem],
  [renderSystem],
);

// 3. Link transform store on first tick
world.start({
  beforeTick: (tick) => {
    if (tick === 0) {
      const txStore = world.entityManager.getOrCreateSoAStore(TransformSoASchema);
      physicsWorld.setTransformStore(txStore, {
        fpPositionX: 'fpPositionX',
        fpPositionY: 'fpPositionY',
        fpPositionZ: 'fpPositionZ',
        visualPositionX: 'visualPositionX',
        visualPositionZ: 'visualPositionZ',
      });
    }
  },
});

// 4. Add physics bodies to entities
const body = new PhysicsBodyComponent(entity.id, {
  radius: FP.FromFloat(1.0),
});
entity.addComponent(body);

// 5. Subscribe to collision events
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

### API Reference

- **`applyImpulse(entityId, vx, vz)`** — Set body velocity (replaces, does not accumulate). Re-enables previously ejected bodies.
- **`isSettled(threshold?)`** — Pure query: `true` when all non-static, non-ignored bodies are below velocity threshold (default `0.01`).
- **`onBoundsExit(callback)`** — Subscribe to `BOUNDS_EXIT` events (requires `ejectOnBoundsExit: true`).
