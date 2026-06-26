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
- **Built-in Transform & Interpolation**: `TransformComponent` (SoA fixed-point spatial state), `InterpolationComponent`, and `InterpolationSystem` for tick-to-frame render smoothing
- **PhysicsWorld Facade**: One-liner setup — wraps PhysicsSystem + InterpolationSystem, exposes event subscriptions, spatial queries, and interpolated transforms

## Core Components

### PhysicsWorld (Recommended Entry Point)
- **PhysicsWorld**: High-level facade — creates PhysicsSystem and InterpolationSystem, wires collision pipeline, exposes event subscriptions, spatial queries, and `getInterpolatedTransform()`

### Transform & Interpolation
- **TransformComponent**: SoA-backed fixed-point position and rotation (`TransformSoASchema`, `TRANSFORM_COMPONENT_TYPE`)
- **InterpolationComponent**: Tick-to-tick transform samples for render smoothing
- **InterpolationSystem**: Snapshots/captures transform state each tick and interpolates each frame (implements `IBeforeTick`, `IAfterTick`, `IBeforeFrame`)

### Physics Body
- **PhysicsBodyComponent**: SoA-backed component with velocity, radius, mass, restitution, friction, isStatic, and ignorePhysics fields
- **PhysicsSoASchema**: Schema definition for the SoA storage layout

### Collision Detection
- **SpatialHashGrid**: Broad-phase spatial partitioning with `queryPairs()` and `queryRadius()`
- **NarrowPhase**: Static methods for precise collision geometry tests

### Systems
- **PhysicsSystem**: Velocity integration with sub-stepping, world bounds handling, broad/narrow/resolve collision pipeline, `step()` / `applyImpulse()` / `isSettled()` / `setCollisionFilter()` API. Created and owned by `PhysicsWorld`; retrieve it via `physicsWorld.getSystems().physicsSystem` to register with `GameWorld`.
- **InterpolationSystem**: Tick/frame lifecycle hooks for transform interpolation. Register as a **frame system** via `physicsWorld.getSystems().interpolationSystem`.

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
git clone https://github.com/phaeton-forge/phalanx-engine.git
cd phalanx-engine
pnpm install
pnpm --filter @phalanx-engine/physics build
```

Peer dependencies: `@phalanx-engine/ecs` ^0.1.0, `@phalanx-engine/math` ^0.1.0

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
  TransformComponent,
  TransformSoASchema,
  TRANSFORM_COMPONENT_TYPE,
  InterpolationComponent,
  INTERPOLATION_COMPONENT_TYPE,
  type PhysicsBodyConfig,

  // Collision primitives
  SpatialHashGrid,
  NarrowPhase,
  type CollisionManifold,

  // Systems
  PhysicsSystem,
  InterpolationSystem,
  type InterpolatedTransformSample,

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
  type CollisionFilter,
  type PhysicsConfig,
} from '@phalanx-engine/physics';
```

## Quick Start

```typescript
import { GameWorld, GameSystem, createComponentTypeRegistry } from '@phalanx-engine/ecs';
import {
  PhysicsWorld,
  PhysicsBodyComponent,
  TransformComponent,
  InterpolationComponent,
  PHYSICS_BODY_COMPONENT_TYPE,
  TRANSFORM_COMPONENT_TYPE,
  INTERPOLATION_COMPONENT_TYPE,
} from '@phalanx-engine/physics';
import { FP, FPVector3, FPQuaternion } from '@phalanx-engine/math';

// Register canonical component type symbols from phalanx-physics
export const ComponentType = createComponentTypeRegistry({
  Transform: 'Transform',
  Interpolation: 'Interpolation',
  PhysicsBody: 'PhysicsBody',
});
(ComponentType as Record<string, symbol>).Transform = TRANSFORM_COMPONENT_TYPE;
(ComponentType as Record<string, symbol>).Interpolation = INTERPOLATION_COMPONENT_TYPE;
(ComponentType as Record<string, symbol>).PhysicsBody = PHYSICS_BODY_COMPONENT_TYPE;

// Minimal placeholder systems — replace with your real ones.
class MovementSystem extends GameSystem {
  public override processTick(_tick: number): void { /* set velocities here */ }
}
class RenderSystem extends GameSystem {
  public override update(_dt: number): void {
    const sample = this.physics?.getInterpolatedTransform(entityId);
    if (sample) {
      mesh.position.set(sample.position.x, sample.position.y, sample.position.z);
      // sample.rotation is a float quaternion { x, y, z, w } — apply it as-is.
      mesh.quaternion.set(sample.rotation.x, sample.rotation.y, sample.rotation.z, sample.rotation.w);
    }
  }
}
const movementSystem = new MovementSystem();
const renderSystem = new RenderSystem();

// 1. Create GameWorld and the physics facade
const world = new GameWorld({ componentTypes: Object.values(ComponentType) });

const physicsWorld = new PhysicsWorld({
  gridCellSize: FP.FromFloat(8),
  subSteps: 3,
  tickRate: 20,
  maxVelocity: FP.FromFloat(15),
  pushStrength: FP.FromFloat(15),
});

// 2. Wire physics into SystemContext so systems can access it
world.context.physics = physicsWorld;

// 3. Register systems with GameWorld (order matters)
const { physicsSystem, interpolationSystem } = physicsWorld.getSystems();
world.registerSystems(
  [movementSystem, physicsSystem],   // tick systems
  [interpolationSystem, renderSystem], // frame systems — InterpolationSystem runs before render
);

world.start();

// 4. Add transform, interpolation, and physics body to entities
declare const entity: { id: number; addComponent(c: unknown): void };
const fpPosition = FPVector3.FromFloat(0, 0, 0);
const fpRotation = FPQuaternion.Identity();
entity.addComponent(new TransformComponent(entity.id, fpPosition, fpRotation));
entity.addComponent(new InterpolationComponent(fpPosition, fpRotation));
entity.addComponent(new PhysicsBodyComponent(entity.id, { radius: FP.FromFloat(1.0) }));
world.entityManager.addEntity(entity as any);

// 5. Subscribe to collision events (must be called after world.start())
physicsWorld.onCollision((event) => {
  console.log(`Collision: ${event.entityA} ↔ ${event.entityB}`);
});
```

