---
name: phalanx-physics
description: Add deterministic fixed-point physics to a game using the phalanx-physics library from the phalanx-engine repository. Use when the user wants to set up collision detection, velocity integration, spatial hashing, or physics bodies. Covers PhysicsWorld facade, TransformComponent, InterpolationSystem, PhysicsBodyComponent, SpatialHashGrid, NarrowPhase, PhysicsSystem, and collision filtering patterns.
metadata:
  author: phaeton2040-AI
  version: '1.3'
---

# Phalanx Physics Skill

## When to Use This Skill

Use this skill when the user asks to:

- Add physics to a game using phalanx-physics
- Create physics bodies with radius, mass, velocity, or collision properties
- Set up collision detection (broad-phase or narrow-phase)
- Configure a PhysicsWorld with sub-stepping and velocity integration
- Implement deterministic collision resolution for lockstep multiplayer
- Add game-specific collision filtering (e.g., team-based rules)
- Query entities by spatial proximity (range queries)
- Add gravity or launch arcing/ballistic ordnance (artillery, shrapnel, projectiles)
- Wire physics systems into a GameWorld tick pipeline
- Set up tick-to-frame interpolation for rendering

## Prerequisites

- TypeScript project with strict mode
- `phalanx-ecs` package (peer dependency — GameSystem, SoAComponent, EntityManager, EventBus, lifecycle hooks)
- `phalanx-math` package (peer dependency — FP.*, FixedPoint, FPVector3, FPQuaternion)

## Architecture Overview

```
PhysicsWorld (Facade)
├── GravitySystem         ← Applies acceleration to velocityY (runs BEFORE PhysicsSystem)
├── PhysicsSystem         ← Velocity integration + collision pipeline (sub-stepped)
│   ├── SpatialHashGrid   ← O(n) broad-phase via spatial hashing
│   └── NarrowPhase       ← Circle vs Circle collision tests
└── InterpolationSystem   ← Tick/frame lifecycle hooks for render smoothing
    ├── TransformComponent (built-in SoA)
    └── InterpolationComponent (tick samples)
```

Pipeline per tick (all deterministic, fixed-point):
```
MovementSystem (game-specific, sets velocities)
    ↓
GravitySystem.processTick()   ← velocityY -= gravity * dt (only bodies with useGravity=1)
    ↓
PhysicsSystem.processTick()
    for each sub-step:
      → integrate velocities into TransformSoASchema positions
      → rebuild spatial grid
      → query candidate pairs
      → narrow-phase circle-vs-circle tests
      → resolve: impulse push + positional separation
      → emit PhysicsEvents.COLLISION via EventBus
    after iteration: emit PhysicsEvents.BOUNDS_EXIT for any bodies ejected this tick
    ↓
IBeforeTick: InterpolationSystem.snapshot()
    ↓ (tick systems run)
IAfterTick: InterpolationSystem.capture()
```

Pipeline per frame:
```
IBeforeFrame: InterpolationSystem.interpolate(alpha)
    ↓
RenderSystem reads this.physics.getInterpolatedTransform(entityId)
```

> **Events actually emitted by `PhysicsSystem`:** `PhysicsEvents.COLLISION` and
> `PhysicsEvents.BOUNDS_EXIT` only. `TRIGGER_ENTER` / `TRIGGER_EXIT` are reserved on
> the event constants and have subscriber methods on `PhysicsWorld`, but are **not yet
> emitted** — planned, not implemented.

### Key Design Decisions

- **Deterministic**: All math uses `FP.*` fixed-point operations — no `Math.*`, no native float arithmetic on physics values
- **Built-in transform**: `TransformComponent` and `TransformSoASchema` are owned by phalanx-physics — no consumer-defined transform schema or `setTransformStore()`
- **Built-in interpolation**: `InterpolationSystem` implements `IBeforeTick`, `IAfterTick`, `IBeforeFrame` — GameWorld invokes hooks automatically
- **SoA storage**: `BigInt64Array` for FixedPoint values, `Uint8Array` for flags
- **Entity iteration**: Always sorted by ID for lockstep determinism
- **SystemContext integration**: Set `world.context.physics = physicsWorld` before `registerSystems()` — systems access via `this.physics` getter
- **Collision filtering**: Game-specific logic injected via `setCollisionFilter()` callback

