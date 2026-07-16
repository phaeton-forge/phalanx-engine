---
name: phalanx-physics
description: Add deterministic fixed-point physics to a game using the phalanx-physics library from the phalanx-engine repository. Use when the user wants to set up collision detection, velocity integration, spatial hashing, or physics bodies. Covers PhysicsWorld facade, TransformComponent, InterpolationSystem, PhysicsBodyComponent, GravitySystem, SpatialHashGrid, NarrowPhase, PhysicsSystem, applyImpulse3D, gravityMultiplier, raycastSegment, and collision filtering patterns.
metadata:
  author: phaeton2040-AI
  version: '1.5'
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
- Detect a 3D collision — e.g. ordnance hitting a static obstacle like a building — via a swept-segment raycast (workaround until full 3D body-body collision exists)
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
│   └── NarrowPhase       ← Circle vs Circle / Circle vs AABB / AABB vs AABB tests
└── InterpolationSystem   ← Tick/frame lifecycle hooks for render smoothing
    ├── TransformComponent (built-in SoA)
    └── InterpolationComponent (tick samples)
```

Pipeline per tick (all deterministic, fixed-point):
```
MovementSystem (game-specific, sets velocities)
    ↓
GravitySystem.processTick()   ← velocityY -= gravity * dt * gravityMultiplier (useGravity=1 only)
    ↓
PhysicsSystem.processTick()
    for each sub-step:
      → integrate velocities into TransformSoASchema positions
      → rebuild spatial grid
      → query candidate pairs
      → narrow-phase circle-vs-circle tests
      → resolve: 'push' (default) or 'impulse' collision response + positional separation
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
const { gravitySystem, physicsSystem, interpolationSystem } = physicsWorld.getSystems();

// Register in tick system order — ORDER MATTERS:
// 1. Game-specific system sets velocities (e.g., MovementSystem)
// 2. GravitySystem applies acceleration (no-op when gravity=0 / useGravity=false)
// 3. PhysicsSystem integrates velocities, detects, and resolves collisions
// 4. Game-specific systems react to the updated positions
const tickSystems = [
  movementSystem,    // Game-specific: sets velocities on PhysicsBodyComponent
  gravitySystem,     // phalanx-physics: acceleration (before integration)
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
> Destructure only `{ physicsSystem, interpolationSystem }` if you do not need gravity — `gravitySystem` is always created but is a no-op when `gravity` is 0.

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

| Field                | Type  | TypedArray       | Description                           |
| -------------------- | ----- | ---------------- | ------------------------------------- |
| `velocityX`          | `i64` | `BigInt64Array`  | X velocity (raw FixedPoint)           |
| `velocityY`          | `i64` | `BigInt64Array`  | Y velocity (raw FixedPoint)           |
| `velocityZ`          | `i64` | `BigInt64Array`  | Z velocity (raw FixedPoint)           |
| `radius`             | `i64` | `BigInt64Array`  | Collision radius (raw FixedPoint)     |
| `mass`               | `i64` | `BigInt64Array`  | Entity mass (raw FixedPoint)          |
| `restitution`        | `i64` | `BigInt64Array`  | Bounce factor (raw FixedPoint)        |
| `friction`           | `i64` | `BigInt64Array`  | Surface friction (raw FixedPoint)     |
| `isStatic`           | `u8`  | `Uint8Array`     | 1 = immovable, 0 = dynamic           |
| `ignorePhysics`      | `u8`  | `Uint8Array`     | 1 = skip all physics, 0 = active     |
| `useGravity`         | `u8`  | `Uint8Array`     | 1 = GravitySystem applies gravity, 0 = ignore (default) |
| `gravityMultiplier`  | `i64` | `BigInt64Array`  | Per-body scale on world gravity (default `FP._1`) |
| `lastX`              | `f64` | `Float64Array`   | Cached float X position               |
| `lastZ`              | `f64` | `Float64Array`   | Cached float Z position               |

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
  defaultFriction?: FixedPoint; // Applied when body friction is 0 (default: FP.FromFloat(0.92))
  collisionResponse?: 'push' | 'impulse'; // default 'push'
  restitution?: FixedPoint;    // impulse mode only; falls back to per-body restitution
  tickProvider?: IPhysicsTickProvider;
  ejectOnBoundsExit?: boolean;
  settleThreshold?: FixedPoint;
  gravity?: FixedPoint;             // Acceleration magnitude (default: FP._0 = disabled)
  gravityAxis?: 'x' | 'y' | 'z';   // Gravity axis (default: 'y'; only 'y' supported in v1)
}
```

### Collision Response (`'push'` vs `'impulse'`)

| Mode | Behavior | Use when |
|---|---|---|
| `'push'` *(default)* | Positional separation + mass-weighted push velocity. Does **not** conserve momentum. | Crowd/soft separation, characters, most real-time games. |
| `'impulse'` | Momentum-conserving elastic collision along the contact normal. | Billiards / Chapayev / air-hockey — strike must transfer momentum. |

```typescript
const physicsWorld = new PhysicsWorld({
  collisionResponse: 'impulse',
  restitution: FP.FromFloat(0.85),
});
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
import { SpatialHashGrid, NarrowPhase, segmentVsAABB } from '@phalanx-engine/physics';
import type { CollisionManifold, RayHit, Vec3FP, AABB } from '@phalanx-engine/physics';

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