> **Note:** `PhysicsSystem` reads and writes the built-in `TransformSoASchema` store directly — no `setTransformStore()` or consumer-defined transform schema is required. Register `Transform`, `Interpolation`, and `PhysicsBody` component types using the canonical symbols exported from phalanx-physics.

## Turn-Based Physics (Tick Providers)

For turn-based games like Chapayev checkers, use a tick provider to decouple simulation from the server tick loop:

```typescript
import {
  PhysicsWorld,
  AutonomousPhysicsTickProvider,
} from '@phalanx-engine/physics';
import { FP } from '@phalanx-engine/math';

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
  getSystems(): { physicsSystem: PhysicsSystem; interpolationSystem: InterpolationSystem };
  setCollisionFilter(filter: (entityA: number, entityB: number) => boolean): void;

  // Event subscriptions (must be called after GameWorld.start())
  onCollision(callback: (event: CollisionEvent) => void): () => void;
  onBoundsExit(callback: (event: BoundsExitEvent) => void): () => void;

  // Planned — not yet emitted by PhysicsSystem.
  onTriggerEnter(callback: (event: CollisionEvent) => void): () => void;
  onTriggerExit(callback: (event: CollisionEvent) => void): () => void;

  // Impulse / settle queries
  applyImpulse(entityId: number, vx: FixedPoint, vz: FixedPoint): void;
  isSettled(threshold?: FixedPoint): boolean;

  // Spatial / transform queries
  readonly spatialGrid: SpatialHashGrid;
  getEntityPosition(entityId: number): { x: FixedPoint; z: FixedPoint } | undefined;
  getInterpolatedTransform(entityId: number): InterpolatedTransformSample | undefined;

  // Cleanup
  dispose(): void;
}
```

- **`getSystems()`** — Returns both `physicsSystem` (register as tick system) and `interpolationSystem` (register as frame system).
- **`getEntityPosition(entityId)`** — Fixed-point position for gameplay queries (e.g. ability targeting).
- **`getInterpolatedTransform(entityId)`** — Interpolated float transform for rendering, populated after `InterpolationSystem` runs. Returns an `InterpolatedTransformSample` with `position: { x, y, z }` and `rotation: { x, y, z, w }` — rotation is a float quaternion (slerped between tick samples), apply it directly to a mesh quaternion.

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

### `TransformComponent`

```typescript
class TransformComponent extends SoAComponent<typeof TransformSoASchema.definition> {
  static readonly soaSchema: typeof TransformSoASchema;
  readonly type: symbol; // TRANSFORM_COMPONENT_TYPE

  constructor(entityId: number, initialPosition?: FPVector3, initialRotation?: FPQuaternion);

  fpPosition: FPVector3;        // get/set — authoritative fixed-point position
  fpRotation: FPQuaternion;     // get/set — authoritative rotation quaternion
  fpRotationEuler: FPVector3;   // get/set — computed Euler view (radians, XYZ order)
  fpRotationY: FixedPoint;      // get/set — convenience Y-yaw (radians)
}
```

Rotation is authoritatively a quaternion (`fpRotation`). `fpRotationEuler` (XYZ Euler radians) and `fpRotationY` (yaw) are computed views over it — recomputed on each access, mirroring Unity's `Transform.rotation` / `Transform.eulerAngles`. Setting `fpRotationEuler` calls `FPQuaternion.FromEulerXYZ`; setting `fpRotationY` builds a yaw rotation around `FPVector3.Up`.

`TransformSoASchema` fields: `fpPositionX/Y/Z`, `fpRotationX/Y/Z/W` (all `i64`). Rotation defaults to the identity quaternion (`w = 1`).

### `InterpolationComponent`

```typescript
class InterpolationComponent implements IComponent {
  readonly type: symbol; // INTERPOLATION_COMPONENT_TYPE

  constructor(initialPosition?: FPVector3, initialRotation?: FPQuaternion);

  snapshot(): void;  // copy current → previous (called by InterpolationSystem before tick)
  capture(fpPosition: FPVector3, fpRotation: FPQuaternion): void; // capture authoritative state after tick
}
```

Attach alongside `TransformComponent` on any entity that needs render interpolation.

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