## Step-by-Step Instructions

### 1. Install and Set Up PhysicsWorld

```typescript
import { PhysicsWorld } from '@phalanx-engine/physics';
import { FP } from '@phalanx-engine/math';

const physicsWorld = new PhysicsWorld({
  gridCellSize: FP.FromFloat(8),    // Spatial hash cell size (>= 2 * maxRadius)
  subSteps: 3,                       // Physics sub-steps per tick
  tickRate: 20,                      // Tick rate in Hz (used to compute tickDt)
  maxVelocity: FP.FromFloat(15.0),  // Maximum velocity magnitude
  pushStrength: FP.FromFloat(15.0), // Collision push force multiplier

  // Optional: clamp positions to arena bounds
  worldBounds: {
    minX: FP.FromFloat(-50),
    minZ: FP.FromFloat(-50),
    maxX: FP.FromFloat(50),
    maxZ: FP.FromFloat(50),
  },
});
```

### 2. Wire PhysicsWorld into SystemContext

```typescript
import { GameWorld } from '@phalanx-engine/ecs';

const world = new GameWorld({ /* ... */ });
world.context.physics = physicsWorld;
```

Systems access the facade via the protected `this.physics` getter on `GameSystem`:

```typescript
class RenderSystem extends GameSystem {
  update(_dt: number): void {
    const sample = this.physics?.getInterpolatedTransform(entityId);
    if (sample) {
      mesh.position.set(sample.position.x, sample.position.y, sample.position.z);
      // sample.rotation is a float quaternion { x, y, z, w } — apply it directly.
      mesh.quaternion.set(sample.rotation.x, sample.rotation.y, sample.rotation.z, sample.rotation.w);
    }
  }
}
```

### 3. Register Systems with GameWorld

```typescript
const { physicsSystem, interpolationSystem } = physicsWorld.getSystems();

// Register in tick system order — ORDER MATTERS:
// 1. Game-specific system sets velocities (e.g., MovementSystem)
// 2. PhysicsSystem integrates velocities, detects, and resolves collisions
// 3. Game-specific systems react to the updated positions
const tickSystems = [
  movementSystem,    // Game-specific: sets velocities on PhysicsBodyComponent
  physicsSystem,     // phalanx-physics: integrate + collide + resolve
  combatSystem,      // Game-specific: reacts to updated positions
];

const frameSystems = [
  interpolationSystem, // phalanx-physics: snapshot/capture/interpolate via lifecycle hooks
  renderSystem,        // reads this.physics.getInterpolatedTransform()
];

world.registerSystems(tickSystems, frameSystems);
```

> **No `setTransformStore()` needed.** `PhysicsSystem` reads/writes the built-in `TransformSoASchema` store directly.

### 4. Register Component Type Symbols

Import canonical symbols from phalanx-physics and override your registry:

```typescript
import { createComponentTypeRegistry } from '@phalanx-engine/ecs';
import {
  PHYSICS_BODY_COMPONENT_TYPE,
  TRANSFORM_COMPONENT_TYPE,
  INTERPOLATION_COMPONENT_TYPE,
} from '@phalanx-engine/physics';

export const ComponentType = createComponentTypeRegistry({
  Transform: 'Transform',
  Interpolation: 'Interpolation',
  PhysicsBody: 'PhysicsBody',
  // ... other game types
});

(ComponentType as Record<string, symbol>).Transform = TRANSFORM_COMPONENT_TYPE;
(ComponentType as Record<string, symbol>).Interpolation = INTERPOLATION_COMPONENT_TYPE;
(ComponentType as Record<string, symbol>).PhysicsBody = PHYSICS_BODY_COMPONENT_TYPE;
```