- **GravitySystem applies ACCELERATION only**: `velocityY -= gravity * dt * gravityMultiplier` for bodies with `useGravity = 1`. It never writes position.
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
  mass: FP._1,                   // with mass 1, applyImpulse3D args ≈ desired velocity
  useGravity: true,
  gravityMultiplier: FP.FromFloat(2), // optional per-body scale (default FP._1)
}));
```

Register `gravitySystem` as a tick system **before** `physicsSystem`:

```typescript
const { gravitySystem, physicsSystem, interpolationSystem } = physicsWorld.getSystems();
world.registerSystems([gravitySystem, physicsSystem, /* ... */], [interpolationSystem]);
```

### Firing arcing ordnance (artillery / shrapnel)

Use `applyImpulse3D` to launch a body on a ballistic arc. It is a **true momentum impulse** — `velocity = impulse / mass` on all three axes — and clears `ignorePhysics`. Bodies with `mass <= 0` are unchanged.

```typescript
// Launch a shell up and forward; gravity pulls it back into a parabola.
// With mass = 1, these impulse values equal the resulting velocity.
physicsWorld.applyImpulse3D(
  shellId,
  FP.FromFloat(0),    // ix
  FP.FromFloat(20),   // iy (up)
  FP.FromFloat(30),   // iz (forward)
);
```

> **Asymmetry:** `applyImpulse(entityId, vx, vz)` sets XZ **velocity** directly (does **not** divide by mass) — historical flick API. `applyImpulse3D` divides by mass. Prefer `mass = FP._1` when you want impulse args to match desired velocity.

### Gravity decision tree

- Body should fall / arc (projectile, shell, fragment, jump)? → set `useGravity: true`, optionally tune `gravityMultiplier`, and give it a launch impulse (`applyImpulse3D`).
- Body is ground-plane only (units, most gameplay)? → leave `useGravity` false (default); it never moves on Y.
- Body is static (`isStatic=1`)? → `GravitySystem` skips it, so `static + useGravity` is a clean no-op (statics never integrate position).
- Need lighter/heavier fall without changing world gravity? → set `gravityMultiplier` (e.g. `2` = twice world gravity; `0` = no gravity without clearing the flag).
- Need gravity along X or Z? → not supported in v1 (`GravitySystem` throws). X/Z are owned by `PhysicsSystem`'s integrator; ceding an axis is a v2 change.
- Gravity magnitude is applied per whole tick (`gravity * tickDt * multiplier`), not per sub-step, so very high gravity + few ticks is a coarse approximation — increase tick rate for smoother arcs.

## Raycast / Swept-Segment Queries (3D collision workaround)

> ⚠️ **Workaround for 3D collisions.** The core pipeline is 2D/XZ and does not
> detect Y-axis collisions. For 3D collisions — e.g. ordnance hitting a static
> obstacle like a building — use this swept-segment raycast query as a workaround
> until full 3D body-body collision is implemented (planned for v2).

`raycastSegment` sweeps a moving point (a body's previous → current position)
against caller-supplied AABBs and returns the nearest hit — impact point and
outward face normal — or `null`. `segmentVsAABB` is the single-box primitive.

```typescript
import { PhysicsWorld } from '@phalanx-engine/physics';
import type { Vec3FP, AABB, RayHit } from '@phalanx-engine/physics';

const hit: RayHit | null = physicsWorld.raycastSegment(prevPos, curPos, buildingBoxes);
if (hit) {
  // hit.t ∈ [0,1] (0 at prev, 1 at cur); hit.point = lerp(prev, cur, t)
  // hit.normal = outward entry-face normal (±X/±Y/±Z), fixed-point
  detonateAt(hit.point, hit.normal);
}
```

Semantics: `t ∈ [0,1]`; segment starting inside a box → `t=0`, `point=prev`,
`normal` = nearest face. Fully deterministic `FP.*` math — degenerate cases
(parallel-to-slab, zero-length) never divide-by-zero or produce `NaN`.

### Raycast decision tree

- Need to detect ordnance/projectile hitting a static 3D obstacle (building,
  wall)? → build the obstacle `AABB[]` and call `raycastSegment(prev, cur, boxes)`
  each tick. **This is the sanctioned 3D-collision workaround.**
- Need unit-vs-unit collision? → that stays in the 2D/XZ `PhysicsSystem`
  circle-vs-circle pipeline; do **not** use raycast for it.
- Testing a single box? → use `segmentVsAABB` directly.

**v1 limitations (workaround scope):** pure linear scan over caller-supplied
boxes (no broad-phase / spatial-hash acceleration); the moving body is a point
(radius not swept — inflate the box for a margin); unit-vs-unit stays 2D/XZ.
**v2 path:** `BoxColliderComponent`, grid-accelerated raycasts, and true 3D
body-body collision resolution.

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
- Register `gravitySystem` then `physicsSystem` as tick systems, `interpolationSystem` as frame system
- Attach `TransformComponent` + `InterpolationComponent` on every entity that moves and renders
- Use `this.physics.getInterpolatedTransform()` in render systems — do not maintain separate visual position caches
- Use `physicsWorld.getEntityPosition()` for fixed-point gameplay queries (ability targeting, range checks)
- Use `applyImpulse3D` for ballistic launch (`v = i / mass`); use `applyImpulse` only for grounded XZ flick velocity
- Use `setCollisionFilter()` for game-specific rules — keeps phalanx-physics decoupled from game concepts
- Call `physicsWorld.dispose()` when tearing down the game