### 5. Create Entity Components

Every physics entity needs `TransformComponent`, `InterpolationComponent` (for render smoothing), and optionally `PhysicsBodyComponent`:

```typescript
import {
  TransformComponent,
  InterpolationComponent,
  PhysicsBodyComponent,
} from '@phalanx-engine/physics';
import { FP, FPVector3, FPQuaternion } from '@phalanx-engine/math';

const fpPosition = FPVector3.FromFloat(10, 0, 20);
const fpRotation = FPQuaternion.Identity();

entity.addComponent(new TransformComponent(entity.id, fpPosition, fpRotation));
entity.addComponent(new InterpolationComponent(fpPosition, fpRotation));
entity.addComponent(new PhysicsBodyComponent(entity.id, {
  radius: FP.FromFloat(1.0),
  mass: FP.FromFloat(1.0),
  isStatic: false,
  restitution: FP.FromFloat(0.5),
  friction: FP.FromFloat(0.3),
}));
```

### 6. Set Velocities in a Game-Specific System

Physics does NOT set velocities — that's the game's responsibility. Your movement system runs BEFORE PhysicsSystem and writes velocities to the PhysicsBody SoA store:

```typescript
import { GameSystem, type SoAComponentStore, type SystemContext } from '@phalanx-engine/ecs';
import { PhysicsSoASchema } from '@phalanx-engine/physics';
import { FP } from '@phalanx-engine/math';

class MovementSystem extends GameSystem {
  private physicsStore!: SoAComponentStore<typeof PhysicsSoASchema.definition>;

  public override init(context: SystemContext): void {
    super.init(context);
    this.physicsStore = this.entityManager.getOrCreateSoAStore(PhysicsSoASchema);
  }

  public override processTick(_tick: number): void {
    const physVelocityX = this.physicsStore.arrays.velocityX;
    const physVelocityZ = this.physicsStore.arrays.velocityZ;
    const zeroRaw = FP.ToRaw(FP._0);

    for (const entityId of this.physicsStore.entityIds()) {
      const physIndex = this.physicsStore.indexOf(entityId);
      if (this.physicsStore.arrays.isStatic[physIndex] === 1) continue;

      const entity = this.entityManager.getEntity(entityId);
      if (!entity) continue;

      const movement = entity.getComponent<MovementComponent>(ComponentType.Movement);
      if (movement?.isMoving) {
        const speed = FP.FromFloat(movement.speed);
        physVelocityX[physIndex] = FP.ToRaw(FP.Mul(directionX, speed));
        physVelocityZ[physIndex] = FP.ToRaw(FP.Mul(directionZ, speed));
      } else {
        physVelocityX[physIndex] = zeroRaw;
        physVelocityZ[physIndex] = zeroRaw;
      }
    }
  }
}
```

### 7. Add Collision Filtering (Optional)

```typescript
physicsWorld.setCollisionFilter((entityIdA: number, entityIdB: number) => {
  const eA = entityManager.getEntity(entityIdA);
  const eB = entityManager.getEntity(entityIdB);
  if (!eA || !eB) return false;
  // return false to skip collision resolution for this pair
  return true;
});
```

### 8. Subscribe to Collision Events

```typescript
// Via PhysicsWorld facade (after world.start())
physicsWorld.onCollision((event) => {
  console.log(`Collision: ${event.entityA} ↔ ${event.entityB}`);
});

// Or directly via EventBus
import { PhysicsEvents } from '@phalanx-engine/physics';
eventBus.on(PhysicsEvents.COLLISION, (event) => { /* ... */ });
```

### 9. Spatial Queries and Transform Queries

```typescript
// Spatial proximity
const nearby = physicsWorld.spatialGrid.queryRadius(
  FP.FromFloat(10), FP.FromFloat(20), FP.FromFloat(5),
);

// Fixed-point position for gameplay (ability targeting, range checks)
const pos = physicsWorld.getEntityPosition(entityId);
if (pos) { /* pos.x, pos.z are FixedPoint */ }

// Interpolated float transform for rendering (after InterpolationSystem runs)
const sample = physicsWorld.getInterpolatedTransform(entityId);
if (sample) {
  mesh.position.set(sample.position.x, sample.position.y, sample.position.z);
  // sample.rotation is a float quaternion { x, y, z, w }
  mesh.quaternion.set(sample.rotation.x, sample.rotation.y, sample.rotation.z, sample.rotation.w);
}
```

## TransformComponent & TransformSoASchema

Built-in SoA component for authoritative fixed-point spatial state:

| Field              | Type  | Description                                         |
| ------------------ | ----- | --------------------------------------------------- |
| `fpPositionX/Y/Z`  | `i64` | Fixed-point position (raw FP)                       |
| `fpRotationX/Y/Z/W`| `i64` | Fixed-point rotation **quaternion** (raw FP); identity default has `w = 1` |

Rotation is stored as a quaternion, not Euler radians. The authoritative value is `fpRotation` (`FPQuaternion`); `fpRotationEuler` (XYZ Euler radians) and `fpRotationY` (yaw) are computed views over it.

```typescript
import { TransformComponent, TransformSoASchema, TRANSFORM_COMPONENT_TYPE } from '@phalanx-engine/physics';
import { FPQuaternion } from '@phalanx-engine/math';

const transform = new TransformComponent(entity.id, fpPosition, FPQuaternion.Identity());
transform.fpPosition = newPosition;            // get/set FPVector3
transform.fpRotation = FPQuaternion.Identity(); // get/set FPQuaternion (authoritative)
transform.fpRotationY = FP.FromFloat(Math.PI);  // convenience yaw around FPVector3.Up
```

Hot-path access:

```typescript
const store = entityManager.getOrCreateSoAStore(TransformSoASchema);
const idx = store.indexOf(entityId);
store.arrays.fpPositionX[idx] = FP.ToRaw(newX);
```

## InterpolationComponent & InterpolationSystem

`InterpolationComponent` stores tick-to-tick transform samples. `InterpolationSystem` manages the lifecycle automatically via `IBeforeTick` / `IAfterTick` / `IBeforeFrame`:

```typescript
// InterpolationSystem flow (automatic when registered as frame system):
// beforeTick → snapshot() on all InterpolationComponents
// afterTick  → capture() authoritative TransformComponent state
// beforeFrame → interpolate(alpha) → getInterpolatedTransform() available
```

Attach `InterpolationComponent` on any entity that needs render smoothing alongside `TransformComponent`.

## PhysicsSoASchema Fields

| Field           | Type  | TypedArray       | Description                           |
| --------------- | ----- | ---------------- | ------------------------------------- |
| `velocityX`     | `i64` | `BigInt64Array`  | X velocity (raw FixedPoint)           |
| `velocityY`     | `i64` | `BigInt64Array`  | Y velocity (raw FixedPoint)           |
| `velocityZ`     | `i64` | `BigInt64Array`  | Z velocity (raw FixedPoint)           |
| `radius`        | `i64` | `BigInt64Array`  | Collision radius (raw FixedPoint)     |
| `mass`          | `i64` | `BigInt64Array`  | Entity mass (raw FixedPoint)          |
| `restitution`   | `i64` | `BigInt64Array`  | Bounce factor (raw FixedPoint)        |
| `friction`      | `i64` | `BigInt64Array`  | Surface friction (raw FixedPoint)     |
| `isStatic`      | `u8`  | `Uint8Array`     | 1 = immovable, 0 = dynamic           |
| `ignorePhysics` | `u8`  | `Uint8Array`     | 1 = skip all physics, 0 = active     |
| `useGravity`    | `u8`  | `Uint8Array`     | 1 = GravitySystem applies gravity, 0 = ignore (default) |
| `lastX`         | `f64` | `Float64Array`   | Cached float X position               |
| `lastZ`         | `f64` | `Float64Array`   | Cached float Z position               |

## PhysicsWorldConfig

```typescript
interface PhysicsWorldConfig {
  gridCellSize?: FixedPoint;   // Spatial hash cell size (default: FP.FromFloat(4))
  subSteps?: number;           // Sub-steps per tick (default: 3)
  tickRate?: number;           // Hz, computes tickDt = 1/tickRate (default: 20)
  maxVelocity?: FixedPoint;    // Velocity clamp (default: FP.FromFloat(15))
  pushStrength?: FixedPoint;   // Collision push force (default: FP.FromFloat(15))
  worldBounds?: {
    minX: FixedPoint; minZ: FixedPoint; maxX: FixedPoint; maxZ: FixedPoint;
  };
  defaultRestitution?: FixedPoint;
  defaultFriction?: FixedPoint;
  tickProvider?: IPhysicsTickProvider;
  ejectOnBoundsExit?: boolean;
  settleThreshold?: FixedPoint;
  gravity?: FixedPoint;             // Acceleration magnitude (default: FP._0 = disabled)
  gravityAxis?: 'x' | 'y' | 'z';   // Gravity axis (default: 'y'; only 'y' supported in v1)
}
```

## Collision Pipeline Detail

### Broad Phase — SpatialHashGrid

```typescript
const grid = new SpatialHashGrid(FP.FromFloat(8));
grid.insert(entityId, posX, posZ, radius);
grid.queryPairs();
grid.queryRadius(cx, cz, r);
```

### Narrow Phase — NarrowPhase

```typescript
const manifold = NarrowPhase.circleVsCircle(
  posAX, posAZ, radiusA, posBX, posBZ, radiusB, entityIdA, entityIdB,
);
```

Returns `CollisionManifold | null`: `{ entityA, entityB, normalX, normalZ, penetration }`.

## Exports from phalanx-physics

```typescript
// Components
import {
  PhysicsBodyComponent,
  PhysicsSoASchema,
  PHYSICS_BODY_COMPONENT_TYPE,
  TransformComponent,
  TransformSoASchema,
  TRANSFORM_COMPONENT_TYPE,
  InterpolationComponent,
  INTERPOLATION_COMPONENT_TYPE,
} from '@phalanx-engine/physics';
import type { PhysicsBodyConfig } from '@phalanx-engine/physics';

// Collision primitives
import { SpatialHashGrid, NarrowPhase } from '@phalanx-engine/physics';
import type { CollisionManifold } from '@phalanx-engine/physics';

// Systems
import { PhysicsSystem, GravitySystem, InterpolationSystem } from '@phalanx-engine/physics';
import type { InterpolatedTransformSample } from '@phalanx-engine/physics';

// Facade
import { PhysicsWorld } from '@phalanx-engine/physics';

// Tick providers
import {
  AutonomousPhysicsTickProvider,
  ExternalPhysicsTickProvider,
} from '@phalanx-engine/physics';
import type { IPhysicsTickProvider, AutonomousProviderOptions } from '@phalanx-engine/physics';

// Events & types
import { PhysicsEvents } from '@phalanx-engine/physics';
import type {
  PhysicsWorldConfig,
  CollisionFilter,
  CollisionEvent,
  BoundsExitEvent,
  PhysicsConfig,
} from '@phalanx-engine/physics';
```

> Note: `TransformFieldMapping` and `setTransformStore()` have been removed. Use the built-in `TransformComponent` instead.

## Gravity & Ballistic Ordnance

`GravitySystem` adds optional deterministic gravity. It follows a strict **one-owner-per-axis** rule:

- **GravitySystem applies ACCELERATION only**: `velocityY -= gravity * dt` for bodies with `useGravity = 1`. It never writes position.
- **PhysicsSystem owns position integration**: `posY += velY * dt` happens in `applyVelocities`, alongside X/Z.
- Collisions remain 2D/XZ — Y never affects broad/narrow phase. `maxVelocity` and `worldBounds` clamps stay XZ-only.

Enable it by passing `gravity` (and optionally `gravityAxis`) to `PhysicsWorld`, then flag individual bodies:

```typescript
const physicsWorld = new PhysicsWorld({
  // ...
  gravity: FP.FromFloat(9.8),   // acceleration magnitude; default FP._0 disables gravity
  gravityAxis: 'y',              // default 'y'; 'x'/'z' throw in v1
});

// Per-body opt-in (default false — existing bodies are unaffected):
entity.addComponent(new PhysicsBodyComponent(entity.id, {
  radius: FP.FromFloat(0.5),
  mass: FP.FromFloat(1.0),
  useGravity: true,
}));
```

Register `gravitySystem` as a tick system **before** `physicsSystem`:

```typescript
const { gravitySystem, physicsSystem, interpolationSystem } = physicsWorld.getSystems();
world.registerSystems([gravitySystem, physicsSystem, /* ... */], [interpolationSystem]);
```

### Firing arcing ordnance (artillery / shrapnel)

Use `applyImpulse3D` to launch a body on a ballistic arc in one call — it sets all three velocity components and clears `ignorePhysics`:

```typescript
// Launch a shell up and forward; gravity pulls it back into a parabola.
physicsWorld.applyImpulse3D(
  shellId,
  FP.FromFloat(0),    // vx
  FP.FromFloat(20),   // vy (up)
  FP.FromFloat(30),   // vz (forward)
);
```

> `applyImpulse` (XZ-only) is unchanged for grounded knockback. Use `applyImpulse3D` when the Y component matters.

### Gravity decision tree

- Body should fall / arc (projectile, shell, fragment, jump)? → set `useGravity: true` and give it a launch velocity (`applyImpulse3D`).
- Body is ground-plane only (units, most gameplay)? → leave `useGravity` false (default); it never moves on Y.
- Need gravity along X or Z? → not supported in v1 (`GravitySystem` throws). X/Z are owned by `PhysicsSystem`'s integrator; ceding an axis is a v2 change.
- Gravity magnitude is applied per whole tick (`gravity * tickDt`), not per sub-step, so very high gravity + few ticks is a coarse approximation — increase tick rate for smoother arcs.

## Best Practices

### Deterministic Lockstep Rules

- Use `FP.*` functions for ALL physics arithmetic — never native `Math.*` or float operators on simulation values
- Use `FP.ToRaw()` / `FP.FromRaw()` when writing/reading i64 SoA fields
- Iterate `physicsStore.entityIds()` for deterministic entity ordering
- Never use `Math.random()`, `Date.now()`, or `performance.now()` in physics logic
- Set `gridCellSize` to at least `2 * maxEntityRadius` for correct broad-phase coverage

### Performance

- Cache SoA array references outside loops: `const velX = store.arrays.velocityX`
- Bypass the PhysicsBodyComponent facade in hot-path systems — access SoA arrays directly
- Use cross-store lookups (`store.indexOf(entityId)`) sparingly — one per entity per loop
- Set `ignorePhysics = 1` for dying/phasing entities instead of removing the component

### Integration

- Set `world.context.physics = physicsWorld` before `registerSystems()`
- Register `physicsSystem` as tick system, `interpolationSystem` as frame system
- Attach `TransformComponent` + `InterpolationComponent` on every entity that moves and renders
- Use `this.physics.getInterpolatedTransform()` in render systems — do not maintain separate visual position caches
- Use `physicsWorld.getEntityPosition()` for fixed-point gameplay queries (ability targeting, range checks)
- Use `setCollisionFilter()` for game-specific rules — keeps phalanx-physics decoupled from game concepts
- Call `physicsWorld.dispose()` when tearing down the game
